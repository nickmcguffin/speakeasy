import type { DefaultEventsMap, Server, Socket } from "socket.io";
import { createHash } from "node:crypto";
import type {
  ClientToServerEvents,
  EncryptedMessage,
  ErrorCode,
  Participant,
  RoomEvent,
  RoomRecord,
  ServerToClientEvents,
  SocketData,
} from "../shared/types.js";
import { pool } from "./db.js";
import { parseJoinPayload, parseSendPayload } from "./validation.js";

// socket.data is empty until room:join succeeds, so its fields are optional here.
export type ChatServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  Partial<SocketData>
>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, Partial<SocketData>>;

// A message or a join or leave event. The CHECK constraint in schema.sql guarantees that a
// message has client_id, ciphertext and iv, and that an event has none of them.
type RecordRow = {
  id: string; // bigint arrives as a string from pg
  kind: "message" | "join" | "leave";
  client_id: string | null;
  room_id: string;
  author_name: string;
  author_key: string | null; // null for rows from before step 7e
  ciphertext: string | null;
  iv: string | null;
  created_at: Date;
};

const recordColumns = "id, kind, client_id, room_id, author_name, author_key, ciphertext, iv, created_at";
const recentLimit = 50;
const catchUpLimit = 200;
// A browser's last connection must stay gone this long before its "left" event, so a refresh
// or a short network switch makes no events.
const leaveDelayMs = 5000;

// Increases with every join, so the presence list is in join order.
let joinCount = 0;

// Pending "left" events, keyed by room and presenceKey.
const leaveTimers = new Map<string, NodeJS.Timeout>();
// Event decisions for one browser in one room run one at a time, so two tabs joining together,
// or a join while the leave timer fires, cannot store two events. One server instance only.
const eventQueues = new Map<string, Promise<unknown>>();

function toMessage(row: RecordRow): EncryptedMessage {
  return {
    kind: "message",
    id: Number(row.id),
    clientId: row.client_id as string,
    roomId: row.room_id,
    authorName: row.author_name,
    authorKey: row.author_key,
    ciphertext: row.ciphertext as string,
    iv: row.iv as string,
    createdAt: row.created_at.toISOString(),
  };
}

function toEvent(row: RecordRow): RoomEvent {
  return {
    kind: row.kind === "leave" ? "leave" : "join",
    id: Number(row.id),
    roomId: row.room_id,
    authorName: row.author_name,
    authorKey: row.author_key,
    createdAt: row.created_at.toISOString(),
  };
}

function toRecord(row: RecordRow): RoomRecord {
  return row.kind === "message" ? toMessage(row) : toEvent(row);
}

// Runs the task after any earlier task with the same key has finished.
function inOrder<Result>(key: string, task: () => Promise<Result>): Promise<Result> {
  const previous = eventQueues.get(key) ?? Promise.resolve();
  const result = previous.then(task);
  const tail = result.catch(() => {});
  eventQueues.set(key, tail);
  tail.then(() => {
    if (eventQueues.get(key) === tail) {
      eventQueues.delete(key);
    }
  });
  return result;
}

// A client may emit without an ack function. Replying must never throw.
function safeAck<Result>(ack: unknown): (result: Result) => void {
  if (typeof ack === "function") {
    return (result) => ack(result);
  }
  return () => {};
}

function failure(error: ErrorCode) {
  return { ok: false, error } as const;
}

async function roomExists(roomId: string) {
  const result = await pool.query("SELECT 1 FROM rooms WHERE id = $1", [roomId]);
  return result.rowCount === 1;
}

// Messages and events together. Without since: the last 50. With since: the newest 200 after
// it, so the current conversation shows.
async function loadMessages(roomId: string, since: number | undefined) {
  const result =
    since === undefined
      ? await pool.query<RecordRow>(
          `SELECT * FROM (SELECT ${recordColumns} FROM messages WHERE room_id = $1 ORDER BY id DESC LIMIT $2) recent ORDER BY id`,
          [roomId, recentLimit],
        )
      : await pool.query<RecordRow>(
          `SELECT * FROM (SELECT ${recordColumns} FROM messages WHERE room_id = $1 AND id > $2 ORDER BY id DESC LIMIT $3) missed ORDER BY id`,
          [roomId, since, catchUpLimit],
        );

  const records: RoomRecord[] = [];
  for (const row of result.rows) {
    records.push(toRecord(row));
  }
  return records;
}

// The last join or leave event of this browser in this room decides: a "joined" event only
// when the last one is not a join, and a "left" event only when it is.
const lastEventSql = `SELECT kind, author_name FROM messages
  WHERE room_id = $1 AND author_key = $2 AND kind IN ('join', 'leave') ORDER BY id DESC LIMIT 1`;

