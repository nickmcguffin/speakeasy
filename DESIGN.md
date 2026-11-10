# Speakeasy: System Design (MVP)

This document describes the design for the MVP in the README. It covers only what is in the Definition of done. Items on the Later-list are noted where they affect a decision.

## 1. Requirements

### Functional
- Create a room with one click and get a shareable link.
- Open a link, enter a display name, and join the room.
- Send and receive messages in real time.
- Messages are end-to-end encrypted. Only people with the full link can read them.
- See recent messages on join, and catch up on missed messages after a reconnect.
- Rooms and messages survive a server restart.
- Unknown room IDs and links without a key show a clear error.
- The UI shows connection state and per-message state (sending, sent, failed, retry).
- An optional room name, encrypted like a message.
- The room shows who is connected, and join and leave events show in the conversation.
- Light and dark themes, with a toggle.

### Non-functional
- **Scale:** demo traffic. Tens of concurrent users, a few messages per second at most.
- **Latency:** messages should feel instant. Optimistic UI hides network and encryption time for the sender.
- **Cost:** low. A paid Render instance during the review period, which can go back to Render's free tier later.
- **Availability:** best effort. One instance. The paid instance never spins down. On the free tier, a cold start of about a minute after a quiet period would come back (see section 11).
- **Security:** rooms are protected by an unguessable link. Message text is encrypted in the browser and the server never sees the key. Input is validated on the server. Message text is never rendered as HTML.

### Constraints
- One developer, 20-hour time box, due Friday 13 November 2026.
- TypeScript, Node, Express 5, Socket.IO, React with Vite, Postgres on Neon, Render.
- Vitest and Playwright (with axe) for the tests, and GitHub Actions for CI.

## 2. High-level design

```
 Browser (React SPA)
   - Web Crypto: AES-GCM key from the URL fragment
   - encrypts before send, decrypts on receive
   |  HTTPS: REST  /api/*
   |  WSS:   Socket.IO /socket.io      (ciphertext only, never the key)
   v
 Render web service (one Node process)
   - Express: REST API, static client files, /r/:roomId route
   - Socket.IO: room membership, message relay
   |  TLS, pooled connection
   v
 Neon Postgres
   - rooms
   - messages (ciphertext + IV)
```

One process serves the API, the WebSocket and the built client from one origin. This removes CORS setup and keeps one deploy. The server treats message content as opaque data.

### Room link format
```
https://<host>/r/<roomId>#<key>
```
- `roomId`: UUID from the server. Identifies the room.
- `key`: 256-bit AES-GCM key, base64url encoded (43 characters). Browsers do not send the fragment to the server, and it is not included in the `Referer` header.

### Client routes
| Path | Screen |
|---|---|
| `/` | Home: optional room name and "Create a room" |
| `/r/:roomId#key` | Room: name prompt (first visit), then chat |
| Any other path | "Page not found" screen, with a link to the home page |

Two routes only, so the client reads `location.pathname` and `location.hash`, and uses `history.pushState`. No router library unless more routes were added (user admin, history etc.). 

### Server routes for the client
The server serves the built client from `client/dist` whenever that folder exists. There is no mode switch. The path is resolved from `process.cwd()`, because the source and compiled server files are in different folders, so the server must start from the repo root.

- `/` and real files come from `express.static`.
- An explicit `/r/:roomId` route returns `index.html` with status 200.
- Unknown paths that are not /api and have no file extension return index.html with status 404.
- Other missing paths, such as `/assets/missing.js`, return a plain 404.

## 3. Data flows

### Create a room
1. Client generates the room key with `crypto.subtle.generateKey` (AES-GCM, 256 bits, extractable) and exports it to base64url.
2. The room name is optional. The client trims it and rejects more than 60 characters with an inline message, keeping the text. If a name is left, the client encrypts it with the new key exactly like a message, with its own random 12-byte IV.
3. Client sends `POST /api/rooms` with `{ nameCiphertext, nameIv }`, or with no body when there is no name. The key and the plain name are never in the request.
4. Server validates the body, makes an ID with `crypto.randomUUID()`, inserts the ID and the name columns into `rooms`, and returns `{ roomId }`.
5. Client navigates to `/r/:roomId#<key>` with `history.pushState` and shows the share panel with the full link. The copied link always includes the fragment.

### Join a room
1. Client reads the key from `location.hash` and imports it with `crypto.subtle.importKey` (AES-GCM, not extractable, encrypt and decrypt only). The key must be exactly the 43 base64url characters that `generateKey` makes: 32 bytes, no padding, no `+` or `/`, no whitespace. If the key is missing or invalid, the client shows the "incomplete link" screen and stops, with no room lookup and no socket. Changing only the fragment in the address bar does not reload the page, so the client listens for `hashchange` and starts a fresh room screen with the new key.
2. Client checks `GET /api/rooms/:roomId`. While it runs, the screen already has its final layout (see "Room loading" in section 12). A 404 replaces it with the "room not found" screen. Otherwise the client decrypts the room name with the key and shows it in the heading, with the tab title `<name> | Speakeasy`. A room with no name, or a name that does not decrypt (for example with a wrong key), shows "Untitled room" and the page works as normal. The title goes back to "Speakeasy" when the room screen closes.
3. Client gets the display name from local storage, or asks for it. The name prompt shows at once, with an empty heading until the room name is decrypted, and a 404 replaces it.
4. Client emits `room:join { roomId, displayName, browserToken }`. The browser token is described in "Presence".
5. Server validates and leaves any other room the socket was already in, then sends `room:presence` to that room. It puts the socket in the Socket.IO room and stores `roomId`, `displayName`, `browserToken`, the browser's `presenceKey` and a join counter on `socket.data`. It joins before it loads, so a message sent in between is not missed. A duplicate from that overlap is dropped by id on the client.
6. The server cancels any pending "left" timer for this browser in this room and, if the browser's last join or leave event in this room is not a join, stores a `join` event (see "Join and leave events"). This happens before the history loads, so the joiner gets the event in its history. The event goes to the other sockets in the room with `message:new`.
7. If loading the messages fails, the socket leaves the room and its join data is cleared before the `SERVER_ERROR` ack, so it is not counted in presence and cannot send. It counts as leaving the room, so a stored join gets its "left" event 5 seconds later.
8. Otherwise the server acks with the browser's `presenceKey` and the last 50 rows (messages and events) in ascending id order, then sends `room:presence` to everyone in the room once.
9. Client decrypts each message. Events have nothing to decrypt. A message that fails to decrypt shows as "Unable to decrypt this message".

