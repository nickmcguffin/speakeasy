import { ArrowDown } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatRecord, PendingMessage, SendFailure } from "./roomState";

const failureText: Record<SendFailure, string> = {
  network: "Failed to send. Check your connection.",
  server: "Failed to send. The server had a problem.",
  invalid: "Failed to send. The server did not accept this message.",
};

// Within this distance of the end, the list counts as at the bottom.
const bottomSlackPx = 48;
// A longer pause between two messages starts a new group, even from the same author.
const groupGapMs = 2 * 60 * 1000;

type MessageItemProps = {
  author: string;
  mine: boolean;
  groupStart: boolean;
  groupEnd: boolean;
  isNew: boolean;
  body: string | null;
  time: string;
  sending: boolean;
  failure?: SendFailure;
  onRetry?: () => void;
};

// One message before grouping: confirmed messages first, then pending ones.
// authorId tells authors apart: the author key, or the name for rows from before author keys.
type MessageEntry = Omit<MessageItemProps, "groupStart" | "groupEnd"> & { kind: "message"; key: string; authorId: string };
// "Bob joined the room": small, centred, no time.
type EventEntry = { kind: "event"; key: string; text: string; isNew: boolean };
type Entry = MessageEntry | EventEntry;

// A new group starts when the author changes, after a long pause, or after a join or leave event.
function startsGroup(previous: Entry | undefined, entry: MessageEntry) {
  if (!previous || previous.kind === "event" || previous.authorId !== entry.authorId) {
    return true;
  }
  return Date.parse(entry.time) - Date.parse(previous.time) > groupGapMs;
}

