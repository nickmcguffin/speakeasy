import { useState } from "react";
import type { CreateRoomResponse } from "../shared/types.js";

type CreateStatus = "idle" | "creating" | "failed";

async function createRoom(): Promise<string> {
  const response = await fetch("/api/rooms", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Create room failed with status ${response.status}`);
  }
  const body = (await response.json()) as CreateRoomResponse;
  return body.roomId;
}

export function HomePage({ onRoomCreated }: { onRoomCreated: (roomId: string) => void }) {
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
