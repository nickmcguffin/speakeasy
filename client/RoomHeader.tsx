import { Check, Link, LogOut, Users, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef } from "react";
import { AppHeader } from "./AppHeader";
import type { ConnectionState } from "./roomState";
import { ThemeToggle } from "./ThemeToggle";

const connectionLabels: Record<ConnectionState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

type RoomHeaderProps = {
  roomName: string | null; // null until the name is decrypted
  connection: ConnectionState;
  participantCount: number;
  panelId: string;
  panelOpen: boolean;
  participantButtonRef: RefObject<HTMLButtonElement | null>;
  copied: boolean; // "Copied" with a tick for 2 seconds after a successful copy
  fallbackLink: string | null; // set when the Clipboard API failed: the link to copy by hand
  onTogglePanel: () => void;
  onCopy: (trigger: HTMLElement) => void;
  onCloseFallback: () => void;
  onLeave: (trigger: HTMLElement) => void; // the Leave room button and the logo link
};

export function RoomHeader({
  roomName,
  connection,
  participantCount,
  panelId,
  panelOpen,
  participantButtonRef,
  copied,
  fallbackLink,
  onTogglePanel,
  onCopy,
  onCloseFallback,
  onLeave,
}: RoomHeaderProps) {
  const linkFieldRef = useRef<HTMLInputElement>(null);
  const linkFieldId = useId();

  // The field takes focus after the commit, so it also works when a modal dialog closes in the
  // same update (a field inside an inert page cannot take focus).
  useEffect(() => {
    if (fallbackLink) {
      linkFieldRef.current?.focus();
    }
  }, [fallbackLink]);

  const handleFallbackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onCloseFallback();
    }
  };

  const copyLabel = copied ? "Copied" : "Copy link";
  const peopleLabel = `${participantCount} ${participantCount === 1 ? "person" : "people"} here`;

  return (
    <>
      <AppHeader onLeave={onLeave}>
        <div className="room-title">
          <h1 title={roomName ?? undefined}>{roomName}</h1>
          <p className="connection" data-state={connection} role="status">
            <span className="connection-dot" aria-hidden="true" />
            {connectionLabels[connection]}
          </p>
        </div>
        <div className="header-actions">
          <button
            ref={participantButtonRef}
            type="button"
            className="secondary participants-button"
            onClick={onTogglePanel}
            aria-label={peopleLabel}
            aria-expanded={panelOpen}
            aria-controls={panelId}
          >
            <Users size={18} aria-hidden="true" />
            {participantCount}
          </button>
          <button type="button" className="secondary" onClick={(event) => onCopy(event.currentTarget)} aria-label={copyLabel}>
            {copied ? <Check size={18} aria-hidden="true" /> : <Link size={18} aria-hidden="true" />}
            <span className="button-label">{copyLabel}</span>
          </button>
          <ThemeToggle />
          <button type="button" className="secondary" onClick={(event) => onLeave(event.currentTarget)} aria-label="Leave room">
            <LogOut size={18} aria-hidden="true" />
            <span className="button-label">Leave room</span>
          </button>
        </div>
      </AppHeader>
      {fallbackLink && (
        <div className="link-panel" onKeyDown={handleFallbackKeyDown}>
          <label htmlFor={linkFieldId}>Could not copy the link. Select it and copy it by hand.</label>
          <div className="link-panel-row">
            <input
              ref={linkFieldRef}
              id={linkFieldId}
              className="link-field"
              value={fallbackLink}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className="secondary icon-button" onClick={onCloseFallback} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