### Join and leave events
1. Join and leave events are rows in the `messages` table with `kind` `'join'` or `'leave'`, the browser's `presenceKey` as `author_key`, the display name from the join, and no `client_id`, `ciphertext` or `iv`. They are stored in plain text (see Known limits in the README).
2. **Joined.** On a successful join, a `join` event is stored only when the last join or leave event of this `author_key` in this room is not a join. A second tab, a duplicated tab, a refresh or a reconnect of a browser that is still counted as present makes no event.
3. **Left.** When a socket leaves a room (disconnect, or joining another room) and it was the browser's last connection there, the server starts a 5-second timer keyed by room and `presenceKey`. A join of that browser cancels it. When it fires, the server checks again that the browser has no connection in the room and stores a `leave` event only when its last event is a join. The `leave` event keeps the name from that join. It goes to the whole room with `message:new`.
4. A refresh closes the old connection and joins again within the 5 seconds, so it makes no events, also when a tunnel loses the old connection's close (the browser token keeps it one participant).
5. Event decisions for one browser in one room run one at a time in the server process, so two tabs joining together, or a join while the timer fires, cannot store two events. This relies on one server instance (see section 9).
6. Timers live in memory. A server restart drops pending timers: a browser that reconnects after the restart makes no new events (its last event is still a join), but one that never comes back never gets its "left" event.

