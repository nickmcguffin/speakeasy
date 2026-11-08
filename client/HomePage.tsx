import { type SubmitEvent, useId, useState } from "react";
import type { CreateRoomRequest, CreateRoomResponse } from "../shared/types.js";
import { encrypt, generateKey, importKey } from "./crypto";

type CreateStatus = "idle" | "creating" | "failed";
export type CreatedRoom = { roomId: string; encodedKey: string };

const maxRoomNameLength = 60;

// The key is generated first and stays in the browser. The request carries no key, and the
// name, if there is one, only as ciphertext.
async function createRoom(roomName: string): Promise<CreatedRoom> {
  const encodedKey = await generateKey();
  let request: RequestInit = { method: "POST" };
  if (roomName) {
    const { ciphertext, iv } = await encrypt(await importKey(encodedKey), roomName);
    const body: CreateRoomRequest = { nameCiphertext: ciphertext, nameIv: iv };
    request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }
  const response = await fetch("/api/rooms", request);
  if (!response.ok) {
    throw new Error(`Create room failed with status ${response.status}`);
  }
  const body = (await response.json()) as CreateRoomResponse;
  return { roomId: body.roomId, encodedKey };
}

export function HomePage({ onRoomCreated }: { onRoomCreated: (room: CreatedRoom) => void }) {
  const [status, setStatus] = useState<CreateStatus>("idle");
  const [roomName, setRoomName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const roomNameInputId = useId();
  const nameErrorId = useId();

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = roomName.trim();
    if (name.length > maxRoomNameLength) {
      setNameError(`Room names can be at most 60 characters. This one has ${name.length}.`);
      return;
    }
    setNameError(null);
    setStatus("creating");
    try {
      onRoomCreated(await createRoom(name));
    } catch {
      setStatus("failed");
    }
  };

  return (
    <main className="page">
      <h1>Speakeasy</h1>
      <p className="lead">Private rooms for quick conversations.</p>
      <p className="lead muted">Messages are encrypted in your browser.</p>
      <form className="form" onSubmit={handleSubmit}>
        <label htmlFor={roomNameInputId}>Room name (optional)</label>
        <input
          id={roomNameInputId}
          value={roomName}
          onChange={(event) => setRoomName(event.target.value)}
          placeholder="Friday plans"
          autoComplete="off"
          aria-invalid={nameError !== null}
          aria-describedby={nameError ? nameErrorId : undefined}
        />
        {nameError && (
          <p id={nameErrorId} role="alert" className="error">
            {nameError}
          </p>
        )}
        <button type="submit" disabled={status === "creating"}>
          {status === "creating" ? "Creating a room..." : "Create a room"}
        </button>
        {status === "failed" && (
          <p role="alert" className="error">
            Could not create a room. Check your connection and try again.
          </p>
        )}
      </form>
    </main>
  );
}
