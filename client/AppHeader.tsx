import type { MouseEvent, ReactNode } from "react";
import { navigate } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

// The favicon's speech bubble with a keyhole.
function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        fillRule="evenodd"
        d="M7 3h18a5 5 0 0 1 5 5v11a5 5 0 0 1-5 5H13l-6 5v-5a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm9 5a3 3 0 0 0-1.6 5.5L13.5 19h5l-0.9-5.5A3 3 0 0 0 16 8Z"
      />
    </svg>
  );
}

type AppHeaderProps = {
  children?: ReactNode;
  // In a room the logo link leaves it, so the room decides (it may ask first).
  onLeave?: (trigger: HTMLElement) => void;
};

// The header on every screen. Without children it holds only the theme toggle on the right.
export function AppHeader({ children, onLeave }: AppHeaderProps) {
  // A plain click stays in the app. A click that opens a new tab or window keeps the browser default.
  const handleHomeClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (onLeave) {
      onLeave(event.currentTarget);
    } else {
      navigate("/");
    }
  };

  return (
    <header className="app-header">
      <a className="logo" href="/" onClick={handleHomeClick}>
        <LogoMark />
        <span className="logo-text">Speakeasy</span>
      </a>
      {children ?? (
        <div className="header-actions">
          <ThemeToggle />
        </div>
      )}
    </header>
  );
}
