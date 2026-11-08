import { type FormEvent, useState } from "react";

const storageKey = "speakeasy:displayName";
const maxNameLength = 32;

function isValidName(name: string) {
  return name.length >= 1 && name.length <= maxNameLength;
}

// Storage can throw (blocked site data, some private windows), so both helpers fail quietly.
export function readStoredName(): string | null {
  try {
    const name = localStorage.getItem(storageKey)?.trim() ?? "";
    return isValidName(name) ? name : null;
  } catch {
    return null;
  }
}

function storeName(name: string) {
  try {
    localStorage.setItem(storageKey, name);
  } catch {
    // The name still works for this visit.
  }
}

export function NamePrompt({ onSubmit }: { onSubmit: (displayName: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = name.trim();
    if (!isValidName(displayName)) {
      setError(`Enter a name of 1 to ${maxNameLength} characters.`);
      return;
    }
    storeName(displayName);
    onSubmit(displayName);
  };

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Your name{" "}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={maxNameLength}
          autoComplete="nickname"
          autoFocus
        />
      </label>{" "}
      <button type="submit">Join</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
