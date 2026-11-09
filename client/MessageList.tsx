import { ArrowDown } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, PendingMessage, SendFailure } from "./roomState";

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
type Entry = Omit<MessageItemProps, "groupStart" | "groupEnd"> & { key: string };

// A new group starts when the author changes or after a long pause. After step 7e, an event
// between two messages will also start one.
function startsGroup(previous: Entry | undefined, entry: Entry) {
  if (!previous || previous.author !== entry.author) {
    return true;
  }
  return Date.parse(entry.time) - Date.parse(previous.time) > groupGapMs;
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
  messages: ChatMessage[];
  pending: PendingMessage[];
  displayName: string;
  historyEndId: number; // messages up to this id came with a join and do not slide in
  onRetry: (message: PendingMessage) => void;
};

export function MessageList({ messages, pending, displayName, historyEndId, onRetry }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const newMessagesButtonRef = useRef<HTMLButtonElement>(null);
  // Updated on scroll, so it describes the list before the latest render added anything.
  const atBottomRef = useRef(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  const lastMessageId = messages.at(-1)?.id;
  const lastPendingId = pending.at(-1)?.clientId;
  const seenPendingIdRef = useRef(lastPendingId);

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
    } else if (lastMessageId !== undefined) {
      setHasNewBelow(true);
    }
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
      listRef.current?.focus({ preventScroll: true });
    }
  };

  const entries: Entry[] = [];
  for (const message of messages) {
    entries.push({
      key: message.clientId,
      author: message.authorName,
      mine: message.authorName === displayName,
      isNew: message.id > historyEndId,
      body: message.body,
      time: message.createdAt,
      sending: false,
    });
  }
  for (const message of pending) {
    entries.push({
      key: message.clientId,
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
    const { key, ...entry } = entries[index];
    const next = entries[index + 1];
    items.push(
      <MessageItem
        key={key}
        {...entry}
        groupStart={startsGroup(entries[index - 1], entries[index])}
        groupEnd={!next || startsGroup(entries[index], next)}
      />,
    );
  }

  return (
    <div className="message-area">
      <div ref={scrollRef} className="message-scroll" onScroll={handleScroll}>
        {items.length === 0 && <p className="empty-note">No messages yet.</p>}
        <ol ref={listRef} className="messages" role="log" aria-label="Messages" tabIndex={-1}>
          {items}
        </ol>
      </div>
      {hasNewBelow && (
        <button ref={newMessagesButtonRef} type="button" className="new-messages" onClick={handleNewMessagesClick}>
          <ArrowDown size={16} aria-hidden="true" />
          New messages
        </button>
      )}
    </div>
  );
}
