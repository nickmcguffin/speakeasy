import { useState } from "react";
import type { CreateRoomResponse } from "../shared/types.js";
import { generateKey } from "./crypto";

type CreateStatus = "idle" | "creating" | "failed";
export type CreatedRoom = { roomId: string; encodedKey: string };

// The key is generated first and stays in the browser. The request carries no key.
async function createRoom(): Promise<CreatedRoom> {
  const encodedKey = await generateKey();
  const response = await fetch("/api/rooms", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Create room failed with status ${response.status}`);
  }
  const body = (await response.json()) as CreateRoomResponse;
  return { roomId: body.roomId, encodedKey };
}

export function HomePage({ onRoomCreated }: { onRoomCreated: (room: CreatedRoom) => void }) {
  const [status, setStatus] = useState<CreateStatus>("idle");

  const handleCreate = async () => {
    setStatus("creating");
    try {
      onRoomCreated(await createRoom());
    } catch {
      setStatus("failed");
    }
  };

  return (
    <main>
      <h1>Speakeasy</h1>
      <button type="button" onClick={handleCreate} disabled={status === "creating"}>
        {status === "creating" ? "Creating room..." : "Create room"}
      </button>
      {status === "failed" && (
        <p role="alert">Could not create a room. Check your connection and try again.</p>
      )}
    </main>
  );
}
