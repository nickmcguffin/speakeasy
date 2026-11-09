import { useEffect, useRef } from "react";

export type ToastMessage = { id: number; text: string };

const visibleMs = 2500;

// A short message above the composer, in the message list's overlay stack. The live region stays
// in the page, so screen readers announce each new message. A new id restarts the timer, even
// with the same text.
export function Toast({ message, onDismiss }: { message: ToastMessage | null; onDismiss: () => void }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => onDismissRef.current(), visibleMs);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div className="toast-region" aria-live="polite">
      {message && <p className="toast">{message.text}</p>}
    </div>
  );
}
