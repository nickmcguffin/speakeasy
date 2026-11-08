import type { JoinPayload, SendPayload } from "../shared/types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 16 base64url characters without padding decode to exactly 12 bytes.
const ivPattern = /^[A-Za-z0-9_-]{16}$/;
const ciphertextPattern = /^[A-Za-z0-9_-]{1,12000}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Socket payloads come from the client, so they are checked as unknown, whatever the event types say.
export function parseJoinPayload(payload: unknown): JoinPayload | null {
  if (!isObject(payload) || !isUuid(payload.roomId) || typeof payload.displayName !== "string") {
    return null;
  }

  const displayName = payload.displayName.trim();
  if (displayName.length < 1 || displayName.length > 32) {
    return null;
  }

  const { since } = payload;
  if (since !== undefined && !(Number.isSafeInteger(since) && (since as number) >= 0)) {
    return null;
  }

  return { roomId: payload.roomId, displayName, since: since as number | undefined };
}

export function parseSendPayload(payload: unknown): SendPayload | null {
  if (!isObject(payload)) {
    return null;
  }

  const { clientId, ciphertext, iv } = payload;
  if (!isUuid(clientId)) {
    return null;
  }
  if (typeof iv !== "string" || !ivPattern.test(iv)) {
    return null;
  }
  if (typeof ciphertext !== "string" || !ciphertextPattern.test(ciphertext)) {
    return null;
  }

  return { clientId, ciphertext, iv };
}
