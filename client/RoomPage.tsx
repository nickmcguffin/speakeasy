import { useEffect, useState } from "react";
import type { RoomResponse } from "../shared/types.js";
import { AppHeader } from "./AppHeader";
import { ChatRoom } from "./ChatRoom";
import { decrypt, importKey, type RoomKey } from "./crypto";
import { getBrowserToken } from "./browserToken";
import { NamePrompt, readStoredName } from "./NamePrompt";
import { failuresBeforeErrorScreen, retryDelayMs } from "./retry";
import { StateScreen } from "./StateScreen";

type RoomStatus = "loading" | "incomplete-link" | "found" | "not-found" | "failed";
type LoadedRoom = { status: RoomStatus; roomKey: RoomKey | null; roomName: string | null };

const loadingRoom: LoadedRoom = { status: "loading", roomKey: null, roomName: null };
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
  const [room, setRoom] = useState(loadingRoom);
  // Each change runs the room lookup again: a retry, or Try again.
  const [attempt, setAttempt] = useState(0);
  // Failed lookups in a row (network error or server error). Reset by a lookup that answers.
  const [lookupFailures, setLookupFailures] = useState(0);
  const [displayName, setDisplayName] = useState(readStoredName);
  const [browserToken] = useState(getBrowserToken);

  useEffect(() => {
    let isCurrent = true;
    loadRoom(roomId, encodedKey).then((result) => {
      if (!isCurrent) {
        return;
      }
      if (result.status === "failed") {
        setLookupFailures((count) => count + 1);
        return;
      }
      setLookupFailures(0);
      setRoom(result);
    });
    return () => {
      isCurrent = false;
    };
  }, [roomId, encodedKey, attempt]);

  // A failed lookup is tried again after 1, 2 and 4 seconds, then every 10 seconds, also while
  // the "Could not load the room" screen shows.
  useEffect(() => {
    if (lookupFailures === 0) {
      return;
    }
    const timer = setTimeout(() => setAttempt((count) => count + 1), retryDelayMs(lookupFailures));
    return () => clearTimeout(timer);
  }, [lookupFailures]);

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

  // Starts over: the room layout with "Connecting", and the lookup at once.
  const handleTryAgain = () => {
    setLookupFailures(0);
    setAttempt((count) => count + 1);
  };

  if (room.status === "incomplete-link") {
    return (
      <StateScreen
        title="This link is incomplete"
        message="The key that unlocks the messages is missing or damaged. Ask the person who shared it for the full link."
      />
    );
  }
  if (room.status === "not-found") {
    return (
      <StateScreen
        title="Room not found"
        message="No room matches this link. Check that you have the whole link, or ask the person who shared it to send it again."
      />
    );
  }
  if (room.status !== "found" && lookupFailures >= failuresBeforeErrorScreen) {
    return (
      <StateScreen
        title="Could not load the room"
        message="The server did not answer. Check your connection and try again."
        action={{ label: "Try again", onClick: handleTryAgain }}
      />
    );
  }
  // While the lookup runs, the screen already has its final layout. The name fills in once it
  // is decrypted, so "Untitled room" never shows before a real name.
  const found = room.status === "found";
  const roomName = found ? (room.roomName ?? untitledRoom) : null;
  if (!displayName) {
    return (
      <>
        <AppHeader />
        <main className="page">
          <h1>{roomName}</h1>
          <NamePrompt onSubmit={setDisplayName} />
        </main>
      </>
    );
  }
  return (
    <ChatRoom
      roomId={roomId}
      roomName={roomName}
      displayName={displayName}
      roomKey={found ? room.roomKey : null}
      lookupRetrying={lookupFailures > 0}
      browserToken={browserToken}
    />
  );
}
