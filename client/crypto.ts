// TEMPORARY STAND-IN. THIS DOES NOT ENCRYPT ANYTHING. Step 6 replaces it with AES-GCM.
// Only the async API is final: generateKey, importKey, encrypt and decrypt.
// Here "ciphertext" is just the base64url UTF-8 text, and the key is ignored.

export type RoomKey = { readonly temporary: true }; // becomes CryptoKey in step 6

export type EncryptedText = { ciphertext: string; iv: string };

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

function fromBase64url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// Returns the encoded key for the link fragment.
export async function generateKey(): Promise<string> {
  return "temporary";
}

export async function importKey(_encodedKey: string): Promise<RoomKey> {
  return { temporary: true };
}

export async function encrypt(
  _key: RoomKey,
  text: string,
): Promise<EncryptedText> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    ciphertext: toBase64url(new TextEncoder().encode(text)),
    iv: toBase64url(iv),
  };
}

// Throws when the data cannot be decoded, as real decryption throws on a bad key or tag.
export async function decrypt(
  _key: RoomKey,
  { ciphertext }: EncryptedText,
): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    fromBase64url(ciphertext),
  );
}
