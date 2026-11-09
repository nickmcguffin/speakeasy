import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  EncryptedMessage,
  ErrorCode,
  ServerToClientEvents,
} from "../shared/types.js";
import { Composer } from "./Composer";
import { decrypt, encrypt, type RoomKey } from "./crypto";
import { MessageList } from "./MessageList";
import { navigate } from "./navigation";
import { ParticipantPanel } from "./ParticipantPanel";
import { RoomHeader } from "./RoomHeader";
import { Toast, type ToastMessage } from "./Toast";
import { type ChatMessage, initialRoomState, type PendingMessage, roomReducer } from "./roomState";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SendableMessage = Pick<PendingMessage, "clientId" | "body" | "ciphertext" | "iv">;

const ackTimeoutMs = 10_000;
// "Loading messages..." shows only when the history takes longer than this.
const loadingNoteDelayMs = 300;

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

// Until the room lookup has found the room, roomName and roomKey are null: the room layout
// shows at once, with no name and no connection.
type ChatRoomProps = {
  roomId: string;
  roomName: string | null;
  displayName: string;
  roomKey: RoomKey | null;
  browserToken: string;
};

export function ChatRoom({ roomId, roomName, displayName, roomKey, browserToken }: ChatRoomProps) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const [joinError, setJoinError] = useState<ErrorCode | null>(null);
  // Messages up to this id arrived with a join (history or catch-up), so they do not slide in.
  const [historyEndId, setHistoryEndId] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loadingIsSlow, setLoadingIsSlow] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const panelId = useId();
  const participantButtonRef = useRef<HTMLButtonElement>(null);
  const socketRef = useRef<ChatSocket | null>(null);
  // Read by the connect handler, which is set up once, so it cannot read state directly.
  const lastMessageIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    lastMessageIdRef.current = state.messages.at(-1)?.id;
  }, [state.messages]);

  useEffect(() => {
    const timer = setTimeout(() => setLoadingIsSlow(true), loadingNoteDelayMs);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!roomKey) {
      return;
    }
    // closeOnBeforeunload closes the connection itself when the tab closes or refreshes, so the
    // server is told even when the browser's own close would be lost on the way.
    const socket: ChatSocket = io({ closeOnBeforeunload: true });
    socketRef.current = socket;

    // Runs on the first connect and on every reconnect, because a new server socket is in no room.
    // "Connected" waits for the join ack, so nothing is sent before the server knows the room.
    const handleConnect = async () => {
      try {
        const result = await socket.timeout(ackTimeoutMs).emitWithAck("room:join", {
          roomId,
          displayName,
          browserToken,
          since: lastMessageIdRef.current,
        });
        if (!result.ok) {
          setJoinError(result.error);
          return;
        }
        setJoinError(null);
        const messages = await decryptMessages(roomKey, result.messages);
        let lastId = 0;
        for (const message of messages) {
          lastId = Math.max(lastId, message.id);
        }
        setHistoryEndId((current) => Math.max(current, lastId));
        dispatch({ type: "received", messages });
        dispatch({ type: "joined", presenceKey: result.presenceKey });
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
  }, [roomId, displayName, roomKey, browserToken]);

  // Used for the first send and for Retry. A retry reuses the stored clientId, ciphertext and iv,
  // so the server can recognise it and store the message only once.
  const sendPending = async ({ clientId, body, ciphertext, iv }: SendableMessage) => {
    const socket = socketRef.current;
    if (!socket || !roomKey) {
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
        dispatch({ type: "failed", clientId, failure: result.error === "INVALID_INPUT" ? "invalid" : "server" });
        return;
      }
      const { ciphertext: _ciphertext, iv: _iv, ...message } = result.message;
      dispatch({ type: "received", messages: [{ ...message, body }] });
    } catch {
      // No ack in time, or the connection dropped.
      dispatch({ type: "failed", clientId, failure: "network" });
    }
  };

  const handleSend = (body: string) => {
    const clientId = crypto.randomUUID();
    dispatch({ type: "queued", clientId, body, queuedAt: new Date().toISOString() });
    sendPending({ clientId, body });
  };

  const handleRetry = (message: PendingMessage) => {
    dispatch({ type: "sending", clientId: message.clientId });
    sendPending(message);
  };

  // Closes the connection first, so the others see this browser leave without waiting for the
  // room screen to unmount.
  const handleLeave = () => {
    socketRef.current?.disconnect();
    navigate("/");
  };

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    participantButtonRef.current?.focus();
  }, []);

  const handleTogglePanel = () => {
    if (panelOpen) {
      closePanel();
    } else {
      setPanelOpen(true);
    }
  };

  const handleLinkSaved = () => {
    dispatch({ type: "linkSaved" });
    setToast({ id: Date.now(), text: "Link copied" });
  };

  let listNote: string | null = null;
  if (!state.historyLoaded) {
    listNote = loadingIsSlow ? "Loading messages..." : null;
  } else if (state.messages.length === 0 && state.pending.length === 0) {
    listNote = "No messages yet.";
  }

  let joinErrorText: string | null = null;
  if (joinError === "ROOM_NOT_FOUND") {
    joinErrorText = "Room not found";
  } else if (joinError) {
    joinErrorText = "Could not join the room. Reload the page to try again.";
  }

  return (
    <div className="room">
      <RoomHeader
        roomName={roomName}
        connection={state.connection}
        participantCount={state.participants.length}
        panelId={panelId}
        panelOpen={panelOpen}
        participantButtonRef={participantButtonRef}
        onTogglePanel={handleTogglePanel}
        onLinkSaved={handleLinkSaved}
        onLeave={handleLeave}
      />
      <main className="room-body">
        <div className="conversation">
          <MessageList
            messages={state.messages}
            pending={state.pending}
            displayName={displayName}
            historyEndId={historyEndId}
            note={listNote}
            onRetry={handleRetry}
          />
          <Toast message={toast} onDismiss={() => setToast(null)} />
          <Composer connection={state.connection} joinError={joinErrorText} onSend={handleSend} />
        </div>
        {/* Below 900px the open panel covers the messages. A click on the backdrop closes it. */}
        {panelOpen && <div className="panel-backdrop" onClick={closePanel} aria-hidden="true" />}
        <ParticipantPanel
          id={panelId}
          participants={state.participants}
          presenceKey={state.presenceKey}
          open={panelOpen}
          onClose={closePanel}
        />
      </main>
    </div>
  );
}
