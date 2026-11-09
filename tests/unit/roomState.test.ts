import { describe, expect, test } from "vitest";
import type { RoomEvent } from "../../shared/types";
import { type ChatMessage, initialRoomState, isOwnRecord, type RoomAction, roomReducer } from "../../client/roomState";

function message(id: number, changes: Partial<ChatMessage> = {}): ChatMessage {
  return {
    kind: "message",
    id,
    clientId: `client-${id}`,
    roomId: "room",
    authorName: "Ada",
    authorKey: "ada-key",
    body: `message ${id}`,
    createdAt: "2026-11-09T10:00:00.000Z",
    ...changes,
  };
}

function applyActions(actions: RoomAction[]) {
  let state = initialRoomState;
  for (const action of actions) {
    state = roomReducer(state, action);
  }
  return state;
}

describe("room reducer", () => {
  test("received rows are merged and ordered by id, and a row that arrives twice shows once", () => {
    const state = applyActions([
      { type: "received", messages: [message(1), message(3)] },
      { type: "received", messages: [message(3), message(2)] },
    ]);

    expect(state.messages.map((record) => record.id)).toEqual([1, 2, 3]);
  });

  test("a pending message is replaced by the confirmed message from its ack", () => {
    const state = applyActions([
      { type: "queued", clientId: "client-7", body: "hi", queuedAt: "2026-11-09T10:00:00.000Z" },
      { type: "received", messages: [message(7, { body: "hi" })] },
    ]);

    expect(state.pending).toEqual([]);
    expect(state.messages).toEqual([message(7, { body: "hi" })]);
  });

  test("a retry keeps the clientId, ciphertext and IV, and clears the failure", () => {
    const state = applyActions([
      { type: "queued", clientId: "client-7", body: "hi", queuedAt: "2026-11-09T10:00:00.000Z" },
      { type: "encrypted", clientId: "client-7", ciphertext: "cipher", iv: "iv" },
      { type: "failed", clientId: "client-7", failure: "network" },
      { type: "sending", clientId: "client-7" },
    ]);

    expect(state.pending).toEqual([
      expect.objectContaining({ clientId: "client-7", ciphertext: "cipher", iv: "iv", status: "sending", failure: undefined }),
    ]);
  });

  test("a message the server rejected as invalid input is failed with the reason invalid", () => {
    const state = applyActions([
      { type: "queued", clientId: "client-7", body: "hi", queuedAt: "2026-11-09T10:00:00.000Z" },
      { type: "failed", clientId: "client-7", failure: "invalid" },
    ]);

    expect(state.pending[0]).toEqual(expect.objectContaining({ status: "failed", failure: "invalid" }));
  });
});

describe("own messages", () => {
  test("a message or event is yours when its authorKey is your presenceKey", () => {
    const joinEvent: RoomEvent = {
      kind: "join",
      id: 2,
      roomId: "room",
      authorName: "Ada",
      authorKey: "ada-key",
      createdAt: "2026-11-09T10:00:00.000Z",
    };

    expect(isOwnRecord(message(1), "ada-key")).toBe(true);
    expect(isOwnRecord(joinEvent, "ada-key")).toBe(true);
    expect(isOwnRecord(message(1), "bob-key")).toBe(false);
  });

  test("a row with no authorKey is never yours, even before your presenceKey arrives", () => {
    expect(isOwnRecord(message(1, { authorKey: null }), null)).toBe(false);
    expect(isOwnRecord(message(1, { authorKey: null }), "ada-key")).toBe(false);
  });
});
