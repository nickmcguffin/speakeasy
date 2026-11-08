// All Web Crypto use is in this module. Messages are encrypted with AES-GCM and a 256-bit
// room key that lives in the link fragment. The server only ever sees ciphertext and IVs.

export type RoomKey = CryptoKey;

export type EncryptedText = { ciphertext: string; iv: string };

const algorithm = "AES-GCM";
const keyLengthBytes = 32;
const ivLengthBytes = 12;

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

// Throws on characters outside base64.
function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// Returns the key encoded for the link fragment: 32 bytes as 43 base64url characters.
export async function generateKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: algorithm, length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64url(new Uint8Array(raw));
}

// Throws on anything that is not exactly the encoding generateKey returns. atob also accepts
// whitespace, padding, "+" and "/", so the decoded bytes must encode back to the same text.
export async function importKey(encodedKey: string): Promise<RoomKey> {
  const raw = fromBase64url(encodedKey);
  if (raw.length !== keyLengthBytes || toBase64url(raw) !== encodedKey) {
    throw new Error("Invalid room key");
  }
  return crypto.subtle.importKey("raw", raw, { name: algorithm }, false, ["encrypt", "decrypt"]);
}

// A new random IV for every message. Reusing an IV with the same key breaks AES-GCM.
export async function encrypt(key: RoomKey, text: string): Promise<EncryptedText> {
  const iv = crypto.getRandomValues(new Uint8Array(ivLengthBytes));
  const ciphertext = await crypto.subtle.encrypt(
    { name: algorithm, iv },
    key,
    new TextEncoder().encode(text),
  );
  return { ciphertext: toBase64url(new Uint8Array(ciphertext)), iv: toBase64url(iv) };
}

// Throws on a wrong key or tampered data, because the AES-GCM tag check fails.
export async function decrypt(key: RoomKey, { ciphertext, iv }: EncryptedText): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: algorithm, iv: fromBase64url(iv) },
    key,
    fromBase64url(ciphertext),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}
