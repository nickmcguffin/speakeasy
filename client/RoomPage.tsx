import { useEffect, useState } from "react";
import { ChatRoom } from "./ChatRoom";
import { importKey, type RoomKey } from "./crypto";
import { NamePrompt, readStoredName } from "./NamePrompt";

type RoomStatus = "loading" | "incomplete-link" | "found" | "not-found" | "failed";
type LoadedRoom = { status: RoomStatus; roomKey: RoomKey | null };

async function fetchRoomStatus(roomId: string): Promise<RoomStatus> {
  try {
    const response = await fetch(`/api/rooms/${roomId}`);
    if (response.status === 404) {
      return "not-found";
    }
    return response.ok ? "found" : "failed";
  } catch {
    return "failed";
  }
}

// The key is imported before the room lookup, so a link without a usable key never
// contacts the room or joins it.
async function loadRoom(roomId: string, encodedKey: string): Promise<LoadedRoom> {
  let roomKey: RoomKey;
  try {
    roomKey = await importKey(encodedKey);
  } catch {
    return { status: "incomplete-link", roomKey: null };
  }
  return { status: await fetchRoomStatus(roomId), roomKey };
}

type RoomPageProps = { roomId: string; encodedKey: string };

export function RoomPage({ roomId, encodedKey }: RoomPageProps) {
  // The key lives only in this state and in the URL. It is never stored or sent.
  const [room, setRoom] = useState<LoadedRoom>({ status: "loading", roomKey: null });
  const [displayName, setDisplayName] = useState(readStoredName);

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
    <main>
      <h1>Room {roomId}</h1>
      {displayName ? (
        <ChatRoom roomId={roomId} displayName={displayName} roomKey={room.roomKey} />
      ) : (
        <NamePrompt onSubmit={setDisplayName} />
      )}
    </main>
  );
}
