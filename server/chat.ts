import type { DefaultEventsMap, Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  EncryptedMessage,
  ErrorCode,
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

function handleJoin(socket: ChatSocket) {
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
      }

      // Join before loading, so a message sent in between is broadcast to this socket.
      // A duplicate from that overlap is dropped by id on the client.
      await socket.join(join.roomId);
      socket.data.roomId = join.roomId;
      socket.data.displayName = join.displayName;
      console.log(`socket ${socket.id} joined room ${join.roomId}`);

      reply({ ok: true, messages: await loadMessages(join.roomId, join.since) });
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

export function registerChatHandlers(io: ChatServer) {
  io.on("connection", (socket) => {
    console.log(`socket connected: ${socket.id}`);
    handleJoin(socket);
    handleSend(socket);
  });
}
