# Speakeasy

## What it is
An MVP for a very simple private chat application. A user creates a room, shares the link, and other people use the link to join and chat in real time. Messages are end-to-end encrypted.

## Live demo and repo
TODO

## Assumptions
- "Private" means that rooms are not listed anywhere, and each room link contains a long random ID that nobody can guess. Users can only join if they have access to a link.
- "Private" also means that the server cannot read the messages. Only people with the full link can.
- There are no user accounts. A user types a display name to join, and the browser remembers it for the next visit.
- The app is a demo for a small number of users, so one server instance is sufficient.

## Time box
Due to my current role and having to cover someone on leave for the next week, I am timeboxing this task to 20 hours.

## Definition of done
- A user can create a room with one click and copy the link.
- A user can open the link, enter a display name and join.
- Users send and receive messages in real time.
- A user sees recent messages when they join.
- Rooms and messages stay after a server restart.
- An unknown room ID shows a clear error page.
- Messages are encrypted in the browser. The server stores and relays only ciphertext and never receives the key.
- A link without the key shows a clear "incomplete link" message.
- A message that fails to decrypt shows a clear placeholder, and the other messages still show.
- The app shows the connection state (connecting, connected, reconnecting, disconnected).
- Each message shows its state (sending, sent, failed) and a failed message can be retried.
- The layout works on mobile and desktop, with keyboard support and good contrast.
- Messages are limited in length and are rendered as plain text only.
- The app is deployed and this README explains the decisions.

## Stack and reasons
- **TypeScript** on the client and server, so one language and shared types for messages.
- **Node with Express** to serve the API and the built front end from one origin. One deploy and no CORS setup.
- **Socket.IO** for real-time messages. It has reconnection and acknowledgements built in, which drive the connection and message states in the UI.
- **React with Vite** for the front end.
- **Web Crypto API** (AES-GCM) for encryption in the browser. Built in, so no crypto library is needed.
- **Postgres on Neon** for rooms and messages.
- **Render** to host the Node server, because it runs a long-lived process that can hold WebSocket connections.

## Design decisions
- Clean, minimal and modern, dark theme first, with light mode from the system setting.
- One sans-serif font and one accent colour. Hierarchy comes from size and weight.
- Short, subtle motion, disabled when the user prefers reduced motion.
- Fast paths: one click to create a room, one field to join, Enter to send.
- Every main action can be completed in three clicks or fewer.
- Messages appear immediately with a "sending" state, so the app feels fast.

## Key decisions and tradeoffs
- **Secret links instead of accounts.** Much less to build and a faster join. The tradeoff: anyone with the full link can join and read, and there is no way to remove a person.
- **End-to-end encryption instead of server-side encryption.** More work in the client, but the server never holds a key that can read messages (see "Encryption").
- **Own WebSocket server instead of a managed real-time service.** Slightly more work, but it shows how the real-time part works and keeps everything in one codebase.
- **Database instead of in-memory storage.** If rooms were only in memory, a restart would delete every room and break every shared link.
- **Free hosting tier.** No cost, but the server sleeps when nobody uses it.

## Encryption
Messages are end-to-end encrypted, because "private" should mean that the server cannot read them either.

- **Key in the link.** When a user creates a room, the browser generates a random AES-GCM key with the Web Crypto API. The key goes in the URL fragment: `/r/<roomId>#<key>`. Browsers never send the fragment to the server.
- **Encrypt in the browser.** Each client encrypts messages before it sends them and decrypts them when they arrive. The server stores and relays only ciphertext and a per-message IV.
- **Result.** The server, the database and the host cannot read messages. Only people with the full link can.

I chose this over server-side encryption at rest, because a key stored next to the database protects against a database leak but not against the server itself.

## Known limits
- On the free tier, the first load after a quiet period can take about a minute while the server wakes up.
- One server instance only. More instances would need a shared pub/sub layer.
- A leaked link gives access to the room and its full history. Links and keys cannot be changed.
- Display names and timestamps are not encrypted, so the server knows who spoke and when.
- The server can only limit the size of the encrypted data, not check the message text.
- No moderation, editing or deleting of messages.

## How I used AI tools
- TODO

## Later-list
- Room settings set by the creator: expiry time, password, maximum participants.
- A creator token so the creator can manage the room without an account.
- Room password that derives the key (PBKDF2), so a leaked link alone is not enough.
- Key rotation and encrypted display names.
- User accounts.
- Online presence and typing indicators.
- Read receipts.
- Edit and delete messages.
- File and image uploads.
- Rate limits.
- Multiple server instances (for example, the Socket.IO Redis adapter).
- Wider test coverage.

## Run locally
Requires Node 26 (see `.node-version`).

```sh
npm install
```

**Database**
```sh
cp .env.example .env
```
Set `DATABASE_URL` in `.env` to a Postgres connection string (for example, from Neon). Use `sslmode=verify-full`, because `pg` prints a security warning for `sslmode=require`. The server exits at startup without `DATABASE_URL`.

`npm run dev` loads `.env`. `npm start` does not, because on Render the host sets `DATABASE_URL`. For a local production run, export it in your shell first.

**Development**
```sh
npm run dev
```
Open http://localhost:5173. Vite serves the client and proxies `/api` and `/socket.io` to the server on port 3000. The server reloads when its files change.

**Production build**
```sh
npm run build
npm start
```
Open http://localhost:3000. The server serves the built client and the WebSocket on one port.

Set `PORT` to run the server on a different port in either mode.