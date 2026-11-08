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

### Non-functional
- **Scale:** demo traffic. Tens of concurrent users, a few messages per second at most.
- **Latency:** messages should feel instant. Optimistic UI hides network and encryption time for the sender.
- **Cost:** $0 hosting.
- **Availability:** best effort. One instance. A free-tier cold start of about a minute is accepted and documented.
- **Security:** rooms are protected by an unguessable link. Message text is encrypted in the browser and the server never sees the key. Input is validated on the server. Message text is never rendered as HTML.

### Constraints
- One developer, 20-hour time box, due Friday 13 November 2026.
- TypeScript, Node, Express 5, Socket.IO, React with Vite, Postgres on Neon, Render.

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
| `/` | Home: "Create room" button |
| `/r/:roomId#key` | Room: name prompt (first visit), then chat |

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
5. Client navigates to `/r/:roomId#<key>` with `history.pushState` and shows the copy-link action. The copied link always includes the fragment.

### Join a room
1. Client reads the key from `location.hash` and imports it with `crypto.subtle.importKey` (AES-GCM, not extractable, encrypt and decrypt only). The key must be exactly the 43 base64url characters that `generateKey` makes: 32 bytes, no padding, no `+` or `/`, no whitespace. If the key is missing or invalid, the client shows the "incomplete link" screen and stops, with no room lookup and no socket. Changing only the fragment in the address bar does not reload the page, so the client listens for `hashchange` and starts a fresh room screen with the new key.
2. Client checks `GET /api/rooms/:roomId`. A 404 shows the "room not found" screen before the user types a name. Otherwise the client decrypts the room name with the key and shows it in the heading, with the tab title `<name> | Speakeasy`. A room with no name, or a name that does not decrypt (for example with a wrong key), shows "Untitled room" and the page works as normal. The title goes back to "Speakeasy" when the room screen closes.
3. Client gets the display name from local storage, or asks for it.
4. Client emits `room:join { roomId, displayName }`.
5. Server validates and leaves any other room the socket was already in, then sends `room:presence` to that room. It puts the socket in the Socket.IO room and stores `roomId`, `displayName`, a new `participantId` (`crypto.randomUUID()`) and a join counter on `socket.data`. It acks with the `participantId` and the last 50 messages in ascending id order. It joins before it loads, so a message sent in between is not missed. A duplicate from that overlap is dropped by id on the client.
6. After the ack, the server sends `room:presence` to everyone in the room (see "Presence").
7. Client decrypts each message. A message that fails to decrypt shows as "Unable to decrypt this message".

### Presence
1. `room:presence` carries the room's full participant list, `[{ participantId, name }]`, sorted by the join counter, so it is in join order. The server builds it from `fetchSockets()` on the Socket.IO room and counts only sockets with a `participantId`, which is set only by a successful join.
2. The server sends it after every join, after a socket leaves a room to join a different one, and on `disconnect`. By `disconnect` the socket has already left its rooms, so the server uses `socket.data.roomId` to find the room, and the room's sockets are the ones that remain.
3. Every join gets a new `participantId`, so two people with the same name are two entries, and a reconnect replaces the old entry instead of adding a second one. The client marks its own entry with "(you)" by matching the `participantId` from its join ack, never the name.
4. The list holds display names, which are already plain text on the server (see Known limits). Names are never logged.

Presence follows the server's view of the connection, so a person whose network drops without a clean close stays listed until the ping timeout (see section 9).

### Send a message
1. Client checks the plain text length, makes a `clientId` (UUID), and adds the message to the list with status `sending`.
2. Client generates a random 12-byte initialisation vector (nonce) and encrypts the text with `crypto.subtle.encrypt`.
3. Client emits `message:send { clientId, ciphertext, iv }` with a 10-second ack timeout.
4. Server checks that the socket has joined (`NOT_JOINED` if not), validates the shape and size, and inserts with `ON CONFLICT (room_id, client_id) DO NOTHING`. The author name comes from `socket.data`, not from the payload.
5. Server acks the sender with the stored message. The client replaces the pending message, and the status becomes `sent`.
6. Only when a row was inserted, the server broadcasts `message:new` to the other sockets in the room (`socket.to(roomId)`), so the sender does not receive a duplicate.
7. If the ack times out or returns an error, the status becomes `failed` with a retry action. A retry sends the same `clientId`, ciphertext and IV. If the first attempt was stored, the insert hits the conflict, and the server selects the stored row, acks with it and does not broadcast again.

### Reconnect
1. Socket.IO reconnects automatically. The new server-side socket is not in any room. When the server saw the old connection close, it has already sent the room a list without it.
2. On `connect`, the client emits `room:join` again with `since` set to the ID of the last confirmed message it has. The rejoin gets a new `participantId`.
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
type JoinPayload = { roomId: string; displayName: string; since?: number };
type SendPayload = { clientId: string; ciphertext: string; iv: string };

