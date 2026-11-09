import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  RoomRecord,
  JoinResult,
  ServerToClientEvents,
} from "../shared/types.js";
import { Composer, type ComposerHandle } from "./Composer";
import { decrypt, encrypt, type RoomKey } from "./crypto";
import { MessageList } from "./MessageList";
import { navigate } from "./navigation";
import { ParticipantPanel } from "./ParticipantPanel";
import { failuresBeforeErrorScreen, retryDelayMs } from "./retry";
import { RoomHeader } from "./RoomHeader";
import { SharePanel } from "./SharePanel";
import { StateScreen } from "./StateScreen";
import { Toast, type ToastMessage } from "./Toast";
import { type ChatRecord, initialRoomState, type PendingMessage, roomReducer } from "./roomState";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type SendableMessage = Pick<PendingMessage, "clientId" | "body" | "ciphertext" | "iv">;

const ackTimeoutMs = 10_000;
const copiedMs = 2000;
// "Loading messages..." shows only when the history takes longer than this.
const loadingNoteDelayMs = 300;

// Only messages are encrypted. Join and leave events pass through as they are.
async function decryptRecord(key: RoomKey, record: RoomRecord): Promise<ChatRecord> {
  if (record.kind !== "message") {
    return record;
  }
  const { ciphertext, iv, ...rest } = record;
  try {
    return { ...rest, body: await decrypt(key, { ciphertext, iv }) };
  } catch {
    return { ...rest, body: null };
  }
}

