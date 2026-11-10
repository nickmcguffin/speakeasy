import { describe, expect, test } from "vitest";
import { decrypt, encrypt, generateKey, importKey } from "../../client/crypto";

// 32 bytes of 0xfb encode to "-_v7-_v7...": a valid key that contains both "-" and "_".
const validKey = Buffer.alloc(32, 0xfb).toString("base64url");

describe("crypto", () => {
  test("decrypting an encrypted text gives the same text", async () => {
    const key = await importKey(await generateKey());
    const text = "Hello, wörld 👋\nSecond line";

    expect(await decrypt(key, await encrypt(key, text))).toBe(text);
  });

  test("every encryption uses a new 12-byte IV", async () => {
    const key = await importKey(await generateKey());
    const first = await encrypt(key, "same text");
    const second = await encrypt(key, "same text");

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(Buffer.from(first.iv, "base64url")).toHaveLength(12);
  });

  test("generateKey makes a 43-character base64url key that importKey accepts", async () => {
    const encodedKey = await generateKey();

    expect(encodedKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(importKey(encodedKey)).resolves.toBeDefined();
    await expect(importKey(validKey)).resolves.toBeDefined();
  });

  test.each([
    ["padding", `${validKey}=`],
    ["a + instead of -", validKey.replaceAll("-", "+")],
    ["a / instead of _", validKey.replaceAll("_", "/")],
    ["whitespace", ` ${validKey}`],
    ["42 characters", validKey.slice(0, 42)],
    ["44 characters", `${validKey}A`],
    ["no characters", ""],
  ])("importKey rejects a key with %s", async (_label, encodedKey) => {
    await expect(importKey(encodedKey)).rejects.toThrow();
  });

  test("decrypting with a different key throws", async () => {
    const key = await importKey(await generateKey());
    const otherKey = await importKey(await generateKey());
    const encrypted = await encrypt(key, "secret");

    await expect(decrypt(otherKey, encrypted)).rejects.toThrow();
  });

  test("decrypting tampered ciphertext throws", async () => {
    const key = await importKey(await generateKey());
    const encrypted = await encrypt(key, "secret");
    const firstCharacter = encrypted.ciphertext[0] === "A" ? "B" : "A";
    const tampered = { ...encrypted, ciphertext: firstCharacter + encrypted.ciphertext.slice(1) };

    await expect(decrypt(key, tampered)).rejects.toThrow();
  });
});
