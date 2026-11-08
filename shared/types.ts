// Placeholder so both sides compile against shared/. No event uses it yet.
export type SocketEvents = {
  placeholder: () => void;
};

export type ErrorCode = "ROOM_NOT_FOUND" | "NOT_FOUND" | "INVALID_INPUT" | "NOT_JOINED" | "SERVER_ERROR";

export type ErrorResponse = { error: ErrorCode };

// POST /api/rooms (no request body)
export type CreateRoomResponse = { roomId: string };

// GET /api/rooms/:roomId
export type RoomResponse = { roomId: string; createdAt: string };
