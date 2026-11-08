import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  EncryptedMessage,
  ErrorCode,
  ServerToClientEvents,
} from "../shared/types.js";
import { decrypt, encrypt, type RoomKey } from "./crypto";
import {
  type ChatMessage,
  type ConnectionState,
  initialRoomState,
  type PendingMessage,
  roomReducer,
} from "./roomState";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ackTimeoutMs = 10_000;
const maxMessageLength = 2000;

const connectionLabels: Record<ConnectionState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

async function decryptMessage(key: RoomKey, message: EncryptedMessage): Promise<ChatMessage> {
  const { ciphertext, iv, ...rest } = message;
  try {
    return { ...rest, body: await decrypt(key, { ciphertext, iv }) };
  } catch {
    return { ...rest, body: null };
  }
}

async function decryptMessages(key: RoomKey, messages: EncryptedMessage[]) {
  const decrypted: ChatMessage[] = [];
  for (const message of messages) {
    decrypted.push(await decryptMessage(key, message));
  }
  return decrypted;
}

function joinErrorText(error: ErrorCode) {
  return error === "ROOM_NOT_FOUND"
    ? "Room not found"
    : "Could not join the room. Reload the page to try again.";
}

type ChatRoomProps = { roomId: string; displayName: string; roomKey: RoomKey };

export function ChatRoom({ roomId, displayName, roomKey }: ChatRoomProps) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const [joinError, setJoinError] = useState<ErrorCode | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const messageInputId = useId();
  const socketRef = useRef<ChatSocket | null>(null);
  // Read by the connect handler, which is set up once, so it cannot read state directly.
  const lastMessageIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    lastMessageIdRef.current = state.messages.at(-1)?.id;
  }, [state.messages]);

  useEffect(() => {
    const socket: ChatSocket = io();
    socketRef.current = socket;

    // Runs on the first connect and on every reconnect, because a new server socket is in no room.
    // "Connected" waits for the join ack, so nothing is sent before the server knows the room.
    const handleConnect = async () => {
      try {
        const result = await socket.timeout(ackTimeoutMs).emitWithAck("room:join", {
          roomId,
          displayName,
          since: lastMessageIdRef.current,
        });
        if (!result.ok) {
          setJoinError(result.error);
          return;
        }
        setJoinError(null);
        dispatch({ type: "received", messages: await decryptMessages(roomKey, result.messages) });
        dispatch({ type: "joined", participantId: result.participantId });
      } catch {
        setJoinError("SERVER_ERROR");
      }
    };

    // socket.active is true while Socket.IO keeps retrying, false once it has given up.
    const handleConnectionLost = () => {
      dispatch({ type: "connection", connection: socket.active ? "reconnecting" : "disconnected" });
    };

    const handleNewMessage = async (message: EncryptedMessage) => {
      dispatch({ type: "received", messages: [await decryptMessage(roomKey, message)] });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleConnectionLost);
    socket.on("connect_error", handleConnectionLost);
    socket.on("message:new", handleNewMessage);
    // Replaces the whole list. After a disconnect the old list stays until this arrives again.
    socket.on("room:presence", (participants) => dispatch({ type: "presence", participants }));

    return () => {
      socket.disconnect();
    };
  }, [roomId, displayName, roomKey]);

  // Used for the first send and for Retry. A retry reuses the stored clientId, ciphertext and iv,
  // so the server can recognise it and store the message only once.
  const sendPending = async ({ clientId, body, ciphertext, iv }: PendingMessage) => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }
    try {
      let encrypted = ciphertext && iv ? { ciphertext, iv } : null;
      if (!encrypted) {
        encrypted = await encrypt(roomKey, body);
        dispatch({ type: "encrypted", clientId, ...encrypted });
      }
      const result = await socket
        .timeout(ackTimeoutMs)
        .emitWithAck("message:send", { clientId, ...encrypted });
      if (!result.ok) {
        dispatch({ type: "failed", clientId });
        return;
      }
      const { ciphertext: _ciphertext, iv: _iv, ...message } = result.message;
      dispatch({ type: "received", messages: [{ ...message, body }] });
    } catch {
      dispatch({ type: "failed", clientId });
    }
  };

  const canSend = state.connection === "connected";

  const sendDraft = () => {
    const body = draft.trim();
    if (body.length === 0) {
      return;
    }
    if (body.length > maxMessageLength) {
      setDraftError(`Messages can be at most 2,000 characters. This one has ${body.length}.`);
      return;
    }
    setDraftError(null);
    setDraft("");
    const clientId = crypto.randomUUID();
    dispatch({ type: "queued", clientId, body });
    sendPending({ clientId, body, status: "sending" });
  };

  const handleRetry = (message: PendingMessage) => {
    dispatch({ type: "sending", clientId: message.clientId });
    sendPending(message);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSend) {
      sendDraft();
    }
  };

  // Enter sends, Shift+Enter adds a line. Enter during IME composition only confirms the text.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) {
        sendDraft();
      }
    }
  };

  return (
    <>
      <p>Joined as {displayName}</p>
      <p>{connectionLabels[state.connection]}</p>
      {joinError && <p role="alert">{joinErrorText(joinError)}</p>}

      {state.participants.length > 0 && (
        <section aria-label="People in this room">
          <p>
            {state.participants.length} {state.participants.length === 1 ? "person" : "people"} here
          </p>
          <ul>
            {state.participants.map((participant) => (
              <li key={participant.participantId}>
                {participant.name}
                {participant.participantId === state.participantId && " (you)"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol aria-label="Messages" aria-live="polite">
        {state.messages.map((message) => (
          <li key={message.id}>
            <p>
              <strong>{message.authorName}</strong>{" "}
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleTimeString()}
              </time>
            </p>
            {message.body === null ? (
              <p>
                <em>Unable to decrypt this message</em>
              </p>
            ) : (
              <p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
            )}
          </li>
        ))}
        {state.pending.map((message) => (
          <li key={message.clientId}>
            <p>
              <strong>{displayName}</strong> {message.status === "failed" ? "Failed" : "Sending..."}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
            {message.status === "failed" && (
              <button type="button" onClick={() => handleRetry(message)} disabled={!canSend}>
                Retry
              </button>
            )}
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit}>
        {/* A label that wraps the field would include the draft in the field's accessible name. */}
        <label htmlFor={messageInputId}>Message</label>
        <br />
        <textarea
          id={messageInputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <br />
        <button type="submit" disabled={!canSend}>
          Send
        </button>
        {draftError && <p role="alert">{draftError}</p>}
      </form>
    </>
  );
}
