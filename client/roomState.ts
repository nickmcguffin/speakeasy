import type { EncryptedMessage, Participant, RoomEvent } from "../shared/types.js";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
export type MessageStatus = "sending" | "sent" | "failed";
// Why a send failed: no ack in time, a server error, or input the server rejected (no Retry).
export type SendFailure = "network" | "server" | "invalid";

export type ChatMessage = Omit<EncryptedMessage, "ciphertext" | "iv"> & {
  body: string | null; // null when decryption fails
};

// A decrypted message, or a join or leave event (which has nothing to decrypt).
export type ChatRecord = ChatMessage | RoomEvent;

export type PendingMessage = {
  clientId: string;
  body: string;
  status: MessageStatus;
  queuedAt: string; // ISO 8601, shown until the server's time arrives
  failure?: SendFailure;
  ciphertext?: string;
  iv?: string;
};

export type RoomState = {
  connection: ConnectionState;
  messages: ChatRecord[]; // confirmed messages (decrypted) and events, ordered by id
  pending: PendingMessage[]; // in send order
  participants: Participant[]; // the last room:presence list, kept while disconnected
  presenceKey: string | null; // this browser's entry, from the latest join ack
  linkSaved: boolean; // true after the link was copied or shared. Kept in the history entry too
  historyLoaded: boolean; // true after the first join ack, which carries the history
};

export type RoomAction =
  | { type: "connection"; connection: ConnectionState }
  | { type: "joined"; presenceKey: string }
  | { type: "presence"; participants: Participant[] }
  | { type: "received"; messages: ChatRecord[] }
  | { type: "queued"; clientId: string; body: string; queuedAt: string }
  | { type: "encrypted"; clientId: string; ciphertext: string; iv: string }
  | { type: "sending"; clientId: string }
  | { type: "failed"; clientId: string; failure: SendFailure }
  | { type: "linkSaved" };

export const initialRoomState: RoomState = {
  connection: "connecting",
  messages: [],
  pending: [],
  participants: [],
  presenceKey: null,
  linkSaved: false,
  historyLoaded: false,
};

// Yours: the row's author key is this browser's. A row without an author key (from before
// author keys) is never yours, whatever its name.
export function isOwnRecord(record: ChatRecord, presenceKey: string | null) {
  return record.authorKey !== null && record.authorKey === presenceKey;
}

// Merges by id, so a message or event that arrives twice (join backfill and broadcast) shows once.
function mergeMessages(current: ChatRecord[], incoming: ChatRecord[]) {
  const byId = new Map<number, ChatRecord>();
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
      return { ...state, connection: "connected", presenceKey: action.presenceKey, historyLoaded: true };

    case "presence":
      return { ...state, participants: action.participants };

    case "received": {
      // A confirmed message replaces the pending one with the same clientId. This covers both
      // the send ack and a backfill after a lost ack.
      const confirmedClientIds = new Set<string>();
      for (const message of action.messages) {
        if (message.kind === "message") {
          confirmedClientIds.add(message.clientId);
        }
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
        pending: [
          ...state.pending,
          { clientId: action.clientId, body: action.body, status: "sending", queuedAt: action.queuedAt },
        ],
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
      return {
        ...state,
        pending: updatePending(state.pending, action.clientId, { status: "sending", failure: undefined }),
      };

    case "failed":
      return {
        ...state,
        pending: updatePending(state.pending, action.clientId, { status: "failed", failure: action.failure }),
      };

    case "linkSaved":
      return { ...state, linkSaved: true };
  }
}
