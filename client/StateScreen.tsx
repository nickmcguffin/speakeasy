import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";

type StateScreenProps = {
  title: string;
  message: ReactNode; // one or two sentences: what happened and what to do
  action?: { label: string; onClick: () => void };
};

// The full-page screen for links and states that cannot show a room or the home page.
export function StateScreen({ title, message, action }: StateScreenProps) {
  return (
    <>
      <AppHeader />
      <main className="page state-screen">
        <h1>{title}</h1>
        {/* An alert, so a screen reader also hears it when Try again fails again. */}
        <p className="lead" role="alert">
          {message}
        </p>
        {action && (
          <button type="button" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </main>
    </>
  );
}