"room:join": (payload: JoinPayload, ack: (result: JoinResult) => void) => void
"message:send": (payload: SendPayload, ack: (result: SendResult) => void) => void
```

**Server to client**
```ts
"message:new": (message: EncryptedMessage) => void
"room:presence": (participants: Participant[]) => void  // the full list, in join order
```

**Socket data**, set by a successful `room:join`:
```ts
type SocketData = { roomId: string; displayName: string; participantId: string; joinOrder: number };
```

- Every handler acks, with `SERVER_ERROR` on any exception. If the client sends no ack function, the server skips the reply instead of crashing.
- The server treats every payload as unknown input and validates it, whatever the types say.
- Logs contain socket IDs and room IDs only, never display names or message content.
- `room:presence` goes to the whole room, including the socket that just joined. A client can receive it before or after its join ack.

**Shared types**
```ts
// What the server stores and sends. It never contains plain text.
type EncryptedMessage = {
  id: number;          // server ID, used for ordering and the `since` cursor
  clientId: string;
  roomId: string;
  authorName: string;  // plain text (see Known limits)
  ciphertext: string;  // base64url, AES-GCM output including the auth tag
  iv: string;          // base64url, 12 bytes
  createdAt: string;   // ISO 8601
};

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
type Participant = { participantId: string; name: string };  // one joined socket
type JoinResult =
  | { ok: true; participantId: string; messages: EncryptedMessage[] }
  | { ok: false; error: ErrorCode };
type SendResult = { ok: true; message: EncryptedMessage } | { ok: false; error: ErrorCode };
```

The client-only type adds the decrypted text:
```ts
type ChatMessage = Omit<EncryptedMessage, "ciphertext" | "iv"> & {
  body: string | null; // null when decryption fails
};
```

### Validation
| Field | Where | Rule |
|---|---|---|
| plain text body | client | trimmed, 1 to 2,000 characters |
| display name | client | trimmed, 1 to 32 characters |
| room name | client | trimmed, at most 60 characters. Empty means no name |
| `roomId` | server | UUID format (`INVALID_INPUT`), and must exist (`ROOM_NOT_FOUND`) |
| `displayName` | server | trimmed, 1 to 32 characters |
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
```

- **`bigint` identity ID:** gives a strict order and a simple `since` cursor. Timestamps can tie.
- **`UNIQUE (room_id, client_id)`:** makes retries safe. If the insert succeeded but the ack was lost, the retry hits the conflict. The server then returns the stored row and does not broadcast again.
- **Base64url text columns:** simple to send as JSON. `bytea` would save some space but adds encoding steps on both sides.
- **No key column:** the server never receives the key, so it cannot store it.
- **Encrypted room name:** `name_ciphertext` and `name_iv` hold the optional name, encrypted like a message. Both are null when there is no name.
- **Schema setup:** the server runs this file at startup. It is idempotent. A migration tool is not needed for two tables.
- **Added columns:** `CREATE TABLE IF NOT EXISTS` does not change a table that already exists, as in production. Columns added later use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. They are nullable, so rooms created before them have no name, and the previous server version can still insert rooms after the change.
- **Database access:** the `pg` package with a connection pool and plain parameterised SQL. No ORM.
- **Later-list:** `rooms.expires_at` for the expiry setting.

## 6. Client state

One `useReducer` per room screen. No global state library.

