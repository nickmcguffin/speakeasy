import { useEffect, useState } from "react";
import { HomePage } from "./HomePage";
import { RoomPage } from "./RoomPage";

const roomPathPattern = /^\/r\/([^/]+)\/?$/;

export function App() {
  const [pathname, setPathname] = useState(location.pathname);

  // Back and forward buttons change the URL without a page load.
  useEffect(() => {
    const handlePopState = () => setPathname(location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleRoomCreated = (roomId: string) => {
    const roomPath = `/r/${roomId}`;
    history.pushState(null, "", roomPath);
    setPathname(roomPath);
  };

  const roomMatch = roomPathPattern.exec(pathname);
  if (roomMatch) {
    const roomId = roomMatch[1];
    return <RoomPage key={roomId} roomId={roomId} />;
  }
  return <HomePage onRoomCreated={handleRoomCreated} />;
}
