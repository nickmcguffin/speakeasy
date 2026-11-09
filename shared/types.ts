// Every row the server stores and sends: a message or a join or leave event. Message text is
// never plain text. Events have no encrypted fields.
type RecordBase = {
  id: number; // server ID, used for ordering and the `since` cursor (any kind)
  roomId: string;
  authorName: string; // plain text (see Known limits in README)
  authorKey: string | null; // the author's presenceKey. null for rows from before step 7e
  createdAt: string; // ISO 8601
};

export type EncryptedMessage = RecordBase & {
  kind: "message";
  clientId: string;
  ciphertext: string; // base64url
  iv: string; // base64url, 12 bytes
};

// "Bob joined the room" or "Bob left the room", stored when a browser's first connection joins
// and after its last connection has been gone for 5 seconds.
export type RoomEvent = RecordBase & { kind: "join" | "leave" };

export type RoomRecord = EncryptedMessage | RoomEvent;

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
  | { ok: true; presenceKey: string; messages: RoomRecord[] }
  | { ok: false; error: ErrorCode };
export type SendResult = { ok: true; message: EncryptedMessage } | { ok: false; error: ErrorCode };

export type ClientToServerEvents = {
  "room:join": (payload: JoinPayload, ack: (result: JoinResult) => void) => void;
  "message:send": (payload: SendPayload, ack: (result: SendResult) => void) => void;
};

export type ServerToClientEvents = {
  "message:new": (record: RoomRecord) => void;
  // The full list of joined participants, in join order. Sent to the whole room after every
  // join and leave, and replaces the client's list.
  "room:presence": (participants: Participant[]) => void;
};

// Stored on socket.data after a successful room:join. joinOrder sorts the presence list.
// presenceKey is stored on every message and event of this browser as its author key.
export type SocketData = {
  roomId: string;
  displayName: string;
  browserToken: string;
  presenceKey: string;
  joinOrder: number;
};
