import { Check, Link, Share2 } from "lucide-react";

type SharePanelProps = {
  link: string; // the full room link, with the key after #
  copied: boolean;
  onCopy: (trigger: HTMLElement) => void;
  onShare: () => void;
};

// At the top of the message list until the first message: the link with its key highlighted,
// and the ways to send it. "Share" only where the browser has the Web Share API.
export function SharePanel({ link, copied, onCopy, onShare }: SharePanelProps) {
  const hashIndex = link.indexOf("#");
  const address = link.slice(0, hashIndex + 1);
  const key = link.slice(hashIndex + 1);
  const canShare = typeof navigator.share === "function";

  return (
    <section className="share-panel" aria-label="Share this room">
      <p className="share-link">
        {address}
        <span className="share-key">{key}</span>
      </p>
      <p className="muted share-note">The part after # is the key. It never leaves your browser.</p>
      <div className="share-actions">
        <button type="button" onClick={(event) => onCopy(event.currentTarget)}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Link size={18} aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button type="button" className="secondary" onClick={onShare}>
            <Share2 size={18} aria-hidden="true" />
            Share
          </button>
        )}
      </div>
    </section>
  );
}