async function decryptRecords(key: RoomKey, records: RoomRecord[]) {
  const decrypted: ChatRecord[] = [];
  for (const record of records) {
    decrypted.push(await decryptRecord(key, record));
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
  lookupRetrying: boolean; // the room lookup failed and is being tried again
  browserToken: string;
};

export function ChatRoom({ roomId, roomName, displayName, roomKey, lookupRetrying, browserToken }: ChatRoomProps) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  // Failed joins in a row (network error, SERVER_ERROR or no ack in time). Reset by a join.
  const [joinFailures, setJoinFailures] = useState(0);
  // ROOM_NOT_FOUND from the join is final: the room is gone.
  const [roomGone, setRoomGone] = useState(false);
  // Set by the socket effect: Try again starts a join at once.
  const retryJoinRef = useRef<() => void>(() => {});
  // Messages up to this id arrived with a join (history or catch-up), so they do not slide in.
  const [historyEndId, setHistoryEndId] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loadingIsSlow, setLoadingIsSlow] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [copied, setCopied] = useState(false);
  // Set when the Clipboard API fails: the link, shown under the header to copy by hand.
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  // The button that started the copy, for focus when the fallback panel closes.
  const copyTriggerRef = useRef<HTMLElement | null>(null);
  const panelId = useId();
  const participantButtonRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
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
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), copiedMs);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!roomKey) {
      return;
    }
    // closeOnBeforeunload closes the connection itself when the tab closes or refreshes, so the
    // server is told even when the browser's own close would be lost on the way.
    const socket: ChatSocket = io({ closeOnBeforeunload: true });
    socketRef.current = socket;

    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // A failed join is tried again after 1, 2 and 4 seconds, then every 10 seconds, and at once
    // on every connect. Meanwhile the room shows "Reconnecting".
    const joinFailed = () => {
      failures += 1;
      setJoinFailures(failures);
      dispatch({ type: "connection", connection: "reconnecting" });
      retryTimer = setTimeout(join, retryDelayMs(failures));
    };

    // Runs on the first connect, on every reconnect (a new server socket is in no room) and on a
    // retry. "Connected" waits for the join ack, so nothing is sent before the server knows the
    // room. Without a connection it waits for the next connect.
    const join = async () => {
      clearTimeout(retryTimer);
      if (!socket.connected) {
        return;
      }
      let result: JoinResult;
      try {
        result = await socket.timeout(ackTimeoutMs).emitWithAck("room:join", {
          roomId,
          displayName,
          browserToken,
          since: lastMessageIdRef.current,
        });
      } catch {
        joinFailed();
        return;
      }
      if (!result.ok) {
        if (result.error === "ROOM_NOT_FOUND") {
          setRoomGone(true);
        } else {
          joinFailed();
        }
        return;
      }
      failures = 0;
      setJoinFailures(0);
      const messages = await decryptRecords(roomKey, result.messages);
      let lastId = 0;
      for (const message of messages) {
        lastId = Math.max(lastId, message.id);
      }
      setHistoryEndId((current) => Math.max(current, lastId));
      dispatch({ type: "received", messages });
      dispatch({ type: "joined", presenceKey: result.presenceKey });
    };

    retryJoinRef.current = () => {
      failures = 0;
      setJoinFailures(0);
      join();
    };

    // socket.active is true while Socket.IO keeps retrying, false once it has given up.
    const handleConnectionLost = () => {
      dispatch({ type: "connection", connection: socket.active ? "reconnecting" : "disconnected" });
    };

    const handleNewMessage = async (record: RoomRecord) => {
      dispatch({ type: "received", messages: [await decryptRecord(roomKey, record)] });
    };

    socket.on("connect", join);
    socket.on("disconnect", handleConnectionLost);
    socket.on("connect_error", handleConnectionLost);
    socket.on("message:new", handleNewMessage);
    // Replaces the whole list. After a disconnect the old list stays until this arrives again.
    socket.on("room:presence", (participants) => dispatch({ type: "presence", participants }));

    return () => {
      clearTimeout(retryTimer);
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

  const saveLink = () => {
    dispatch({ type: "linkSaved" });
  };

  // One copy for the header, the share panel and the leave dialog. The link is the page address,
  // which includes the key after #. Returns false when the fallback panel had to show it.
  const copyLink = async (trigger: HTMLElement | null) => {
    const link = location.href;
    copyTriggerRef.current = trigger;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      setFallbackLink(link);
      return false;
    }
    setFallbackLink(null);
    setCopied(true);
    setToast({ id: Date.now(), text: "Link copied" });
    saveLink();
    return true;
  };

  const closeFallback = () => {
    setFallbackLink(null);
    copyTriggerRef.current?.focus();
  };

  // An AbortError means the user closed the share sheet: not an error, and nothing was shared.
  const shareLink = async () => {
    try {
      await navigator.share({ url: location.href });
    } catch {
      return;
    }
    saveLink();
  };

  // The share panel shows from the join ack until the first message. Events do not count.
  const hasMessages = state.pending.length > 0 || state.messages.some((record) => record.kind === "message");
  const showSharePanel = state.historyLoaded && !hasMessages;
  const listNote = !state.historyLoaded && loadingIsSlow ? "Loading messages..." : null;

  // The hooks above stay mounted behind these screens, so the retries go on.
  if (roomGone) {
    return (
      <StateScreen
        title="Room not found"
        message="No room matches this link. Check that you have the whole link, or ask the person who shared it to send it again."
      />
    );
  }
  if (joinFailures >= failuresBeforeErrorScreen && state.connection !== "connected") {
    return (
      <StateScreen
        title="Could not load the room"
        message="The server did not answer. Check your connection and try again."
        action={{ label: "Try again", onClick: () => retryJoinRef.current() }}
      />
    );
  }

  // While the room lookup is tried again, the layout already shows "Reconnecting".
  const connection = !roomKey && lookupRetrying ? "reconnecting" : state.connection;

  return (
    <div className="room">
      <RoomHeader
        roomName={roomName}
        connection={connection}
        participantCount={state.participants.length}
        panelId={panelId}
        panelOpen={panelOpen}
        participantButtonRef={participantButtonRef}
        copied={copied}
        fallbackLink={fallbackLink}
        onTogglePanel={handleTogglePanel}
        onCopy={copyLink}
        onCloseFallback={closeFallback}
        onLeave={handleLeave}
      />
      <main className="room-body">
        <div className="conversation">
          <MessageList
            messages={state.messages}
            pending={state.pending}
            displayName={displayName}
            presenceKey={state.presenceKey}
            historyEndId={historyEndId}
            note={listNote}
            top={
              showSharePanel && (
                <SharePanel link={location.href} copied={copied} onCopy={copyLink} onShare={shareLink} />
              )
            }
            toast={<Toast message={toast} onDismiss={() => setToast(null)} />}
            onRetry={handleRetry}
            onTypeToComposer={(text) => composerRef.current?.focusAndType(text)}
          />
          <Composer ref={composerRef} connection={connection} blockedReason={null} onSend={handleSend} />
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
