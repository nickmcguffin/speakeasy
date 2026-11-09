import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Participant } from "../shared/types.js";

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
        {/* Nothing until the first list arrives. */}
        <h2>
          {participants.length > 0 &&
            `${participants.length} ${participants.length === 1 ? "person" : "people"} here`}
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
        {participants.map((participant) => (
          <li key={participant.presenceKey}>
            {participant.name}
            {participant.presenceKey === presenceKey && <span className="muted"> (you)</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
