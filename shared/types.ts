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

// POST /api/rooms. The body is optional: no body for a room without a name, or both fields.
// The name is encrypted in the browser with the room key, like a message.
export type CreateRoomRequest = { nameCiphertext: string; nameIv: string };
export type CreateRoomResponse = { roomId: string };

// GET /api/rooms/:roomId. The name fields are null when the room has no name.
export type RoomResponse = {
  roomId: string;
  createdAt: string;
  nameCiphertext: string | null; // base64url
  nameIv: string | null; // base64url, 12 bytes
};

// Socket.IO

// browserToken is a random UUID kept in this browser's localStorage. It groups a browser's tabs
// into one participant. The server never sends it to any client.
export type JoinPayload = { roomId: string; displayName: string; browserToken: string; since?: number };
export type SendPayload = { clientId: string; ciphertext: string; iv: string };

// One browser in the room, however many tabs it has open. presenceKey is a hash of the room ID
// and the browser token: stable for the browser in this room, different in every room, and it
// does not reveal the token. Two browsers with the same name are two entries, and a client
// finds its own entry by presenceKey, not by name.
export type Participant = { presenceKey: string; name: string };

export type JoinResult =
  | { ok: true; presenceKey: string; messages: EncryptedMessage[] }
  | { ok: false; error: ErrorCode };
export type SendResult = { ok: true; message: EncryptedMessage } | { ok: false; error: ErrorCode };

export type ClientToServerEvents = {
  "room:join": (payload: JoinPayload, ack: (result: JoinResult) => void) => void;
  "message:send": (payload: SendPayload, ack: (result: SendResult) => void) => void;
};

export type ServerToClientEvents = {
  "message:new": (message: EncryptedMessage) => void;
  // The full list of joined participants, in join order. Sent to the whole room after every
  // join and leave, and replaces the client's list.
  "room:presence": (participants: Participant[]) => void;
};

// Stored on socket.data after a successful room:join. joinOrder sorts the presence list.
export type SocketData = { roomId: string; displayName: string; browserToken: string; joinOrder: number };
