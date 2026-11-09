import { SendHorizontal } from "lucide-react";
import {
  type KeyboardEvent,
  type Ref,
  type SubmitEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ConnectionState } from "./roomState";

const maxMessageLength = 2000;

const connectionNotes: Record<ConnectionState, string | null> = {
  connecting: "Connecting...",
  connected: null,
  reconnecting: "Reconnecting...",
  disconnected: "Disconnected. Reload the page to reconnect.",
};

// Lets the message list send keystrokes here: focus the field and add text at the end.
export type ComposerHandle = { focusAndType: (text: string) => void };

type ComposerProps = {
  connection: ConnectionState;
  blockedReason: string | null; // why sending is off even with a connection, shown above the field
  onSend: (body: string) => void;
  ref?: Ref<ComposerHandle>;
};

export function Composer({ connection, blockedReason, onSend, ref }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const errorId = useId();
  const canSend = connection === "connected" && !blockedReason;

  // Setting the value moves the caret to the end, after the added text.
  useImperativeHandle(ref, () => ({
    focusAndType(text: string) {
      fieldRef.current?.focus();
      if (text) {
        setDraft((current) => current + text);
      }
    },
  }), []);

  // The field grows with its text. CSS caps it at about 5 lines, and then it scrolls.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) {
      return;
    }
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }, [draft]);

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
    onSend(body);
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
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

  const connectionNote = connectionNotes[connection];

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-inner">
        {blockedReason ? (
          <p className="muted composer-note">{blockedReason}</p>
        ) : (
          connectionNote && <p className="muted composer-note">{connectionNote}</p>
        )}
        {draftError && (
          <p id={errorId} role="alert" className="error composer-note">
            {draftError}
          </p>
        )}
        <div className="composer-row">
          <label htmlFor={fieldId} className="visually-hidden">
            Message
          </label>
          <textarea
            ref={fieldRef}
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={blockedReason !== null}
            placeholder="Message"
            aria-invalid={draftError !== null}
            aria-describedby={draftError ? errorId : undefined}
          />
          <button type="submit" className="send-button" disabled={!canSend} aria-label="Send">
            <SendHorizontal size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  );
}