async function insertJoinEvent(roomId: string, authorKey: string, displayName: string) {
  const result = await pool.query<RecordRow>(
    `INSERT INTO messages (room_id, kind, author_key, author_name)
     SELECT $1::uuid, 'join', $2::text, $3::text
     WHERE (SELECT kind FROM (${lastEventSql}) last) IS DISTINCT FROM 'join'
     RETURNING ${recordColumns}`,
    [roomId, authorKey, displayName],
  );
  return result.rows[0] ? toEvent(result.rows[0]) : null;
}

// The "left" event keeps the name from the browser's "joined" event.
async function insertLeaveEvent(roomId: string, authorKey: string) {
  const result = await pool.query<RecordRow>(
    `INSERT INTO messages (room_id, kind, author_key, author_name)
     SELECT $1::uuid, 'leave', $2::text, last.author_name FROM (${lastEventSql}) last
     WHERE last.kind = 'join'
     RETURNING ${recordColumns}`,
    [roomId, authorKey],
  );
  return result.rows[0] ? toEvent(result.rows[0]) : null;
}

async function browserIsInRoom(io: ChatServer, roomId: string, authorKey: string) {
  for (const member of await io.in(roomId).fetchSockets()) {
    if (member.data.presenceKey === authorKey) {
      return true;
    }
  }
  return false;
}

// Called when a socket has left a room (disconnect, joining another room, or a failed join).
// If it was the browser's last connection there, a "left" event follows after leaveDelayMs,
// unless the browser is back by then.
async function afterSocketLeftRoom(io: ChatServer, roomId: string, authorKey: string) {
  if (await browserIsInRoom(io, roomId, authorKey)) {
    return;
  }
  const timerKey = `${roomId}:${authorKey}`;
  clearTimeout(leaveTimers.get(timerKey));
  const timer = setTimeout(() => {
    leaveTimers.delete(timerKey);
    inOrder(timerKey, async () => {
      if (await browserIsInRoom(io, roomId, authorKey)) {
        return null;
      }
      return insertLeaveEvent(roomId, authorKey);
    })
      .then((event) => {
        if (event) {
          io.to(roomId).emit("message:new", event);
        }
      })
      .catch((error: Error) => {
        console.error(`leave event failed in room ${roomId}: ${error.message}`);
      });
  }, leaveDelayMs);
  leaveTimers.set(timerKey, timer);
}

// The browser's ID in this room. The token itself never leaves the server.
function presenceKey(roomId: string, browserToken: string) {
  return createHash("sha256").update(`${roomId}:${browserToken}`).digest("base64url");
}

// Sends the room's current participants to everyone in it: one entry per browser, however many
// of its tabs are connected. Only sockets that finished a join have a browser token. A socket
// that left or disconnected is no longer in the room, so a browser leaves the list when its
// last connection closes. Entries are ordered by the browser's earliest open join and show the
// name from its latest join.
async function broadcastPresence(io: ChatServer, roomId: string) {
  const browsers = new Map<string, { firstJoin: number; lastJoin: number; name: string }>();
  for (const member of await io.in(roomId).fetchSockets()) {
    const { displayName, browserToken, joinOrder } = member.data;
    if (!displayName || !browserToken || joinOrder === undefined) {
      continue;
    }
    const browser = browsers.get(browserToken);
    if (!browser) {
      browsers.set(browserToken, { firstJoin: joinOrder, lastJoin: joinOrder, name: displayName });
      continue;
    }
    browser.firstJoin = Math.min(browser.firstJoin, joinOrder);
    if (joinOrder > browser.lastJoin) {
      browser.lastJoin = joinOrder;
      browser.name = displayName;
    }
  }

  const ordered = [...browsers].sort(([, first], [, second]) => first.firstJoin - second.firstJoin);
  const participants: Participant[] = [];
  for (const [browserToken, browser] of ordered) {
    participants.push({ presenceKey: presenceKey(roomId, browserToken), name: browser.name });
  }
  io.to(roomId).emit("room:presence", participants);
}

