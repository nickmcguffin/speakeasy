import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { SocketEvents } from "../shared/types.js";

type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

const connectionLabels: Record<ConnectionState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
};

export function ConnectionStatus() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    const socket: Socket<SocketEvents, SocketEvents> = io();

    // socket.active is true while Socket.IO keeps retrying, false once it has given up.
    const handleConnectionLost = () => {
      setConnection(socket.active ? "reconnecting" : "disconnected");
    };

    socket.on("connect", () => setConnection("connected"));
    socket.on("disconnect", handleConnectionLost);
    socket.on("connect_error", handleConnectionLost);

    return () => {
      socket.disconnect();
    };
  }, []);

  return <p>{connectionLabels[connection]}</p>;
}
