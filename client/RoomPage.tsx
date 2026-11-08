import { useEffect, useState } from "react";
import { ConnectionStatus } from "./ConnectionStatus";

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

  useEffect(() => {
    let isCurrent = true;
    fetchRoomStatus(roomId).then((result) => {
      if (isCurrent) {
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
  if (status === "failed") {
    return <p role="alert">Could not load the room. Reload the page to try again.</p>;
  }
  return (
    <main>
      <p>Room {roomId}</p>
      <ConnectionStatus />
    </main>
  );
}
