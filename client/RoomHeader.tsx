import { Check, Link, LogOut, Users, X } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import type { ConnectionState } from "./roomState";
import { ThemeToggle } from "./ThemeToggle";

const connectionLabels: Record<ConnectionState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

const copiedMs = 2000;

type RoomHeaderProps = {
  roomName: string | null; // null until the name is decrypted
  connection: ConnectionState;
  participantCount: number;
  panelId: string;
  panelOpen: boolean;
  participantButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenPanel: () => void;
  onLinkSaved: () => void;
  onLeave: () => void;
};

export function RoomHeader({
  roomName,
  connection,
  participantCount,
  panelId,
  panelOpen,
  participantButtonRef,
  onOpenPanel,
  onLinkSaved,
  onLeave,
}: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);
  // Set when the Clipboard API fails, so the user can copy the link by hand.
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const linkFieldId = useId();

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), copiedMs);
    return () => clearTimeout(timer);
  }, [copied]);

  // The link is the page address, which includes the key after #.
  const handleCopy = async () => {
    const link = location.href;
    try {
      await navigator.clipboard.writeText(link);
      setFallbackLink(null);
      setCopied(true);
      onLinkSaved();
    } catch {
      setFallbackLink(link);
    }
  };

  const closeFallback = () => {
    setFallbackLink(null);
    copyButtonRef.current?.focus();
  };

  const handleFallbackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      closeFallback();
    }
  };

  const copyLabel = copied ? "Copied" : "Copy link";
  const peopleLabel = `${participantCount} ${participantCount === 1 ? "person" : "people"} here`;

  return (
    <>
      <AppHeader>
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
            onClick={onOpenPanel}
            aria-label={peopleLabel}
            aria-expanded={panelOpen}
            aria-controls={panelId}
          >
            <Users size={18} aria-hidden="true" />
            {participantCount}
          </button>
          <button ref={copyButtonRef} type="button" className="secondary" onClick={handleCopy} aria-label={copyLabel}>
            {copied ? <Check size={18} aria-hidden="true" /> : <Link size={18} aria-hidden="true" />}
            <span className="button-label">{copyLabel}</span>
          </button>
          <ThemeToggle />
          <button type="button" className="secondary" onClick={onLeave} aria-label="Leave room">
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
              id={linkFieldId}
              className="link-field"
              value={fallbackLink}
              readOnly
              autoFocus
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className="secondary icon-button" onClick={closeFallback} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
