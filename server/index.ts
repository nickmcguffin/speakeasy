import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { Server } from "socket.io";
import type {
  CreateRoomResponse,
  ErrorResponse,
  RoomResponse,
  SocketEvents,
} from "../shared/types.js";
import { createSchema, pool } from "./db.js";

const port = process.env.PORT ?? 3000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
const httpServer = createServer(app);
const io = new Server<SocketEvents, SocketEvents>(httpServer);

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);
});

// No database call, so a slow Neon wake-up cannot fail the health check.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/rooms", async (_req, res) => {
  const roomId = randomUUID();
  await pool.query("INSERT INTO rooms (id) VALUES ($1)", [roomId]);
  res.status(201).json({ roomId } satisfies CreateRoomResponse);
});

app.get("/api/rooms/:roomId", async (req, res) => {
  const { roomId } = req.params;

  // Postgres throws on a malformed uuid, so reject it here as a 404 instead of a 500.
  if (!uuidPattern.test(roomId)) {
    res.status(404).json({ error: "ROOM_NOT_FOUND" } satisfies ErrorResponse);
    return;
  }

  const result = await pool.query<{ id: string; created_at: Date }>(
    "SELECT id, created_at FROM rooms WHERE id = $1",
    [roomId],
  );
  const room = result.rows[0];

  if (!room) {
    res.status(404).json({ error: "ROOM_NOT_FOUND" } satisfies ErrorResponse);
    return;
  }

  res.json({ roomId: room.id, createdAt: room.created_at.toISOString() } satisfies RoomResponse);
});

// Catches any method and depth under /api. New API routes go above this.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "NOT_FOUND" } satisfies ErrorResponse);
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
} else {
  console.warn(`Client build not found at ${clientDir}. Serving API only.`);
}

// Express 5 sends rejected async handlers here. Reply with JSON instead of an HTML stack trace.
app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error(`${req.method} ${req.path} failed: ${error.message}`);
  res.status(500).json({ error: "SERVER_ERROR" } satisfies ErrorResponse);
});

try {
  await createSchema();
} catch (error) {
  console.error(`Could not set up the database schema: ${(error as Error).message}`);
  process.exit(1);
}

httpServer.listen(port, () => {
  console.log(`server listening on port ${port}`);
});
