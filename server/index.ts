import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import type { SocketEvents } from "../shared/types.js";

const port = process.env.PORT ?? 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server<SocketEvents, SocketEvents>(httpServer);

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Catches any method and depth under /api. New API routes go above this.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "NOT_FOUND" });
});

if (process.argv.includes("--production")) {
  // Compiled to dist/server/, next to the client build in dist/client/.
  const clientDir = path.join(import.meta.dirname, "../client");

  // Also serves index.html for "/". Missing files fall through to a 404.
  app.use(express.static(clientDir));

  app.get("/r/:roomId", (_req, res) => {
    res.sendFile("index.html", { root: clientDir });
  });
}

httpServer.listen(port, () => {
  console.log(`server listening on port ${port}`);
});
