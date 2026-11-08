// What the server stores and sends. It never contains plain text.
export type EncryptedMessage = {
  id: number; // server ID, used for ordering and the `since` cursor
  clientId: string;
  roomId: string;
  authorName: string; // plain text (see Known limits in README)
  ciphertext: string; // base64url
  iv: string; // base64url, 12 bytes
  createdAt: string; // ISO 8601
};

export type ErrorCode = "ROOM_NOT_FOUND" | "NOT_FOUND" | "INVALID_INPUT" | "NOT_JOINED" | "SERVER_ERROR";

// REST

export type ErrorResponse = { error: ErrorCode };

// POST /api/rooms (no request body)
export type CreateRoomResponse = { roomId: string };

// GET /api/rooms/:roomId
export type RoomResponse = { roomId: string; createdAt: string };

// Socket.IO

export type JoinPayload = { roomId: string; displayName: string; since?: number };
export type SendPayload = { clientId: string; ciphertext: string; iv: string };

export type JoinResult = { ok: true; messages: EncryptedMessage[] } | { ok: false; error: ErrorCode };
export type SendResult = { ok: true; message: EncryptedMessage } | { ok: false; error: ErrorCode };

export type ClientToServerEvents = {
  "room:join": (payload: JoinPayload, ack: (result: JoinResult) => void) => void;
  "message:send": (payload: SendPayload, ack: (result: SendResult) => void) => void;
};

export type ServerToClientEvents = {
  "message:new": (message: EncryptedMessage) => void;
};

// Stored on socket.data after a successful room:join.
export type SocketData = { roomId: string; displayName: string };
