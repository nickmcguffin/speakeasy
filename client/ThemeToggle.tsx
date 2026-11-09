import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const storageKey = "speakeasy:theme";
const darkQuery = "(prefers-color-scheme: dark)";

// The theme on screen: the saved choice, which the script in index.html put on <html> before the
// first paint, or else the system setting.
function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") {
    return chosen;
  }
  return matchMedia(darkQuery).matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);

  // Until the user chooses, the page follows the system setting, and so does this button.
  useEffect(() => {
    const media = matchMedia(darkQuery);
    const handleChange = () => setTheme(currentTheme());
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const nextTheme: Theme = theme === "dark" ? "light" : "dark";

  const handleClick = () => {
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem(storageKey, nextTheme);
    } catch {
      // The choice still applies to this page.
    }
    setTheme(nextTheme);
  };

  return (
    <button type="button" className="secondary icon-button" onClick={handleClick} aria-label={`Switch to ${nextTheme} theme`}>
      {nextTheme === "dark" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
    </button>
  );
}
