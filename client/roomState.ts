import type { EncryptedMessage, Participant } from "../shared/types.js";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
export type MessageStatus = "sending" | "sent" | "failed";

export type ChatMessage = Omit<EncryptedMessage, "ciphertext" | "iv"> & {
  body: string | null; // null when decryption fails
};

export type PendingMessage = {
  clientId: string;
  body: string;
  status: MessageStatus;
  ciphertext?: string;
  iv?: string;
};

export type RoomState = {
  connection: ConnectionState;
  messages: ChatMessage[]; // confirmed and decrypted, ordered by id
  pending: PendingMessage[]; // in send order
  participants: Participant[]; // the last room:presence list, kept while disconnected
  participantId: string | null; // this client's entry, from the latest join ack
};

export type RoomAction =
  | { type: "connection"; connection: ConnectionState }
  | { type: "joined"; participantId: string }
  | { type: "presence"; participants: Participant[] }
  | { type: "received"; messages: ChatMessage[] }
  | { type: "queued"; clientId: string; body: string }
  | { type: "encrypted"; clientId: string; ciphertext: string; iv: string }
  | { type: "sending"; clientId: string }
  | { type: "failed"; clientId: string };

export const initialRoomState: RoomState = {
  connection: "connecting",
  messages: [],
  pending: [],
  participants: [],
  participantId: null,
};

// Merges by id, so a message that arrives twice (join backfill and broadcast) shows once.
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<number, ChatMessage>();
  for (const message of current) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((first, second) => first.id - second.id);
}

function updatePending(pending: PendingMessage[], clientId: string, changes: Partial<PendingMessage>) {
  const updated: PendingMessage[] = [];
  for (const message of pending) {
    updated.push(message.clientId === clientId ? { ...message, ...changes } : message);
  }
  return updated;
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.connection };

    // The join ack and room:presence can arrive in either order. They set separate fields,
    // and "(you)" is matched when both are there.
    case "joined":
      return { ...state, connection: "connected", participantId: action.participantId };

    case "presence":
      return { ...state, participants: action.participants };

    case "received": {
      // A confirmed message replaces the pending one with the same clientId. This covers both
      // the send ack and a backfill after a lost ack.
      const confirmedClientIds = new Set<string>();
      for (const message of action.messages) {
        confirmedClientIds.add(message.clientId);
      }
      const pending: PendingMessage[] = [];
      for (const message of state.pending) {
        if (!confirmedClientIds.has(message.clientId)) {
          pending.push(message);
        }
      }
      return { ...state, messages: mergeMessages(state.messages, action.messages), pending };
    }

    case "queued":
      return {
        ...state,
        pending: [...state.pending, { clientId: action.clientId, body: action.body, status: "sending" }],
      };

    case "encrypted":
      return {
        ...state,
        pending: updatePending(state.pending, action.clientId, {
          ciphertext: action.ciphertext,
          iv: action.iv,
        }),
      };

    case "sending":
      return { ...state, pending: updatePending(state.pending, action.clientId, { status: "sending" }) };

    case "failed":
      return { ...state, pending: updatePending(state.pending, action.clientId, { status: "failed" }) };
  }
}