function EventItem({ text, isNew }: { text: string; isNew: boolean }) {
  return <li className={isNew ? "event new" : "event"}>{text}</li>;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function MessageItem({ author, mine, groupStart, groupEnd, isNew, body, time, sending, failure, onRetry }: MessageItemProps) {
  let className = mine ? "message mine" : "message";
  if (groupStart) {
    className += " group-start";
  }
  if (isNew) {
    className += " new";
  }

  return (
    <li className={className}>
      <div className="bubble">
        {/* The name shows on the first message of a group. Your own groups are named for screen readers only. */}
        {groupStart && <p className={mine ? "visually-hidden" : "message-author"}>{mine ? "You" : author}</p>}
        {body === null ? (
          <p className="message-text placeholder">Unable to decrypt this message</p>
        ) : (
          <p className="message-text">{body}</p>
        )}
        {/* The time shows once, on the last message of the group. */}
        {(groupEnd || sending) && (
          <p className="message-meta">
            {groupEnd && <time dateTime={time}>{formatTime(time)}</time>}
            {groupEnd && sending && " · "}
            {sending && "Sending..."}
          </p>
        )}
      </div>
      {failure && (
        <div className="message-failed">
          <p className="error">{failureText[failure]}</p>
          {failure !== "invalid" && (
            <button type="button" className="secondary small" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
    </li>
  );
}

type MessageListProps = {
  messages: ChatRecord[];
  pending: PendingMessage[];
  displayName: string;
  presenceKey: string | null; // this browser's author key: its messages and events are "yours"
  historyEndId: number; // messages up to this id came with a join and do not slide in
  note: string | null; // "Loading messages...", centred in the list
  top: ReactNode; // the share panel while the room has no messages
  toast: ReactNode; // shown under "New messages" in one stack above the composer
  onRetry: (message: PendingMessage) => void;
  onTypeToComposer: (text: string) => void; // focuses the composer and adds the text
};

export function MessageList({
  messages,
  pending,
  displayName,
  presenceKey,
  historyEndId,
  note,
  top,
  toast,
  onRetry,
  onTypeToComposer,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const newMessagesButtonRef = useRef<HTMLButtonElement>(null);
  // Updated on scroll, so it describes the list before the latest render added anything.
  const atBottomRef = useRef(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  const lastMessageId = messages.at(-1)?.id;
  const lastPendingId = pending.at(-1)?.clientId;
  const seenPendingIdRef = useRef(lastPendingId);
  // Only a new message from someone else offers "New messages". Events and your own messages do not.
  let lastOtherMessageId: number | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const record = messages[index];
    if (record.kind === "message" && !(record.authorKey !== null && record.authorKey === presenceKey)) {
      lastOtherMessageId = record.id;
      break;
    }
  }
  const seenOtherMessageIdRef = useRef(lastOtherMessageId);

  const scrollToBottom = () => {
    const scroller = scrollRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    atBottomRef.current = true;
    setHasNewBelow(false);
  };

  // Your own new message always scrolls down. Other new messages scroll down only when the list
  // was already at the bottom. Otherwise the list stays put and offers "New messages".
  useLayoutEffect(() => {
    if (lastPendingId && lastPendingId !== seenPendingIdRef.current) {
      seenPendingIdRef.current = lastPendingId;
      scrollToBottom();
      return;
    }
    if (atBottomRef.current) {
      scrollToBottom();
    } else if (lastOtherMessageId !== undefined && lastOtherMessageId !== seenOtherMessageIdRef.current) {
      setHasNewBelow(true);
    }
    seenOtherMessageIdRef.current = lastOtherMessageId;
  }, [lastMessageId, lastPendingId]);

  // The list area shrinks when the composer grows or the mobile keyboard opens. Stay at the bottom.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= bottomSlackPx;
    atBottomRef.current = atBottom;
    if (atBottom) {
      setHasNewBelow(false);
    }
  };

  // The button disappears, so focus moves to the list instead of being lost.
  const handleNewMessagesClick = () => {
    const hadFocus = document.activeElement === newMessagesButtonRef.current;
    scrollToBottom();
    if (hadFocus) {
      scrollRef.current?.focus({ preventScroll: true });
    }
  };

  // The list is focusable so the keyboard can scroll it, and a click in it focuses it. Typing
  // there goes to the composer: Enter moves focus, and a printable character is also added to the
  // draft. Space, arrows, Page Up/Down, Home, End, Tab and shortcuts such as Ctrl+C keep their
  // normal behaviour. Keys on a control inside the list (Retry) are left alone.
  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onTypeToComposer("");
    } else if (event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      onTypeToComposer(event.key);
    }
  };

  // Yours: the row's author key is this browser's. A row without an author key (from before
  // author keys) is never yours, whatever its name.
  const entries: Entry[] = [];
  for (const record of messages) {
    const mine = record.authorKey !== null && record.authorKey === presenceKey;
    if (record.kind !== "message") {
      const who = mine ? "You" : record.authorName;
      entries.push({
        kind: "event",
        key: `event-${record.id}`,
        text: `${who} ${record.kind === "join" ? "joined" : "left"} the room`,
        isNew: record.id > historyEndId,
      });
      continue;
    }
    entries.push({
      kind: "message",
      key: record.clientId,
      authorId: record.authorKey ?? `name:${record.authorName}`,
      author: record.authorName,
      mine,
      isNew: record.id > historyEndId,
      body: record.body,
      time: record.createdAt,
      sending: false,
    });
  }
  for (const message of pending) {
    entries.push({
      kind: "message",
      key: message.clientId,
      authorId: presenceKey ?? "you",
      author: displayName,
      mine: true,
      isNew: true,
      body: message.body,
      time: message.queuedAt,
      sending: message.status === "sending",
      failure: message.status === "failed" ? message.failure : undefined,
      onRetry: () => onRetry(message),
    });
  }

  // One list, keyed by clientId, so a pending message that is confirmed keeps its element and
  // does not slide in twice.
  const items: ReactNode[] = [];
  for (let index = 0; index < entries.length; index++) {
    const current = entries[index];
    if (current.kind === "event") {
      items.push(<EventItem key={current.key} text={current.text} isNew={current.isNew} />);
      continue;
    }
    const { key, kind: _kind, authorId: _authorId, ...entry } = current;
    const next = entries[index + 1];
    items.push(
      <MessageItem
        key={key}
        {...entry}
        groupStart={startsGroup(entries[index - 1], current)}
        groupEnd={!next || next.kind === "event" || startsGroup(current, next)}
      />,
    );
  }

  return (
    <div className="message-area">
      <div
        ref={scrollRef}
        className="message-scroll"
        onScroll={handleScroll}
        onKeyDown={handleListKeyDown}
        tabIndex={0}
        role="region"
        aria-label="Conversation"
      >
        {top}
        {note && <p className="empty-note">{note}</p>}
        <ol className="messages" role="log" aria-label="Messages">
          {items}
        </ol>
      </div>
      {/* One stack, so "New messages" and the toast never cover each other. */}
      <div className="list-overlay">
        {hasNewBelow && (
          <button ref={newMessagesButtonRef} type="button" className="new-messages" onClick={handleNewMessagesClick}>
            <ArrowDown size={16} aria-hidden="true" />
            New messages
          </button>
        )}
        {toast}
      </div>
    </div>
  );
}
