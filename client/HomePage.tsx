import { type FormEvent, useId, useState } from "react";
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
    <main>
      <h1>Speakeasy</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor={roomNameInputId}>Room name</label>{" "}
        <input
          id={roomNameInputId}
          value={roomName}
          onChange={(event) => setRoomName(event.target.value)}
          autoComplete="off"
        />{" "}
        <button type="submit" disabled={status === "creating"}>
          {status === "creating" ? "Creating room..." : "Create room"}
        </button>
        {nameError && <p role="alert">{nameError}</p>}
      </form>
      {status === "failed" && (
        <p role="alert">Could not create a room. Check your connection and try again.</p>
      )}
    </main>
  );
}
