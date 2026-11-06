import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverUrl = "http://localhost:3000";

export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    // Vite only empties outDir by default when it is inside root.
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": serverUrl,
      // ws: true forwards the WebSocket upgrade. Without it Socket.IO stays on polling.
      "/socket.io": { target: serverUrl, ws: true },
    },
  },
});
