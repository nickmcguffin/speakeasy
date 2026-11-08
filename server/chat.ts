import type { DefaultEventsMap, Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import type {
  ClientToServerEvents,
  EncryptedMessage,
  ErrorCode,
  Participant,
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

type MessageRow = {
  id: string; // bigint arrives as a string from pg
  client_id: string;
  room_id: string;
  author_name: string;
  ciphertext: string;
  iv: string;
  created_at: Date;
};

const messageColumns = "id, client_id, room_id, author_name, ciphertext, iv, created_at";
const recentLimit = 50;
const catchUpLimit = 200;

// Increases with every join, so the presence list is in join order.
let joinCount = 0;

function toMessage(row: MessageRow): EncryptedMessage {
  return {
    id: Number(row.id),
    clientId: row.client_id,
    roomId: row.room_id,
    authorName: row.author_name,
    ciphertext: row.ciphertext,
    iv: row.iv,
    createdAt: row.created_at.toISOString(),
  };
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

// Without since: the last 50. With since: the newest 200 after it, so the current conversation shows.
async function loadMessages(roomId: string, since: number | undefined) {
  const result =
    since === undefined
      ? await pool.query<MessageRow>(
          `SELECT * FROM (SELECT ${messageColumns} FROM messages WHERE room_id = $1 ORDER BY id DESC LIMIT $2) recent ORDER BY id`,
          [roomId, recentLimit],
        )
      : await pool.query<MessageRow>(
          `SELECT * FROM (SELECT ${messageColumns} FROM messages WHERE room_id = $1 AND id > $2 ORDER BY id DESC LIMIT $3) missed ORDER BY id`,
          [roomId, since, catchUpLimit],
        );

  const messages: EncryptedMessage[] = [];
  for (const row of result.rows) {
    messages.push(toMessage(row));
  }
  return messages;
}

// Sends the room's current participants to everyone in it. Only sockets that finished a join
// have a participantId. A socket that left or disconnected is no longer in the room.
async function broadcastPresence(io: ChatServer, roomId: string) {
  const joined: SocketData[] = [];
  for (const member of await io.in(roomId).fetchSockets()) {
    const { displayName, participantId, joinOrder } = member.data;
    if (displayName && participantId && joinOrder !== undefined) {
      joined.push({ roomId, displayName, participantId, joinOrder });
    }
  }
  joined.sort((first, second) => first.joinOrder - second.joinOrder);

  const participants: Participant[] = [];
  for (const member of joined) {
    participants.push({ participantId: member.participantId, name: member.displayName });
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
      if (previousRoomId && previousRoomId !== join.roomId) {
        await socket.leave(previousRoomId);
        await broadcastPresence(io, previousRoomId);
      }

      // Join before loading, so a message sent in between is broadcast to this socket.
      // A duplicate from that overlap is dropped by id on the client.
      await socket.join(join.roomId);
      const participantId = randomUUID();
      joinCount += 1;
      socket.data.roomId = join.roomId;
      socket.data.displayName = join.displayName;
      socket.data.participantId = participantId;
      socket.data.joinOrder = joinCount;
      console.log(`socket ${socket.id} joined room ${join.roomId}`);

      let messages: EncryptedMessage[];
      try {
        messages = await loadMessages(join.roomId, join.since);
      } catch (error) {
        // Leave before the error ack, so a failed join is not counted in presence and cannot send.
        await socket.leave(join.roomId);
        socket.data = {};
        throw error;
      }

      reply({ ok: true, participantId, messages });
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
      const { roomId, displayName } = socket.data;
      if (!roomId || !displayName) {
        reply(failure("NOT_JOINED"));
        return;
      }

      const send = parseSendPayload(payload);
      if (!send) {
        reply(failure("INVALID_INPUT"));
        return;
      }

      // The author is the joined name on socket.data, never a value from the payload.
      const inserted = await pool.query<MessageRow>(
        `INSERT INTO messages (room_id, client_id, author_name, ciphertext, iv)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (room_id, client_id) DO NOTHING
         RETURNING ${messageColumns}`,
        [roomId, send.clientId, displayName, send.ciphertext, send.iv],
      );

      const insertedRow = inserted.rows[0];
      if (insertedRow) {
        const message = toMessage(insertedRow);
        reply({ ok: true, message });
        socket.to(roomId).emit("message:new", message);
        return;
      }

      // A retry of a message that is already stored: return it, and do not broadcast it again.
      const existing = await pool.query<MessageRow>(
        `SELECT ${messageColumns} FROM messages WHERE room_id = $1 AND client_id = $2`,
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
    const { roomId } = socket.data;
    if (!roomId) {
      return;
    }
    try {
      await broadcastPresence(io, roomId);
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
