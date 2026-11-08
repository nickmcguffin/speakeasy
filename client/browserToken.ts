// One random token per browser, kept in localStorage and shared by all its tabs. The server
// groups a browser's connections into one participant by it, so a second or duplicated tab and
// a refresh never show the person twice. The server never sends it to other clients.
// This is not the room key. The key is never stored.

const storageKey = "speakeasy:browserToken";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Used when storage is blocked: still one token for this page, but other tabs get their own.
let memoryToken: string | null = null;

export function getBrowserToken(): string {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored && uuidPattern.test(stored)) {
      return stored;
    }
    const token = crypto.randomUUID();
    localStorage.setItem(storageKey, token);
    return token;
  } catch {
    memoryToken ??= crypto.randomUUID();
    return memoryToken;
  }
}
