import { useEffect, useState } from "react";
import type { RoomResponse } from "../shared/types.js";
import { ChatRoom } from "./ChatRoom";
import { decrypt, importKey, type RoomKey } from "./crypto";
import { getBrowserToken } from "./browserToken";
import { NamePrompt, readStoredName } from "./NamePrompt";

type RoomStatus = "loading" | "incomplete-link" | "found" | "not-found" | "failed";
type LoadedRoom = { status: RoomStatus; roomKey: RoomKey | null; roomName: string | null };
type FetchedRoom = { status: RoomStatus; room: RoomResponse | null };

const appTitle = "Speakeasy";
const untitledRoom = "Untitled room";

async function fetchRoom(roomId: string): Promise<FetchedRoom> {
  try {
    const response = await fetch(`/api/rooms/${roomId}`);
    if (response.status === 404) {
      return { status: "not-found", room: null };
    }
    if (!response.ok) {
      return { status: "failed", room: null };
    }
    return { status: "found", room: (await response.json()) as RoomResponse };
  } catch {
    return { status: "failed", room: null };
  }
}

// Null when the room has no name, or when the name does not decrypt (for example with a wrong key).
async function decryptRoomName(roomKey: RoomKey, room: RoomResponse): Promise<string | null> {
  if (room.nameCiphertext === null || room.nameIv === null) {
    return null;
  }
  try {
    const name = await decrypt(roomKey, { ciphertext: room.nameCiphertext, iv: room.nameIv });
    return name.trim() || null;
  } catch {
    return null;
  }
}

// The key is imported before the room lookup, so a link without a usable key never
// contacts the room or joins it.
async function loadRoom(roomId: string, encodedKey: string): Promise<LoadedRoom> {
  let roomKey: RoomKey;
  try {
    roomKey = await importKey(encodedKey);
  } catch {
    return { status: "incomplete-link", roomKey: null, roomName: null };
  }
  const { status, room } = await fetchRoom(roomId);
  const roomName = room ? await decryptRoomName(roomKey, room) : null;
  return { status, roomKey, roomName };
}

type RoomPageProps = { roomId: string; encodedKey: string };

export function RoomPage({ roomId, encodedKey }: RoomPageProps) {
  // The key lives only in this state and in the URL. It is never stored or sent.
  const [room, setRoom] = useState<LoadedRoom>({ status: "loading", roomKey: null, roomName: null });
  const [displayName, setDisplayName] = useState(readStoredName);
  const [browserToken] = useState(getBrowserToken);

  useEffect(() => {
    let isCurrent = true;
    loadRoom(roomId, encodedKey).then((result) => {
      if (isCurrent) {
        setRoom(result);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [roomId, encodedKey]);

  // The tab title shows the room name, and goes back to the app name when the room closes.
  useEffect(() => {
    if (room.status !== "found") {
      return;
    }
    document.title = `${room.roomName ?? untitledRoom} | ${appTitle}`;
    return () => {
      document.title = appTitle;
    };
  }, [room]);

  if (room.status === "loading") {
    return <p>Loading room...</p>;
  }
  if (room.status === "incomplete-link") {
    return (
      <main>
        <h1>This link is incomplete</h1>
        <p>The key that unlocks the messages is missing or damaged. Ask the person who shared it for the full link.</p>
      </main>
    );
  }
  if (room.status === "not-found") {
    return <p>Room not found</p>;
  }
  if (room.status === "failed" || !room.roomKey) {
    return <p role="alert">Could not load the room. Reload the page to try again.</p>;
  }
  return (
    // The chat screen is styled in a later step. Until then only the name prompt uses the column.
    <main className={displayName ? undefined : "page"}>
      <h1>{room.roomName ?? untitledRoom}</h1>
      {displayName ? (
        <ChatRoom roomId={roomId} displayName={displayName} roomKey={room.roomKey} browserToken={browserToken} />
      ) : (
        <NamePrompt onSubmit={setDisplayName} />
      )}
    </main>
  );
}
