import { useEffect, useState } from "react";
import { isEncryptionAvailable } from "./crypto";
import { type CreatedRoom, HomePage } from "./HomePage";
import { RoomPage } from "./RoomPage";

const roomPathPattern = /^\/r\/([^/]+)\/?$/;

function readLocation() {
  return { pathname: location.pathname, hash: location.hash };
}

export function App() {
  const [current, setCurrent] = useState(readLocation);

  // Back and forward buttons change the URL without a page load. Editing only the fragment
  // (the key) in the address bar does not reload the page either, so listen for that too.
  useEffect(() => {
    const handleChange = () => setCurrent(readLocation());
    window.addEventListener("popstate", handleChange);
    window.addEventListener("hashchange", handleChange);
    return () => {
      window.removeEventListener("popstate", handleChange);
      window.removeEventListener("hashchange", handleChange);
    };
  }, []);

  // The key travels only in the fragment, which browsers never send to the server.
  const handleRoomCreated = ({ roomId, encodedKey }: CreatedRoom) => {
    history.pushState(null, "", `/r/${roomId}#${encodedKey}`);
    setCurrent(readLocation());
  };

  // Checked before both screens: a room cannot be created or read without Web Crypto.
  if (!isEncryptionAvailable()) {
    return (
      <main>
        <h1>This browser cannot encrypt messages</h1>
        <p>Encryption needs a secure connection. Open the link with https:// and try again.</p>
      </main>
    );
  }

  const roomMatch = roomPathPattern.exec(current.pathname);
  if (roomMatch) {
    const roomId = roomMatch[1];
    const encodedKey = current.hash.slice(1);
    // A new room or a new key starts a fresh room screen and connection.
    return <RoomPage key={`${roomId}#${encodedKey}`} roomId={roomId} encodedKey={encodedKey} />;
  }
  return <HomePage onRoomCreated={handleRoomCreated} />;
}