### Presence
1. `room:presence` carries the room's full participant list, `[{ presenceKey, name }]`, with one entry per browser. The server builds it from `fetchSockets()` on the Socket.IO room, counts only sockets with a `browserToken` (set only by a successful join), and groups them by that token. Entries are ordered by the earliest join among each browser's open connections, and show the name from the browser's latest join.
2. The server sends it after every join, after a socket leaves a room to join a different one, and on `disconnect`. By `disconnect` the socket has already left its rooms, so the server uses `socket.data.roomId` to find the room, and the room's sockets are the ones that remain.
3. **Browser token.** Each browser has a random token, made once with `crypto.randomUUID()` and kept in local storage as `speakeasy:browserToken`. All its tabs share it, so a second tab, a duplicated tab or a refresh is the same entry, and a refresh whose old connection lingers on the server (when a tunnel or proxy loses the browser's close) never shows twice. The server never disconnects a socket because of the token. A browser leaves the list only when its last connection in the room closes. Without storage, the page uses an in-memory token, so each tab of that browser is its own entry.
4. **Presence key.** Clients never receive the token. Each entry has a `presenceKey`, the base64url SHA-256 of `${roomId}:${browserToken}`: stable for the browser in that room, different in every room, and it does not reveal the token. The join ack returns the browser's own `presenceKey`, and the client marks its entry with "(you)" by it, never by the name. Two browsers with the same name are two entries.
5. The list holds display names, which are already plain text on the server (see Known limits). Names are never logged.
6. The client sets Socket.IO's `closeOnBeforeunload`, so a closing or refreshing tab closes its own connection instead of relying on the browser.

Presence follows the server's view of the connection, so a browser whose network drops without a clean close stays listed until the ping timeout (see section 9). A browser that leaves the list and comes back, or whose earliest open tab closes, can move down the list.

### Send a message
1. Client checks the plain text length, makes a `clientId` (UUID), and adds the message to the list with status `sending`.
2. Client generates a random 12-byte initialisation vector (nonce) and encrypts the text with `crypto.subtle.encrypt`.
3. Client emits `message:send { clientId, ciphertext, iv }` with a 10-second ack timeout.
4. Server checks that the socket has joined (`NOT_JOINED` if not), validates the shape and size, and inserts with `ON CONFLICT (room_id, client_id) DO NOTHING`. The author name and the `author_key` (the browser's `presenceKey`) come from `socket.data`, not from the payload.
5. Server acks the sender with the stored message. The client replaces the pending message, and the status becomes `sent`.
6. Only when a row was inserted, the server broadcasts `message:new` to the other sockets in the room (`socket.to(roomId)`), so the sender does not receive a duplicate.
7. If the ack times out or returns an error, the status becomes `failed` with a retry action. A retry sends the same `clientId`, ciphertext and IV. If the first attempt was stored, the insert hits the conflict, and the server selects the stored row, acks with it and does not broadcast again.

### Reconnect
1. Socket.IO reconnects automatically. The new server-side socket is not in any room. When the server saw the old connection close, it has already sent the room a list without it.
2. On `connect`, the client emits `room:join` again with `since` set to the ID of the last row it has (message or event), and the same browser token, so it keeps the same entry. Events missed while disconnected arrive with this catch-up.
3. Server acks with only the messages after `since`, at most 200. If more than 200 were missed, it returns the newest 200, so the current conversation shows and the oldest missed messages are skipped. The client decrypts them and merges them by message ID.
4. While disconnected, the client keeps showing its last participant list. The next `room:presence` after the rejoin replaces it.

## 4. API contracts

### REST
| Method and path | Response |
|---|---|
| `POST /api/rooms`, optional body `{ nameCiphertext, nameIv }` | `201 { roomId }` or `400 { error: "INVALID_INPUT" }` |
| `GET /api/rooms/:roomId` | `200 { roomId, createdAt, nameCiphertext, nameIv }` (name fields `null` when there is no name) or `404 { error: "ROOM_NOT_FOUND" }` |
| `GET /api/health` | `200 { ok: true }` (Render health check) |
| Any other `/api` request | `404 { error: "NOT_FOUND" }` |

The bodies are typed in `shared/` (see "Shared types" below): `CreateRoomRequest`, `CreateRoomResponse`, `RoomResponse`, and `ErrorResponse` for every error.

`POST /api/rooms` takes either no body or both name fields. Only this route parses JSON, with a 1 KB limit. A body that is not valid JSON, is too large, is not an object, or has only one valid field returns 400 `INVALID_INPUT`, and no room is created. The parser's error message can quote the body, so the route answers it directly instead of passing it to the logging error handler. A body sent with a content type other than JSON is not parsed and counts as no body. The name fields are never logged.

### Socket.IO events
Typed with Socket.IO's `ClientToServerEvents`, `ServerToClientEvents` and `SocketData` generics. The types live in `shared/types.ts`.

**Client to server**
```ts
type JoinPayload = { roomId: string; displayName: string; browserToken: string; since?: number };
type SendPayload = { clientId: string; ciphertext: string; iv: string };

"room:join": (payload: JoinPayload, ack: (result: JoinResult) => void) => void
"message:send": (payload: SendPayload, ack: (result: SendResult) => void) => void
```

**Server to client**
```ts
"message:new": (record: RoomRecord) => void  // a message or a join or leave event
"room:presence": (participants: Participant[]) => void  // the full list, in join order
```

**Socket data**, set by a successful `room:join`:
```ts
type SocketData = { roomId: string; displayName: string; browserToken: string; presenceKey: string; joinOrder: number };
```

- Every handler acks, with `SERVER_ERROR` on any exception. If the client sends no ack function, the server skips the reply instead of crashing.
- The server treats every payload as unknown input and validates it, whatever the types say.
- Logs contain socket IDs and room IDs only, never display names, message content, browser tokens or presence keys.
- `room:presence` goes to the whole room, including the socket that just joined. A client can receive it before or after its join ack.

**Shared types**
```ts
// Every row the server stores and sends: a message or a join or leave event.
type RecordBase = {
  id: number;                // server ID, used for ordering and the `since` cursor (any kind)
  roomId: string;
  authorName: string;        // plain text (see Known limits)
  authorKey: string | null;  // the author's presenceKey. null for rows from before author keys
  createdAt: string;         // ISO 8601
};
type EncryptedMessage = RecordBase & {
  kind: "message";
  clientId: string;
  ciphertext: string;        // base64url, AES-GCM output including the auth tag
  iv: string;                // base64url, 12 bytes
};
type RoomEvent = RecordBase & { kind: "join" | "leave" };  // no encrypted fields
type RoomRecord = EncryptedMessage | RoomEvent;

type ErrorCode = "ROOM_NOT_FOUND" | "NOT_FOUND" | "INVALID_INPUT" | "NOT_JOINED" | "SERVER_ERROR";

// REST
type ErrorResponse = { error: ErrorCode };
type CreateRoomRequest = { nameCiphertext: string; nameIv: string };  // POST /api/rooms, optional body
type CreateRoomResponse = { roomId: string };                          // POST /api/rooms
type RoomResponse = {                                                  // GET /api/rooms/:roomId
  roomId: string;
  createdAt: string;              // ISO 8601
  nameCiphertext: string | null;  // base64url, null when there is no name
  nameIv: string | null;          // base64url, 12 bytes
};

// Socket.IO
type Participant = { presenceKey: string; name: string };  // one browser, however many tabs
type JoinResult =
  | { ok: true; presenceKey: string; messages: RoomRecord[] }
  | { ok: false; error: ErrorCode };
type SendResult = { ok: true; message: EncryptedMessage } | { ok: false; error: ErrorCode };
```

The client-only types add the decrypted text:
```ts
type ChatMessage = Omit<EncryptedMessage, "ciphertext" | "iv"> & {
  body: string | null; // null when decryption fails
};
type ChatRecord = ChatMessage | RoomEvent;
```

### Validation
| Field | Where | Rule |
|---|---|---|
| plain text body | client | trimmed, 1 to 2,000 characters |
| display name | client | trimmed, 1 to 32 characters |
| room name | client | trimmed, at most 60 characters. Empty means no name |
| `roomId` | server | UUID format (`INVALID_INPUT`), and must exist (`ROOM_NOT_FOUND`) |
| `displayName` | server | trimmed, 1 to 32 characters |
| `browserToken` | server | required, UUID format |
| `since` | server | optional, non-negative integer |
| `clientId` | server | UUID format |
| `iv` | server | base64url without padding, exactly 16 characters, which is 12 bytes |
| `ciphertext` | server | base64url without padding, 1 to 12,000 characters |
| `nameCiphertext`, `nameIv` | server | both or neither. `nameIv` as `iv`. `nameCiphertext` base64url without padding, 1 to 400 characters |

Lengths are JavaScript string lengths (UTF-16 code units) on both sides. Failed checks return `INVALID_INPUT`. A 60-character name is at most 180 bytes of UTF-8, plus the 16-byte tag, which is 262 base64url characters, so 400 leaves room without allowing large values.

The server cannot read the text, so it can only limit the ciphertext size. 2,000 UTF-16 code units are at most 6,000 bytes of UTF-8 (3 bytes per unit, or 4 bytes per surrogate pair). With the 16-byte tag that is 6,016 bytes, or 8,022 base64url characters, well under 12,000. Socket.IO `maxHttpBufferSize` is set to 32 KB, so a larger packet closes the connection before any handler runs. The client then reconnects, and that message fails after its ack timeout.

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id          uuid PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS name_ciphertext text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS name_iv text;

CREATE TABLE IF NOT EXISTS messages (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id      uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL,
  author_name  text NOT NULL,
  ciphertext   text NOT NULL,
  iv           text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, client_id)
);

CREATE INDEX IF NOT EXISTS messages_room_id_id ON messages (room_id, id);

-- Join and leave events, and an author key on every row
ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_key text;
ALTER TABLE messages ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN ciphertext DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN iv DROP NOT NULL;
-- messages_kind_fields, added in a DO block only when pg_constraint does not have it:
--   (kind = 'message' AND client_id, ciphertext and iv are NOT NULL)
--   OR (kind IN ('join', 'leave') AND author_key IS NOT NULL AND client_id, ciphertext and iv are NULL)
CREATE INDEX IF NOT EXISTS messages_room_author_events
  ON messages (room_id, author_key, id) WHERE kind IN ('join', 'leave');
```

- **`bigint` identity ID:** gives a strict order and a simple `since` cursor. Timestamps can tie.
- **`UNIQUE (room_id, client_id)`:** makes retries safe. If the insert succeeded but the ack was lost, the retry hits the conflict. The server then returns the stored row and does not broadcast again.
- **Base64url text columns:** simple to send as JSON. `bytea` would save some space but adds encoding steps on both sides.
- **No key column:** the server never receives the key, so it cannot store it.
- **Encrypted room name:** `name_ciphertext` and `name_iv` hold the optional name, encrypted like a message. Both are null when there is no name.
- **Schema setup:** the server runs this file at startup. It is idempotent. A migration tool is not needed for two tables.
- **Added columns:** `CREATE TABLE IF NOT EXISTS` does not change a table that already exists, as in production. Columns added later use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. They are nullable, so rooms created before them have no name, and the previous server version can still insert rooms after the change.
- **Events in the messages table:** join and leave events are rows of `kind` `'join'` or `'leave'`, so the history and the `since` catch-up return them in order with the messages, with no second query. The CHECK constraint keeps messages with their encrypted fields and events without any.
- **`author_key`:** the author's `presenceKey`, on messages and events. It tells two people with the same name apart, and finds your own messages. Rows from before it have none, and are never shown as yours.
- **Idempotent constraint:** Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so a `DO` block checks `pg_constraint` first. The `kind` default fills existing rows with `'message'`, so the constraint holds on old data.
- **Last-event index:** the partial index on `(room_id, author_key, id)` for join and leave rows serves the "last event of this browser in this room" lookup.
- **Database access:** the `pg` package with a connection pool and plain parameterised SQL. No ORM.
- **Later-list:** `rooms.expires_at` for the expiry setting.

## 6. Client state

One `useReducer` per room screen. No global state library.

```ts
type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
type MessageStatus = "sending" | "sent" | "failed";
type SendFailure = "network" | "server" | "invalid";  // no ack in time, SERVER_ERROR, INVALID_INPUT

type RoomState = {
  connection: ConnectionState;
  messages: ChatRecord[];                   // confirmed messages (decrypted) and events, by id
  pending: { clientId: string; body: string; status: MessageStatus;
             queuedAt: string; failure?: SendFailure;
             ciphertext?: string; iv?: string }[];
  participants: Participant[];              // the last room:presence list
  presenceKey: string | null;               // this browser's entry, from the latest join ack
  linkSaved: boolean;                       // true after the link was copied or shared
  historyLoaded: boolean;                   // true after the first join ack
};
```

- `App` reads the encoded key from `location.hash` and passes it to the room screen (`RoomPage`). The room screen imports it once, before the room lookup, and passes the `CryptoKey` to the chat component as a prop. The key exists only in the URL and in memory. It is never written to local storage, session storage or logs, and never sent in a request.
- Encryption code lives in one small module (`client/crypto.ts`) with four async functions, `generateKey`, `importKey`, `encrypt` and `decrypt`, plus `isEncryptionAvailable`. The rest of the client does not call Web Crypto directly.
  - `generateKey` makes an extractable 256-bit AES-GCM key only to export its raw bytes as base64url for the link.
  - `importKey` throws on any invalid input and returns a non-extractable key.
  - `encrypt` uses a new 12-byte IV from `crypto.getRandomValues` for every call and returns base64url ciphertext (including the 16-byte tag) and IV.
  - `decrypt` uses the IV stored with the message and throws on a wrong key or tampered data. The chat screen catches this per message and shows the placeholder.
- The display name comes from local storage, or from a name prompt that saves it. Storage access is wrapped in try/catch, so a browser that blocks storage still works for the visit.
- `connected` means the socket is connected and the `room:join` ack has arrived. Until then the state stays `connecting` or `reconnecting`, so nothing is sent before the server knows the room.
- Confirmed messages are merged by id and sorted by id. A confirmed message removes the pending message with the same `clientId`, whether it came from the send ack or from a rejoin.
- Pending messages show after confirmed messages, in send order. A retry reuses the stored `clientId`, ciphertext and IV.
- The send button is disabled when the connection is not `connected`. Enter sends and Shift+Enter adds a line.
- Message text is rendered as React text with `white-space: pre-wrap`, never as HTML.
- Socket.IO buffers emits while disconnected by default. The disabled button prevents most of this, and the `clientId` makes any late delivery safe.
- Each `room:presence` replaces the whole participant list. The join ack sets `presenceKey` (and `connected`) in a separate action, so the two can arrive in either order. "(you)" shows on the entry whose `presenceKey` matches.
- `RoomPage` gets the browser token from local storage (`speakeasy:browserToken`), or makes and stores one, and passes it to the chat component. Storage access is wrapped in try/catch, with an in-memory token as the fallback.
- Local storage holds only the display name, the browser token and the theme choice (`speakeasy:theme`, only "light" or "dark", absent until the user uses the toggle). Session storage is not used.
- `ChatRoom` owns the socket and the reducer, and renders `RoomHeader`, `MessageList` (with `SharePanel` and `Toast`), `Composer`, `ParticipantPanel` and `LeaveDialog`. A pending message keeps its `queuedAt` time until the server's time arrives, and its `failure` decides the text and whether Retry shows.
- `linkSaved` becomes true after a successful copy (header, share panel or leave dialog) or share of the link.
- **History entry state.** The tab's history entry for the room holds `{ createdHere, linkSaved }`. Creating a room pushes the room entry with `createdHere: true`, and a copy or share replaces it with `linkSaved: true`. It is not storage: it survives a refresh in the same tab and never reaches other tabs. A joiner's entry has neither, so a joiner never sees the leave dialog.
- **Retries.** A room lookup or `room:join` that fails with a network error, `SERVER_ERROR` or no ack in time is tried again after 1, 2 and 4 seconds, then every 10 seconds (`client/retry.ts`). A join is also tried again at once on every socket connect. `ROOM_NOT_FOUND` is final.
- `historyLoaded` becomes true with the first join ack. Until then the list shows no "No messages yet.".
- Until the room lookup has found the room, `ChatRoom` gets `roomName` and `roomKey` as null: it shows the room layout and does not connect.
- Your own messages and events are the ones whose `authorKey` equals your `presenceKey`. A row with no `authorKey` (from before author keys) is never yours. Two tabs of one browser share the key, so both show its messages as yours.
- Only messages are decrypted. Messages and events are merged and ordered by id, and `since` is the id of the last row of any kind.
- On a disconnect the list is kept as it was, with "(you)" still on the old entry, until the first `room:presence` after the rejoin. The room screen shows the count and the names, and nothing before the first list arrives.

## 7. Error handling

| Failure | Behaviour |
|---|---|
| Unknown room | 404 on the room check, "room not found" screen |
| Room check fails (server error or no connection) | The room layout stays with "Reconnecting" while the lookup is tried again after 1, 2 and 4 seconds, then every 10 seconds. After 3 failures in a row, the "Could not load the room" screen with Try again, and the retries go on behind it. When one succeeds, the room shows. Try again starts over at once |
| Unknown path | "Page not found" screen. The server also answers with status 404 |
| Missing or invalid key in the link | "This link is incomplete" screen, with a hint to ask for the full link. No room lookup and no join |
| No Web Crypto (not a secure context) | "This browser cannot encrypt messages" screen on every route, with no requests to the API or socket |
| Message fails to decrypt | Shown as "Unable to decrypt this message", other messages still show |
| Invalid input | Ack with `INVALID_INPUT`, message marked failed with the reason and no retry, because a retry fails again |
| Copy link fails (Clipboard API missing or refused) | A small panel under the header shows the full link in a focused, selected field to copy by hand. Escape or Close hides it |
| Message over 2,000 characters | Rejected in the client with an inline message. The draft is kept and nothing is sent |
| Join fails with `SERVER_ERROR`, no ack in time or a network error | Status "Reconnecting", and the join is tried again on the same timing and at once on every socket connect. After 3 failures in a row, the "Could not load the room" screen with Try again, with the retries going on behind it |
| Join fails with `ROOM_NOT_FOUND` | "Room not found" screen. Final, no retry |
| Server restart, also a full `npm run dev` restart | The room recovers by itself: the socket reconnects and joins, and a page that reloads (Vite does that after its own restart) retries the lookup until the server answers |
| Copy link fails | See "Copy link fails" above. In the leave dialog, "Copy link and leave" then shows the fallback panel and does not leave |
| Database error | Ack with `SERVER_ERROR`, message marked failed with retry |
| Ack timeout | Message marked failed with retry (same `clientId`) |
| Packet over 32 KB | Socket.IO closes the connection. The client reconnects and the message fails after its ack timeout |
| Connection drop | Status shows reconnecting, send disabled, rejoin and backfill on reconnect |
| Server restart | Same as connection drop. Data is safe in Postgres |
| Free-tier spin-down | Not on the paid instance used during the review period. On the free tier, Render shows a loading page for about a minute. Documented in the README |

## 8. Security notes and gotchas

- **Secure context:** Web Crypto (`crypto.subtle`) works only on HTTPS or `localhost`. Testing on a phone through the dev server's LAN IP fails, because `crypto.subtle` is undefined there. The app checks for it before showing any screen and shows "This browser cannot encrypt messages" instead. Test on the deployed HTTPS URL, or use a tunnel.
- **Keep the fragment:** navigation after room creation must include the hash. Any redirect or rewrite must keep it.
- **Unique IV per message:** never reuse an IV with the same key. Generate 12 random bytes for each message with `crypto.getRandomValues`.
- **Logging:** log connects, joins and errors with the socket ID and room ID only. Never log the URL fragment, ciphertext or display names.
- **Rendering:** decrypted text is rendered as text only. A decrypted message is still untrusted input from another user.

## 9. Scale and reliability

- **Load:** one small Node process can hold thousands of idle sockets. Demo traffic uses a very small part of that. Encryption runs in the browser, so it adds no server load.
- **Database:** Neon free tier is enough. Compute scales to zero when idle and resumes quickly.
- **Single instance:** Socket.IO rooms live in process memory, so a second instance would not see the first instance's rooms. This is accepted for the MVP.
- **Presence after a network loss:** a closed tab or a clean disconnect leaves the list at once, as soon as it was the browser's last connection in the room. With `closeOnBeforeunload`, this also holds through a tunnel that loses the browser's close. A user who loses the network without a clean close (Wi-Fi drops, laptop sleeps) stays in the list until the Socket.IO ping timeout. The server uses the defaults, a ping every 25 seconds and 20 seconds to answer, so that is between about 20 and 45 seconds. In testing it was 30 and 43 seconds. If that browser reconnects on a new connection first, for example after a refresh through a tunnel or a network switch, both connections share its browser token, so it stays one entry. The old connection is dropped at the ping timeout without any visible change. Shorter ping settings would shorten this, at the cost of more traffic and more false disconnects on slow mobile networks. The "left" event follows 5 seconds after the server drops the connection, so after a network loss it appears after the ping timeout plus 5 seconds: 50.8 seconds in testing.
- **Events and one instance:** pending "left" timers and the per-browser event queue live in process memory, like Socket.IO rooms. A second instance would need them in shared storage.
- **Monitoring:** Render logs and the `/api/health` check.

## 10. Trade-offs

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Access control | Secret link | Accounts or room passwords | Much less to build, faster join. Anyone with the full link can join and read. |
| Message privacy | End-to-end, key in URL fragment | Server-side encryption at rest | A key stored next to the database does not protect against the server. The fragment never reaches the server. |
| What is encrypted | Message text and the room name | Display names and timestamps too | Keeps the server able to order, validate and display basic metadata. |
| Real-time | Own Socket.IO server | Managed service (Pusher, Ably, Supabase Realtime) | Shows the real-time work, one codebase. More code to own. |
| Socket library | Socket.IO | `ws` | Reconnection, acks and rooms built in. Larger client bundle. |
| History on join | In the join ack | Separate REST endpoint | One round trip, and the same path handles reconnect backfill. |
| Missed messages | Rejoin with `since` | Socket.IO connection state recovery | Works across server restarts because it reads from Postgres. |
| Sender echo | Ack to sender, broadcast to others | Broadcast to all, dedupe on client | No duplicate handling on the client. |
| Retries | Idempotent `clientId` | No retries | Safe retry with one unique constraint. |
| Storage | Postgres on Neon | SQLite, in-memory | Render's free tier has no persistent disk, and the app can go back to it. |
| Routing | Manual, two routes | React Router | No dependency for two screens. |
| Client state | `useReducer` | Redux, Zustand | One screen with local state. |

## 11. Future improvements

- **More instances:** add the Socket.IO Redis adapter and sticky sessions.
- **Abuse:** rate limits per socket and per IP, and limits on room creation.
- **Long rooms:** "load older messages" with `before` pagination.
- **Room settings:** expiry with a cleanup job (also limits exposure of a leaked link), participant limit, and a creator token to manage them.
- **Room password:** derive the key from a password (PBKDF2) instead of putting it in the link, so a leaked link alone is not enough.
- **Stronger encryption model:** key rotation, encrypted display names, and AES-GCM additional data that binds each ciphertext to its room, its type (name or message) and its `clientId`. Today someone with the room ID could post the stored name ciphertext, or an old message, as a new message, and it would decrypt.
- **Proof of key to join:** the client derives a token from the key, and the server allows a join only with that token. This stops people who have only the room ID.
- **Identity:** accounts and invite-only rooms. Sign in with an email magic link, the creator invites people by email, and the server allows a join only for invited members, so a leaked link alone is not enough. Then moderation: remove a person and rotate the key, because a removed member still has the old key.
- **Typing indicators:** from Socket.IO room membership, sent like presence.
- **Messages:** read receipts, edit and delete, and file and image uploads.
- **Tests:** Firefox and WebKit, phone widths, and the theme toggle in the accessibility check.
- **Hosting:** the app runs on a paid Render instance during the review period, so it never spins down. It can go back to the free tier later, which brings back a cold start of about a minute after a quiet period.

## 12. Visual design

### Purpose
Go from "Create a room" to chatting with a friend in less than 30 seconds. The one memorable element is the share moment: the link is shown with the key part highlighted, because the key in the link is what makes Speakeasy private.

### Colour tokens
Light and dark mode follow the system setting until the user chooses one with the theme toggle.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#E8EDE9` | `#121815` | Page |
| `surface` | `#FFFFFF` | `#1B231F` | Header, composer bar, other people's messages |
| `chip` | `#E8EDE9` | `#36423B` | Small fills on `surface`: the participant count badge, other people's initials avatars. Text on it uses `text` (8.8:1 in dark) |
| `divider` | `#CAD4CE` | `#2B3530` | Lines between header, messages and composer. In dark mode also the edge of other people's messages |
| `text` | `#17201B` | `#E6EDE8` | Main text |
| `muted` | `#5C6660` | `#9AA59F` | Names, times, help text, placeholders |
| `field-border` | `#73897D` | `#5F7468` | Edge of input fields (3:1 or more) |
| `accent` | `#1F5C45` | `#1E5A43` | Main buttons, your messages |
| `on-accent` | `#FFFFFF` | `#E9F2EC` | Text and icons on accent |
| `on-accent-muted` | `#C2D9CD` | `#BCD3C7` | Times and labels on your own messages (`muted` fails on `accent`) |
| `focus` | `#1F5C45` | `#7CC9A1` | Focus rings, links |
| `danger` | `#B42318` | `#F28B82` | Failed messages, errors |

All text pairs meet WCAG AA (4.5:1). Field edges and focus rings meet 3:1.

### Type
- Instrument Sans for all text, self-hosted (no request to a font service, because the app is about privacy). The `@fontsource-variable/instrument-sans` package provides the variable font (weights 400 to 700), and Vite bundles its files with the client. index.html preloads the Latin font file, and `main.tsx` waits for the face (at most 300 ms) before the first render, so the text never changes font after the first paint.
- Monospace only for the room link in the share panel, because the key is a token that users must see exactly.
- Hierarchy from size and weight. Sentence case. No all-caps labels.
- Headings use `text-wrap: balance` and body text `text-wrap: pretty`, so lines break evenly and paragraphs avoid a single word on the last line.

### Layout
- App header on every screen: 56px, `surface` with a `divider` bottom border. Left: the logo mark (the favicon's speech bubble with a keyhole) and "Speakeasy", a link to the home page. Right: content for the current screen.
- Home: only the theme toggle on the right of the header. One narrow column, centred, with left-aligned text: the heading "Private rooms for quick conversations", one line about encryption, the field "Room name (optional)", and "Create a room".
- Room: the header holds the room name (or "Untitled room") with the connection status under it, then the participant button, "Copy link", the theme toggle and "Leave room", in that order. On mobile: the logo mark only, a shortened room name, and icon buttons with aria-labels. Below the header: the message list, then the composer bar fixed at the bottom.
- Room name: the room heading and the tab title show it, or "Untitled room".
- Participant list: on desktop (900px and wider), a narrow side panel that is always visible, so the header has no participant button. On mobile, the participant button ("3") opens the list as a panel over the messages, with a backdrop.
- Each participant has an initials avatar (accent for your own entry, `chip` for others) and the panel has a "Participants" heading with the count.
- Share panel: at the top of the message list from the join ack while the room has no messages of kind `'message'` (events do not count, and a pending message of your own does). It shows the full link in monospace, wrapping anywhere, with the part after # in `text` on a `chip` fill (14.1:1 in light, 8.8:1 in dark), the line "The part after # is the key. It never leaves your browser." (so colour is not the only signal), "Copy link" (the same copy, tick and toast as the header button) and "Share" only where `navigator.share` exists. A completed share sets `linkSaved`; an `AbortError` (the user closed the share sheet) does not. After the first message, the panel goes away, and "Copy link" in the header is the way to share. It replaces "No messages yet.".
- Messages: yours on the right in `accent`, other people's on the left in `surface` (with a `divider` edge in dark mode only). The name shows on the first message of each group of other people's messages, and the time once, on the last message of a group (see "Message groups").
- Short conversations sit at the bottom of the list, next to the composer. The message log (the wrapper around the list) has `margin-top: auto` inside the scrolling column, so a long list still scrolls normally.
- "Leave room" (secondary button, last in the header) closes the connection and goes to the home page. The room and its messages stay. The browser Back button returns to the room, because the full link is in the history.
- Leaving (the "Leave room" button or the logo link) asks for confirmation only when this tab created the room and the link was not copied or shared (`createdHere` and `linkSaved` from the history entry, see section 6). The native `<dialog>`, opened with `showModal()`: title "Save the link before you leave?", text "You have not copied the link for this room. Without it, you cannot come back, and nobody can recover it.", and "Copy link and leave" (primary), "Leave anyway" and "Stay". Focus starts on "Copy link and leave" and stays in the dialog; Escape means "Stay", and Stay returns focus to the button or link that opened it. If the copy fails, the fallback panel shows and the user stays. The browser Back button and closing the tab are not intercepted.
- Theme toggle in the header on every screen, before "Leave room" in the room. The first visit follows the system setting. The button switches between light and dark and saves the choice in local storage (`speakeasy:theme`). Other open tabs apply the change at once, from the `storage` event. An inline script in index.html applies it before the first paint, so the page never shows the wrong theme first.

### Styles
- One stylesheet, `client/styles.css`, with the colour tokens as CSS custom properties. Each token is a `light-dark()` pair, and `color-scheme` on `:root` picks the side: `light dark` follows the system setting, and `data-theme="light"` or `"dark"` on `<html>` (set by the toggle and by the script in index.html) fixes it. No CSS framework.
- Icons come from `lucide-react`. Buttons that show only an icon have an `aria-label`.
- Base styles for the body, headings, buttons, text fields, focus and errors. Buttons are primary (`accent`) by default, and `secondary` buttons have a `field-border` outline. Disabled buttons are transparent with a `divider` edge and `muted` text, so the text keeps its contrast on `bg` and on `surface` (`muted` on the dark `chip` would be only 4.1:1). Text fields have a `field-border` edge, which turns `danger` while the field is invalid. On `:focus-visible`, buttons and links show a 2px `focus` outline with a 2px offset. A text field shows focus on its own border instead: the border turns `focus` and an inset 1px shadow makes it look 2px thick, so the field keeps its size and there is no ring outside it. Inline errors use `danger`.
- The home page, the name prompt and the state screens share one column (`.page`): about 28rem wide, centred horizontally, with left-aligned text. It starts at a fixed distance from the top (`min(18vh, 160px)`), not centred vertically, so the content does not move when an error message appears.
- The favicon (`client/public/favicon.svg`) is a speech bubble with a keyhole in `accent`. A `prefers-color-scheme: dark` query inside the SVG switches it to the dark `focus` green (`#7CC9A1`), so it stays clear in a dark tab bar.

### Components
- Message field: pill shape, `field-border` edge, and the same focus style as other text fields (the border turns `focus`, no ring outside). It grows to about 5 lines, then scrolls.
- Send button: round, `accent`, send icon, `aria-label="Send"`.
- One state screen component (`StateScreen`: title, one or two sentences, optional action button) for: incomplete link, room not found, page not found, cannot encrypt, could not load (with Try again). The text says what happened and what to do. The title, text and action are centred in the column; the home page and the name prompt stay left-aligned.
- Connection status: small dot with text, under the room name. Filled `focus` when connected, filled `danger` when disconnected, an outline while connecting or reconnecting. The text is always there.
- Room header buttons: the participant button only below 900px, then "Copy link", the theme toggle and "Leave room". The room header has one breakpoint, 900px, the same as the participant panel: below it the buttons show only their icons (the names stay for screen readers) and the logo shows only its mark. The buttons never shrink. The room name and status column takes the remaining width (`flex: 1`, `min-width: 0`), and both of its lines are cut with an ellipsis.
- Copy link: copies the full link with the Clipboard API. The button shows a tick and "Copied" for 2 seconds, and a toast "Link copied" shows above the composer for about 2.5 seconds on every screen size. If the copy fails, the fallback panel in section 7 shows instead.
- Toast (`Toast`): one small component for short confirmations, centred just above the composer, `text` background with `bg` text. It shares one stack with the "New messages" button (the button above, the toast below, 8px apart), so both stay visible when they show at the same time. Its region has `aria-live="polite"` and stays in the page, so screen readers hear each message.
- Participant panel: a "Participants" heading (h2) with the count as a small pill badge 8px after it (`chip` fill, `text` colour, 12px, vertically centred). The visible word and the badge are hidden from screen readers, and one visually hidden text makes the heading read "Participants, 1 person" or "Participants, 3 people" (separate pieces in the flex heading would be read with a space before the comma). On mobile it is the panel title, next to the close button. Each entry has an initials avatar (`aria-hidden`): a circle with the first character of the first two words of the name (by code point, so an emoji stays whole). Other people: `chip` fill with `text` initials. You: `accent` fill with `on-accent` initials.
- Participant panel below 900px: the participant button is a toggle (`aria-expanded`) that opens and closes it. It opens over the messages with a semi-transparent backdrop and focus on its close button. Escape, the close button, the participant button or a click on the backdrop closes it, and focus returns to the participant button.
- Composer: the message field and the round send button. When not connected, the send button is disabled and a `muted` line above the field says why ("Connecting...", "Reconnecting..." or "Disconnected. Reload the page to reconnect."). The 2,000-character error shows above the field in `danger`.
- Empty room: the share panel, from the join ack.

### Room loading
- A room link shows the room layout at once: the app header with an empty room name, an empty list, and the composer with "Connecting..." and Send disabled. There is no separate loading screen.
- The room name fills in when it is decrypted: the name, or "Untitled room" when there is none. "Untitled room" never shows before a real name.
- "Loading messages...", centred in the list, shows only when the history takes longer than 300 ms.
- The history renders in one pass, with no slide-in, and the scroll position is set in `useLayoutEffect` before the paint.
- State screens (incomplete link, room not found, could not load) and the first-visit name prompt replace the layout when needed.

### Message states
- Sending: a "Sending..." label in `muted` next to the time. The message text keeps full contrast (no lower opacity).
- Failed: `danger` text with the reason under the message ("Failed to send. Check your connection.", "... The server had a problem." or "... The server did not accept this message."). Retry for network and server errors. No Retry for `INVALID_INPUT`.
- Decrypt failure: "Unable to decrypt this message" in `muted` italics.
- On your own messages the time and labels use `on-accent-muted`.
- Long words and links wrap anywhere (`overflow-wrap: anywhere`), and line breaks are kept.

### Message groups
- A new group starts when the author changes (by `authorKey`, or by name for rows without one), when more than 2 minutes pass between two messages (`groupGapMs` in `MessageList.tsx`), or after a join or leave event.
- The first message of a group of other people's messages shows the name, also when a pause started the group.
- The time shows once per group, on its last message. A sending message always shows "Sending...", with the time when it is the last of its group.

### Scrolling
- The list opens at the bottom. A new message keeps it at the bottom when it was already there (within 48px).
- When the user has scrolled up, new messages do not move the list. A "New messages" button appears and scrolls to the bottom. Only a new message of kind `'message'` from someone else shows it: not events, and not your own.
- Your own new message always scrolls to the bottom.
- The room fits exactly in `100dvh` and only the message list scrolls. The list's scroll container is `position: relative`, so the visually hidden "You" labels inside it scroll and clip with it. Without that, labels below the view made the whole page taller.
- The list's scroll container is focusable (`tabIndex 0`, a region named "Conversation"), so the keyboard can scroll it, and its focus ring is an inset outline. When it has focus, Enter moves focus to the composer, and a printable key moves focus to the composer and adds that character to the end of the draft. Space, the arrow keys, Page Up, Page Down, Home, End, Tab and shortcuts with Ctrl, Meta or Alt keep their normal behaviour. A click in the list still focuses it, so text can be selected and copied.
- Wrong key: when the room has at least one message of kind `'message'` and none of them decrypt, a banner above the list says "This link does not match this room. Ask for the full link." (`danger` on `surface`, `role="alert"`), and the composer is disabled with the reason "Sending is off, because this link does not match this room." A later message that decrypts removes the banner and turns sending back on.
- Join and leave events: small, centred `muted` text, "Bob joined the room" or "Bob left the room", and "You joined the room" or "You left the room" for your own browser. Not bubbles, no time. An event ends a message group. New events slide in like new messages; events from the history do not. Two events in a row are 4px apart; between an event and a message the normal 1rem gap stays.
- The share panel shows while the room has no messages, even when it has events.

### Motion
One main moment: a short slide-in (180 ms) for new messages and events. History and catch-up messages from a join do not slide in. The toast fades in over 150 ms, and controls change colour with a 150 ms transition on hover. No motion at all when the user prefers reduced motion.

### Accessibility and mobile
- Visible focus rings on all controls. Labels use `htmlFor`.
- The message list is an `<ol>` inside an element with `role="log"`, so screen readers announce new messages and still read the messages as a list.
- The end-to-end tests run axe on the home page, the empty room with the share panel, the open leave dialog and a room with a message, in light and dark, and allow no serious or critical violations.
- Layout uses `100dvh` and safe-area insets, so the composer stays above the mobile keyboard.