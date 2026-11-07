import { existsSync } from "node:fs";
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

// From cwd because the source and compiled server files are in different folders.
const clientDir = path.join(process.cwd(), "client/dist");

if (existsSync(clientDir)) {
  // Also serves index.html for "/". Missing files fall through to the routes below.
  app.use(express.static(clientDir));

  app.get("/r/:roomId", (_req, res) => {
    res.sendFile("index.html", { root: clientDir });
  });

  // /api never reaches this. A path with an extension is a missing file, so it gets a plain 404.
  app.get("/{*path}", (req, res, next) => {
    if (path.extname(req.path)) {
      next();
      return;
    }
    res.status(404).sendFile("index.html", { root: clientDir });
  });
}

httpServer.listen(port, () => {
  console.log(`server listening on port ${port}`);
});