function handleJoin(io: ChatServer, socket: ChatSocket) {
  socket.on("room:join", async (payload, ack) => {
    const reply = safeAck<Parameters<typeof ack>[0]>(ack);
    try {
      const join = parseJoinPayload(payload);
      if (!join) {
        reply(failure("INVALID_INPUT"));
        return;
      }
      if (!(await roomExists(join.roomId))) {
        reply(failure("ROOM_NOT_FOUND"));
        return;
      }

      const previousRoomId = socket.data.roomId;
      const previousKey = socket.data.presenceKey;
      if (previousRoomId && previousKey && previousRoomId !== join.roomId) {
        await socket.leave(previousRoomId);
        await broadcastPresence(io, previousRoomId);
        await afterSocketLeftRoom(io, previousRoomId, previousKey);
      }

      // Join before loading, so a message sent in between is broadcast to this socket.
      // A duplicate from that overlap is dropped by id on the client.
      const authorKey = presenceKey(join.roomId, join.browserToken);
      await socket.join(join.roomId);
      joinCount += 1;
      socket.data.roomId = join.roomId;
      socket.data.displayName = join.displayName;
      socket.data.browserToken = join.browserToken;
      socket.data.presenceKey = authorKey;
      socket.data.joinOrder = joinCount;
      console.log(`socket ${socket.id} joined room ${join.roomId}`);

      let messages: RoomRecord[];
      try {
        // The browser is back, so a pending "left" event is cancelled. A "joined" event is
        // stored before the history loads, so the joiner gets it in the history.
        const timerKey = `${join.roomId}:${authorKey}`;
        const joinEvent = await inOrder(timerKey, async () => {
          clearTimeout(leaveTimers.get(timerKey));
          leaveTimers.delete(timerKey);
          return insertJoinEvent(join.roomId, authorKey, join.displayName);
        });
        if (joinEvent) {
          socket.to(join.roomId).emit("message:new", joinEvent);
        }
        messages = await loadMessages(join.roomId, join.since);
      } catch (error) {
        // Leave before the error ack, so a failed join is not counted in presence and cannot send.
        await socket.leave(join.roomId);
        socket.data = {};
        await afterSocketLeftRoom(io, join.roomId, authorKey);
        throw error;
      }

      reply({ ok: true, presenceKey: authorKey, messages });
      await broadcastPresence(io, join.roomId);
    } catch (error) {
      console.error(`room:join failed for socket ${socket.id}: ${(error as Error).message}`);
      reply(failure("SERVER_ERROR"));
    }
  });
}

function handleSend(socket: ChatSocket) {
  socket.on("message:send", async (payload, ack) => {
    const reply = safeAck<Parameters<typeof ack>[0]>(ack);
    try {
      const { roomId, displayName, presenceKey: authorKey } = socket.data;
      if (!roomId || !displayName || !authorKey) {
        reply(failure("NOT_JOINED"));
        return;
      }

      const send = parseSendPayload(payload);
      if (!send) {
        reply(failure("INVALID_INPUT"));
        return;
      }

      // The author name and key come from socket.data, never from the payload.
      const inserted = await pool.query<RecordRow>(
        `INSERT INTO messages (room_id, kind, client_id, author_name, author_key, ciphertext, iv)
         VALUES ($1, 'message', $2, $3, $4, $5, $6)
         ON CONFLICT (room_id, client_id) DO NOTHING
         RETURNING ${recordColumns}`,
        [roomId, send.clientId, displayName, authorKey, send.ciphertext, send.iv],
      );

      const insertedRow = inserted.rows[0];
      if (insertedRow) {
        const message = toMessage(insertedRow);
        reply({ ok: true, message });
        socket.to(roomId).emit("message:new", message);
        return;
      }

      // A retry of a message that is already stored: return it, and do not broadcast it again.
      const existing = await pool.query<RecordRow>(
        `SELECT ${recordColumns} FROM messages WHERE room_id = $1 AND client_id = $2`,
        [roomId, send.clientId],
      );
      reply({ ok: true, message: toMessage(existing.rows[0]) });
    } catch (error) {
      console.error(`message:send failed for socket ${socket.id}: ${(error as Error).message}`);
      reply(failure("SERVER_ERROR"));
    }
  });
}

// By "disconnect" the socket has already left its rooms, so the room's sockets are the ones
// that remain. socket.data still holds the room it was in.
function handleDisconnect(io: ChatServer, socket: ChatSocket) {
  socket.on("disconnect", async () => {
    const { roomId, presenceKey: authorKey } = socket.data;
    if (!roomId || !authorKey) {
      return;
    }
    try {
      await broadcastPresence(io, roomId);
      await afterSocketLeftRoom(io, roomId, authorKey);
    } catch (error) {
      console.error(`presence after disconnect failed for socket ${socket.id}: ${(error as Error).message}`);
    }
  });
}

export function registerChatHandlers(io: ChatServer) {
  io.on("connection", (socket) => {
    console.log(`socket connected: ${socket.id}`);
    handleJoin(io, socket);
    handleSend(socket);
    handleDisconnect(io, socket);
  });
}
