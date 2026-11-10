import { describe, expect, test } from "vitest";
import { decrypt, encrypt, generateKey, importKey } from "../../client/crypto";
import { isUuid, parseCreateRoomBody, parseJoinPayload, parseSendPayload } from "../../server/validation";

const roomId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const browserToken = "16fd2706-8baf-433b-82eb-8c7fada847da";
const clientId = "a8098c1a-f86e-41da-9b6c-7f6c1e2a3b4d";
const iv = "AAAAAAAAAAAAAAAA"; // 16 characters, 12 bytes

function join(changes: Record<string, unknown>) {
  return parseJoinPayload({ roomId, displayName: "Ada", browserToken, ...changes });
}

function send(changes: Record<string, unknown>) {
  return parseSendPayload({ clientId, ciphertext: "abc", iv, ...changes });
}

describe("room:join validation", () => {
  test("a display name of 1 to 32 characters is accepted and trimmed", () => {
    expect(join({ displayName: "A" })?.displayName).toBe("A");
    expect(join({ displayName: `  ${"x".repeat(32)}  ` })?.displayName).toBe("x".repeat(32));
  });

  test("an empty, blank or 33-character display name is rejected", () => {
    expect(join({ displayName: "" })).toBeNull();
    expect(join({ displayName: "   " })).toBeNull();
    expect(join({ displayName: "x".repeat(33) })).toBeNull();
  });

  test("roomId and browserToken must be UUIDs", () => {
    expect(isUuid(roomId)).toBe(true);
    expect(join({ roomId: "not-a-uuid" })).toBeNull();
    expect(join({ browserToken: "not-a-uuid" })).toBeNull();
    expect(join({ browserToken: undefined })).toBeNull();
  });

  test("since is optional and must be a non-negative integer", () => {
    expect(join({})?.since).toBeUndefined();
    expect(join({ since: 0 })?.since).toBe(0);
    expect(join({ since: -1 })).toBeNull();
    expect(join({ since: 1.5 })).toBeNull();
    expect(join({ since: "5" })).toBeNull();
  });
});

describe("message:send validation", () => {
  test("clientId must be a UUID", () => {
    expect(send({})).not.toBeNull();
    expect(send({ clientId: "1234" })).toBeNull();
  });

  test("the IV must be exactly 16 base64url characters", () => {
    expect(send({ iv: "AAAAAAAAAAAAAAA" })).toBeNull(); // 15
    expect(send({ iv: "AAAAAAAAAAAAAAAAA" })).toBeNull(); // 17
    expect(send({ iv: "AAAAAAAAAAAAAA==" })).toBeNull();
    expect(send({ iv: "AAAAAAAAAAAAAAA+" })).toBeNull();
  });

  test("ciphertext must be 1 to 12,000 base64url characters", () => {
    expect(send({ ciphertext: "A" })).not.toBeNull();
    expect(send({ ciphertext: "A".repeat(12_000) })).not.toBeNull();
    expect(send({ ciphertext: "" })).toBeNull();
    expect(send({ ciphertext: "A".repeat(12_001) })).toBeNull();
    expect(send({ ciphertext: "abc/def" })).toBeNull();
  });

  test("the longest message the client allows fits the ciphertext limit", async () => {
    // 2,000 code units of a 3-byte character is the largest UTF-8 text the client sends.
    const key = await importKey(await generateKey());
    const encrypted = await encrypt(key, "€".repeat(2000));

    expect(encrypted.ciphertext).toHaveLength(8022);
    expect(send(encrypted)).not.toBeNull();
    expect(await decrypt(key, encrypted)).toHaveLength(2000);
  });
});

describe("POST /api/rooms validation", () => {
  test("no body, or neither name field, creates a room with no name", () => {
    const noName = { nameCiphertext: null, nameIv: null };

    expect(parseCreateRoomBody(undefined)).toEqual(noName);
    expect(parseCreateRoomBody({})).toEqual(noName);
  });

  test("both name fields are needed, the name IV follows the IV rule, and the name ciphertext is at most 400 characters", () => {
    expect(parseCreateRoomBody({ nameCiphertext: "A".repeat(400), nameIv: iv })).not.toBeNull();
    expect(parseCreateRoomBody({ nameCiphertext: "A".repeat(401), nameIv: iv })).toBeNull();
    expect(parseCreateRoomBody({ nameCiphertext: "abc", nameIv: "AAAAAAAAAAAAAAA" })).toBeNull();
    expect(parseCreateRoomBody({ nameCiphertext: "abc" })).toBeNull();
    expect(parseCreateRoomBody({ nameIv: iv })).toBeNull();
  });

  test("a body that is not an object is rejected", () => {
    expect(parseCreateRoomBody(null)).toBeNull();
    expect(parseCreateRoomBody([])).toBeNull();
    expect(parseCreateRoomBody("name")).toBeNull();
  });
});