```ts
type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
type MessageStatus = "sending" | "sent" | "failed";

type RoomState = {
  connection: ConnectionState;
  messages: ChatMessage[];                  // confirmed and decrypted, ordered by id
  pending: { clientId: string; body: string; status: MessageStatus;
             ciphertext?: string; iv?: string }[];
  participants: Participant[];              // the last room:presence list
  participantId: string | null;             // this client's entry, from the latest join ack
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
- Each `room:presence` replaces the whole participant list. The join ack sets `participantId` (and `connected`) in a separate action, so the two can arrive in either order. "(you)" shows on the entry whose `participantId` matches.
- On a disconnect the list is kept as it was, with "(you)" still on the old entry, until the first `room:presence` after the rejoin. The room screen shows the count and the names, and nothing before the first list arrives.

## 7. Error handling

| Failure | Behaviour |
|---|---|
| Unknown room | 404 on the room check, "room not found" screen |
| Missing or invalid key in the link | "This link is incomplete" screen, with a hint to ask for the full link. No room lookup and no join |
| No Web Crypto (not a secure context) | "This browser cannot encrypt messages" screen on every route, with no requests to the API or socket |
| Message fails to decrypt | Shown as "Unable to decrypt this message", other messages still show |
| Invalid input | Ack with `INVALID_INPUT`, message marked failed with retry |
| Message over 2,000 characters | Rejected in the client with an inline message. The draft is kept and nothing is sent |
| Join fails (`ROOM_NOT_FOUND`, `SERVER_ERROR` or no ack in time) | "Room not found" or "Could not join the room. Reload the page to try again." |
| Database error | Ack with `SERVER_ERROR`, message marked failed with retry |
| Ack timeout | Message marked failed with retry (same `clientId`) |
| Packet over 32 KB | Socket.IO closes the connection. The client reconnects and the message fails after its ack timeout |
| Connection drop | Status shows reconnecting, send disabled, rejoin and backfill on reconnect |
| Server restart | Same as connection drop. Data is safe in Postgres |
| Free-tier spin-down | Render shows a loading page for about a minute. Documented in the README |

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
- **Presence after a network loss:** a closed tab or a clean disconnect leaves the list at once. A user who loses the network without a clean close (Wi-Fi drops, laptop sleeps) stays in the list until the Socket.IO ping timeout. The server uses the defaults, a ping every 25 seconds and 20 seconds to answer, so that is between about 20 and 45 seconds. In testing it was 30 and 43 seconds. If that browser reconnects on a new connection first, for example after switching networks, the same person shows twice until the old connection times out. Shorter ping settings would shorten this, at the cost of more traffic and more false disconnects on slow mobile networks.
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
| Storage | Postgres on Neon | SQLite, in-memory | Render free tier has no persistent disk. |
| Routing | Manual, two routes | React Router | No dependency for two screens. |
| Client state | `useReducer` | Redux, Zustand | One screen with local state. |

## 11. Future improvements

- **More instances:** add the Socket.IO Redis adapter and sticky sessions.
- **Abuse:** rate limits per socket and per IP, and limits on room creation.
- **Long rooms:** "load older messages" with `before` pagination.
- **Room settings:** expiry with a cleanup job (also limits exposure of a leaked link), participant limit, and a creator token to manage them.
- **Room password:** derive the key from a password (PBKDF2) instead of putting it in the link, so a leaked link alone is not enough.
- **Stronger encryption model:** key rotation, encrypted display names, and AES-GCM additional data that binds each ciphertext to its room and `clientId`.
- **AES-GCM additional data so a name ciphertext cannot be used as a message:** today the name and the messages use the same key and format, so someone with the room ID could post the stored name ciphertext as a message, and it would decrypt.
- **Identity:** accounts, then moderation (remove a person, rotate the link).
- **Typing indicators:** from Socket.IO room membership, sent like presence.
- **Cold starts:** a paid instance removes the spin-down delay.

## 12. Visual design

### Purpose
Go from "Create a room" to chatting with a friend in less than 30 seconds. The one memorable element is the share moment: the link is shown with the key part highlighted, because the key in the link is what makes Speakeasy private.

### Colour tokens
Light and dark mode follow the system setting.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F3F5F3` | `#121815` | Page |
| `surface` | `#FFFFFF` | `#1B231F` | Header, composer bar, other people's messages |
| `divider` | `#E1E7E3` | `#2B3530` | Lines between header, messages and composer |
| `text` | `#17201B` | `#E6EDE8` | Main text |
| `muted` | `#5C6660` | `#9AA59F` | Names, times, help text, placeholders |
| `field-border` | `#73897D` | `#5F7468` | Edge of input fields (3:1 or more) |
| `accent` | `#1F5C45` | `#1E5A43` | Main buttons, your messages |
| `on-accent` | `#FFFFFF` | `#E9F2EC` | Text and icons on accent |
| `focus` | `#1F5C45` | `#7CC9A1` | Focus rings, links |
| `danger` | `#B42318` | `#F28B82` | Failed messages, errors |

All text pairs meet WCAG AA (4.5:1). Field edges and focus rings meet 3:1.

### Type
- Instrument Sans for all text, self-hosted (no request to a font service, because the app is about privacy).
- Monospace only for the room link in the share panel, because the key is a token that users must see exactly.
- Hierarchy from size and weight. Sentence case. No all-caps labels.

### Layout
- Home: one narrow, left-aligned column. App name, one line about what it does, an optional room name field, and "Create a room".
- Room: header (room name, connection status, copy link), message list, composer bar fixed at the bottom.
- Share panel at the top of the message list while the room has no messages.
- Your messages on the right in `accent`. Other people's messages on the left in `surface`. The name shows only on the first message in a group from the same person.

### Components
- Message field: pill shape, `field-border`, 2px `focus` ring when focused.
- Send button: round, `accent`, send icon, `aria-label="Send"`.
- One state screen component (title, explanation, optional action) for: incomplete link, room not found, page not found, cannot encrypt, could not load (with Retry).
- Connection status: small dot with text. Colour is never the only signal.

### Message states
- Sending: lower opacity and "Sending...".
- Failed: `danger` text with the reason. Retry for network and server errors. No Retry for `INVALID_INPUT`.
- Wrong key: if the history has messages and none decrypt, a warning banner and sending is disabled.

### Motion
One moment only: a short slide-in for new messages. None when the user prefers reduced motion.

### Accessibility and mobile
- Visible focus rings on all controls. Labels use `htmlFor`.
- Message list has `role="log"`, so screen readers announce new messages.
- Layout uses `100dvh` and safe-area insets, so the composer stays above the mobile keyboard.