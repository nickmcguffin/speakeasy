import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, inject, test } from "vitest";
import { deleteRooms } from "../deleteRooms";

const serverUrl = inject("serverUrl");
const createdRoomIds: string[] = [];

afterAll(() => deleteRooms(createdRoomIds));

describe.skipIf(!serverUrl)("REST API", () => {
  test("creating a room with no body gives a room with no name", async () => {
    const created = await fetch(`${serverUrl}/api/rooms`, { method: "POST" });
    const { roomId } = await created.json();
    createdRoomIds.push(roomId);

    expect(created.status).toBe(201);
    const room = await fetch(`${serverUrl}/api/rooms/${roomId}`);
    expect(await room.json()).toEqual(expect.objectContaining({ roomId, nameCiphertext: null, nameIv: null }));
  });

  test("creating a room with a name stores the encrypted name fields", async () => {
    const name = { nameCiphertext: "c2VjcmV0LW5hbWU", nameIv: "AAAAAAAAAAAAAAAA" };
    const created = await fetch(`${serverUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(name),
    });
    const { roomId } = await created.json();
    createdRoomIds.push(roomId);

    expect(created.status).toBe(201);
    const room = await fetch(`${serverUrl}/api/rooms/${roomId}`);
    expect(await room.json()).toEqual(expect.objectContaining({ roomId, ...name }));
  });

  test.each([
    ["one name field", JSON.stringify({ nameIv: "AAAAAAAAAAAAAAAA" })],
    ["broken JSON", "{"],
  ])("an invalid body (%s) gives a JSON 400", async (_label, body) => {
    const response = await fetch(`${serverUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_INPUT" });
  });

  test("an unknown room gives a JSON 404", async () => {
    const response = await fetch(`${serverUrl}/api/rooms/${randomUUID()}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "ROOM_NOT_FOUND" });
  });

  test("an unknown /api route gives a JSON 404", async () => {
    const response = await fetch(`${serverUrl}/api/nothing/here`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });

  test("the health check answers ok", async () => {
    const response = await fetch(`${serverUrl}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
