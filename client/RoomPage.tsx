import { useEffect, useState } from "react";
import { ChatRoom } from "./ChatRoom";
import { importKey, type RoomKey } from "./crypto";
import { NamePrompt, readStoredName } from "./NamePrompt";

type RoomStatus = "loading" | "found" | "not-found" | "failed";

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

export function RoomPage({ roomId }: { roomId: string }) {
  const [status, setStatus] = useState<RoomStatus>("loading");
  const [roomKey, setRoomKey] = useState<RoomKey | null>(null);
  const [displayName, setDisplayName] = useState(readStoredName);

  useEffect(() => {
    let isCurrent = true;
    // The key comes from the link fragment. The temporary crypto module ignores its value.
    Promise.all([fetchRoomStatus(roomId), importKey(location.hash.slice(1))]).then(([result, key]) => {
      if (isCurrent) {
        setRoomKey(key);
        setStatus(result);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [roomId]);

  if (status === "loading") {
    return <p>Loading room...</p>;
  }
  if (status === "not-found") {
    return <p>Room not found</p>;
  }
  if (status === "failed" || !roomKey) {
    return <p role="alert">Could not load the room. Reload the page to try again.</p>;
  }
  return (
    <main>
      <h1>Room {roomId}</h1>
      {displayName ? (
        <ChatRoom roomId={roomId} displayName={displayName} roomKey={roomKey} />
      ) : (
        <NamePrompt onSubmit={setDisplayName} />
      )}
    </main>
  );
}
