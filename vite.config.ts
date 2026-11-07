import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverUrl = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    proxy: {
      "/api": serverUrl,
      // ws: true forwards the WebSocket upgrade. Without it Socket.IO stays on polling.
      "/socket.io": { target: serverUrl, ws: true },
    },
  },
});
