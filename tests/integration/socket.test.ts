import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { io, type Socket } from "socket.io-client";
import { afterAll, describe, expect, inject, test, vi } from "vitest";
import type {
  ClientToServerEvents,
  JoinResult,
  Participant,
  RoomRecord,
  SendPayload,
  ServerToClientEvents,
} from "../../shared/types";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Received = { event: string; payload: unknown; at: number };

const serverUrl = inject("serverUrl");
const openSockets: ClientSocket[] = [];
const iv = "AAAAAAAAAAAAAAAA";

afterAll(() => {
  for (const socket of openSockets) {
    socket.disconnect();
  }
});

async function createRoom(): Promise<string> {
  const response = await fetch(`${serverUrl}/api/rooms`, { method: "POST" });
  const { roomId } = await response.json();
  return roomId;
}

// One connection, like one browser tab. received lists everything the server sends it, in order.
function connect() {
  const socket: ClientSocket = io(serverUrl ?? "", { transports: ["websocket"], forceNew: true, reconnection: false });
  const received: Received[] = [];
  socket.onAny((event, payload) => received.push({ event, payload, at: Date.now() }));
  openSockets.push(socket);
  return { socket, received };
}

type JoinOptions = { browserToken?: string; displayName?: string; since?: number };

function join(socket: ClientSocket, roomId: string, options: JoinOptions = {}): Promise<JoinResult> {
  const { browserToken = randomUUID(), displayName = "Ada", since } = options;
  return socket.timeout(5000).emitWithAck("room:join", { roomId, displayName, browserToken, since });
}

function send(socket: ClientSocket, payload: SendPayload) {
  return socket.timeout(5000).emitWithAck("message:send", payload);
}

// The rows that arrived with message:new, with their arrival time.
function newRecords(received: Received[]) {
  const records: (RoomRecord & { at: number })[] = [];
  for (const item of received) {
    if (item.event === "message:new") {
      records.push({ ...(item.payload as RoomRecord), at: item.at });
    }
  }
  return records;
}

function eventKinds(received: Received[]) {
  const kinds: string[] = [];
  for (const record of newRecords(received)) {
    if (record.kind !== "message") {
      kinds.push(record.kind);
    }
  }
  return kinds;
}

function lastPresence(received: Received[]) {
  let participants: Participant[] = [];
  for (const item of received) {
    if (item.event === "room:presence") {
      participants = item.payload as Participant[];
    }
  }
  return participants;
}

function joinedOk(result: JoinResult) {
  if (!result.ok) {
    throw new Error(`join failed with ${result.error}`);
  }
  return result;
}

describe.skipIf(!serverUrl)("Socket.IO events", () => {
  test("a join with an invalid payload fails with INVALID_INPUT, and an unknown room with ROOM_NOT_FOUND", async () => {
    const { socket } = connect();
    const roomId = await createRoom();

    expect(await join(socket, "not-a-uuid")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await join(socket, roomId, { displayName: "   " })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await join(socket, randomUUID())).toEqual({ ok: false, error: "ROOM_NOT_FOUND" });
  });

  test("sending before joining fails with NOT_JOINED", async () => {
    const { socket } = connect();

    expect(await send(socket, { clientId: randomUUID(), ciphertext: "abc", iv })).toEqual({
      ok: false,
      error: "NOT_JOINED",
    });
  });

  test("sending the same clientId twice stores one row and broadcasts it once", async () => {
    const roomId = await createRoom();
    const sender = connect();
    const watcher = connect();
    await join(sender.socket, roomId);
    await join(watcher.socket, roomId, { displayName: "Bob" });

    const payload = { clientId: randomUUID(), ciphertext: "abc", iv };
    const first = await send(sender.socket, payload);
    const retry = await send(sender.socket, payload);
    await sleep(500);

    expect(first.ok).toBe(true);
    expect(retry).toEqual(first);
    const broadcasts = newRecords(watcher.received).filter((record) => record.kind === "message");
    expect(broadcasts).toHaveLength(1);
    const history = joinedOk(await join(connect().socket, roomId)).messages;
    expect(history.filter((record) => record.kind === "message")).toHaveLength(1);
  });

  test("a join with since returns only the rows after it", async () => {
    const roomId = await createRoom();
    const author = connect();
    await join(author.socket, roomId);
    const sentIds: number[] = [];
    for (let index = 0; index < 3; index++) {
      const result = await send(author.socket, { clientId: randomUUID(), ciphertext: "abc", iv });
      if (result.ok) {
        sentIds.push(result.message.id);
      }
    }

    const since = sentIds[0];
    const { messages } = joinedOk(await join(connect().socket, roomId, { since }));

    const messageIds: number[] = [];
    for (const record of messages) {
      expect(record.id).toBeGreaterThan(since);
      if (record.kind === "message") {
        messageIds.push(record.id);
      }
    }
    expect(messageIds).toEqual(sentIds.slice(1));
  });

  test("presence lists two connections of one browser once and never sends the browser token", async () => {
    const roomId = await createRoom();
    const adaToken = randomUUID();
    const bobToken = randomUUID();
    const adaTabOne = connect();
    const adaTabTwo = connect();
    const bob = connect();
    const acks = [
      await join(adaTabOne.socket, roomId, { browserToken: adaToken, displayName: "Ada" }),
      await join(adaTabTwo.socket, roomId, { browserToken: adaToken, displayName: "Ada" }),
      await join(bob.socket, roomId, { browserToken: bobToken, displayName: "Bob" }),
    ];

    await vi.waitFor(() => {
      expect(lastPresence(bob.received).map((participant) => participant.name)).toEqual(["Ada", "Bob"]);
    });
    const everythingSent = JSON.stringify([acks, adaTabOne.received, adaTabTwo.received, bob.received]);
    expect(everythingSent).not.toContain(adaToken);
    expect(everythingSent).not.toContain(bobToken);
  });

  // The two timing tests below wait for the server's 5-second timer, so they run side by side.
  test.concurrent("the first connection stores a join event, and a leave event follows about 5 s after the last one closes", async () => {
    const roomId = await createRoom();
    const watcher = connect();
    await join(watcher.socket, roomId, { displayName: "Bob" });
    const browserToken = randomUUID();
    const tabOne = connect();
    const tabTwo = connect();
    await join(tabOne.socket, roomId, { browserToken });
    await join(tabTwo.socket, roomId, { browserToken });

    tabOne.socket.disconnect();
    await sleep(2000);
    tabTwo.socket.disconnect();
    const lastClosedAt = Date.now();

    await vi.waitFor(() => expect(eventKinds(watcher.received)).toEqual(["join", "leave"]), { timeout: 10_000 });
    const leftAfterMs = newRecords(watcher.received).at(-1)!.at - lastClosedAt;
    expect(leftAfterMs).toBeGreaterThan(4500);
    expect(leftAfterMs).toBeLessThan(7000);
  });

  test.concurrent("a reconnect within 5 s stores no join or leave event", async () => {
    const roomId = await createRoom();
    const watcher = connect();
    await join(watcher.socket, roomId, { displayName: "Bob" });
    const browserToken = randomUUID();
    const before = connect();
    const { messages } = joinedOk(await join(before.socket, roomId, { browserToken }));
    await vi.waitFor(() => expect(eventKinds(watcher.received)).toEqual(["join"]));

    before.socket.disconnect();
    const after = connect();
    joinedOk(await join(after.socket, roomId, { browserToken, since: messages.at(-1)?.id }));
    await sleep(6000);

    expect(eventKinds(watcher.received)).toEqual(["join"]);
  });
});
