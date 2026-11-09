import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Participant } from "../shared/types.js";

// The first character of the first two words. Array.from splits by code point, so an emoji is
// not cut in half.
function initials(name: string) {
  let result = "";
  for (const word of name.trim().split(/\s+/).slice(0, 2)) {
    result += Array.from(word)[0] ?? "";
  }
  return result.toLocaleUpperCase();
}

type ParticipantPanelProps = {
  id: string;
  participants: Participant[];
  presenceKey: string | null;
  open: boolean;
  onClose: () => void;
};

// A side panel from 900px wide. Narrower, it is hidden until the header button opens it over the
// messages, and Escape or the close button closes it.
export function ParticipantPanel({ id, participants, presenceKey, open, onClose }: ParticipantPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // The effect below runs only when the panel opens or closes, so it reads the latest onClose here.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <aside id={id} className={open ? "participants open" : "participants"} aria-label="People in this room">
      <div className="participants-header">
        {/* The visible word and badge are hidden from screen readers, which hear one text instead:
            "Participants, 3 people". Separate pieces in a flex heading would be read with a space
            before the comma. No count until the first list arrives. */}
        <h2>
          <span aria-hidden="true">Participants</span>
          {participants.length > 0 && (
            <span className="count-badge" aria-hidden="true">
              {participants.length}
            </span>
          )}
          <span className="visually-hidden">
            Participants
            {participants.length > 0 &&
              `, ${participants.length} ${participants.length === 1 ? "person" : "people"}`}
          </span>
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          className="secondary icon-button panel-close"
          onClick={onClose}
          aria-label="Close people list"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <ul>
        {participants.map((participant) => {
          const isYou = participant.presenceKey === presenceKey;
          return (
            <li key={participant.presenceKey}>
              <span className={isYou ? "avatar you" : "avatar"} aria-hidden="true">
                {initials(participant.name)}
              </span>
              <span className="participant-name">
                {participant.name}
                {isYou && <span className="muted"> (you)</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
