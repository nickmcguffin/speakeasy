import { type KeyboardEvent, type RefObject, useId, useLayoutEffect, useRef } from "react";

type LeaveDialogProps = {
  open: boolean;
  returnFocusTo: RefObject<HTMLElement | null>; // the Leave button or logo link that opened it
  onCopyAndLeave: () => void;
  onLeaveAnyway: () => void;
  onStay: () => void;
};

// Asks before leaving a room that this tab created and whose link was never saved: without the
// link nobody can come back. A native modal dialog, so focus stays inside it, and Escape is Stay.
export function LeaveDialog({ open, returnFocusTo, onCopyAndLeave, onLeaveAnyway, onStay }: LeaveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();

  // A layout effect, so the dialog is closed before other effects move focus (for example to the
  // copy fallback field), which an inert page would refuse.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      primaryRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusTo.current?.focus();
    }
  }, [open, returnFocusTo]);

  // Tab and Shift+Tab go round the dialog's buttons, instead of out to the browser.
  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") {
      return;
    }
    const buttons = dialogRef.current?.querySelectorAll("button");
    if (!buttons || buttons.length === 0) {
      return;
    }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="leave-dialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        // Escape: stay. The state closes the dialog, so it does not close twice.
        event.preventDefault();
        onStay();
      }}
    >
      <h2 id={titleId}>Save the link before you leave?</h2>
      <p id={textId}>You have not copied the link for this room. Without it, you cannot come back, and nobody can recover it.</p>
      <div className="dialog-actions">
        <button ref={primaryRef} type="button" onClick={onCopyAndLeave}>
          Copy link and leave
        </button>
        <button type="button" className="secondary" onClick={onLeaveAnyway}>
          Leave anyway
        </button>
        <button type="button" className="secondary" onClick={onStay}>
          Stay
        </button>
      </div>
    </dialog>
  );
}
