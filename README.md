# Speakeasy

[![CI](https://github.com/nickmcguffin/speakeasy/actions/workflows/ci.yml/badge.svg)](https://github.com/nickmcguffin/speakeasy/actions/workflows/ci.yml)

## What it is
An MVP for a very simple private chat application. A user creates a room, shares the link, and other people use the link to join and chat in real time. Messages are end-to-end encrypted with one shared key per room (see "Encryption" for what this does and does not protect).

## Live demo
View the live demo [here](https://speakeasy-4u7o.onrender.com/).


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
- A user can give a room an optional name, which is encrypted like the messages.
- The room shows who is currently connected.

## Stack and reasons
- **TypeScript** on the client and server, so one language and shared types for messages.
- **Node with Express** to serve the API and the built front end from one origin. One deploy and no CORS setup.
- **Socket.IO** for real-time messages. It has reconnection and acknowledgements built in, which drive the connection and message states in the UI.
- **React with Vite** for the front end.
- **Web Crypto API** (AES-GCM) for encryption in the browser. Built in, so no crypto library is needed.
- **Postgres on Neon** for rooms and messages.
- **Render** to host the Node server, because it runs a long-lived process that can hold WebSocket connections.

## Design decisions
- Clean, minimal and modern. Light and dark themes follow the system setting, and a toggle in the header switches between them.
- One sans-serif font and one accent colour. Hierarchy comes from size and weight.
- Short, subtle motion, disabled when the user prefers reduced motion.
- Fast paths: one click to create a room, one field to join, Enter to send.
- Every main action can be completed in three clicks or fewer.
- Messages appear immediately with a "sending" state, so the app feels fast.
- The leave dialog shows only when leaving is hard to reverse: in the tab that created the room, before its link was copied or shared. Everyone else leaves with one click.

## Key decisions and tradeoffs
- **Secret links instead of accounts.** Much less to build and a faster join. The tradeoff: anyone with the full link can join and read, and there is no way to remove a person.
- **End-to-end encryption instead of server-side encryption.** More work in the client, but the server never holds a key that can read messages (see "Encryption").
- **Own WebSocket server instead of a managed real-time service.** Slightly more work, but it shows how the real-time part works and keeps everything in one codebase.
- **Database instead of in-memory storage.** If rooms were only in memory, a restart would delete every room and break every shared link.
- **Free hosting tier.** No cost, but the server sleeps when nobody uses it.
- **Render deploys with minimal downtime.** Open pages reconnect automatically when the new version goes live.

## Encryption
Messages are end-to-end encrypted, because "private" should mean that the server cannot read them either.

- **Key in the link.** When a user creates a room, the browser generates a random 256-bit AES-GCM key with the Web Crypto API, before it asks the server for a room. The key goes in the URL fragment: `/r/<roomId>#<key>`. Browsers never send the fragment to the server.
- **Key in memory only.** The key is never stored in local or session storage, logged, or sent in a request.
- **Encrypt in the browser.** Each client encrypts messages and the room name before it sends them and decrypts them when they arrive. Every message gets a new random 12-byte IV. The server stores and relays only ciphertext and the IV.
- **Missing or wrong key.** A link without a valid key shows "This link is incomplete" and does not join. A message that fails to decrypt (wrong key or changed data) shows "Unable to decrypt this message", and the other messages still show.
- **Secure context.** Web Crypto works only on HTTPS or `localhost`. Elsewhere the app shows "This browser cannot encrypt messages".
- **Result.** The server, the database and the host cannot read messages. Only people with the full link can.

I chose this over server-side encryption at rest, because a key stored next to the database protects against a database leak but not against the server itself. 

This is end-to-end encryption with one shared key per room, the same pattern as Excalidraw shared drawings or PrivateBin. It protects message text from the server and the database. It does not give forward secrecy, sender authentication or member removal, which production messaging apps get from protocols such as Signal or MLS. For a real product I would use an established protocol and audited library rather than extend this design.

## Known limits
- On the free tier, the first load after a quiet period can take about a minute while the server wakes up.
- One server instance only. More instances would need a shared pub/sub layer.
- A leaked link gives access to the room and its full history. Links and keys cannot be changed.
- The full link and the room name stay in the browser history of each device that opens the room.
- Display names and timestamps are not encrypted, so the server knows who spoke and when.
- Join and leave events are stored in plain text, with the display name and the time, so the server knows when each person came and went.
- A server restart while someone is in a room can lose their "left" event: the timer for it lives in memory.
- The server can only limit the size of the encrypted data, not check the message text.
- No moderation, editing or deleting of messages.
- After a very long disconnect, only the newest 200 missed messages load.
- The room ID alone gives partial access. The server, a database leak or a link without the fragment gives the room ID. With it, a person can join, see display names and message times, and send messages that nobody can decrypt. They cannot read the messages.
- You must trust the server code. This is a limit of all end-to-end encryption in web apps. The server sends the JavaScript, so a changed server could send code that reads the key. Desktop and mobile apps have the same problem in a smaller form.

## How I used AI tools
- TODO

## Later-list
- Room settings set by the creator: expiry time, password, maximum participants.
- A creator token so the creator can manage the room without an account.
- Room password that derives the key (PBKDF2), so a leaked link alone is not enough.
- Key rotation and encrypted display names.
- User accounts.
- Typing indicators.
- Read receipts.
- Edit and delete messages.
- File and image uploads.
- Rate limits.
- Multiple server instances (for example, the Socket.IO Redis adapter).
- Wider test coverage.
- Proof of key to join: the client derives a token from the key, and the server allows a join only with that token. This stops people who have only the room ID.
- Accounts and invite-only rooms: sign in with an email magic link, the creator invites people by email, and the server allows a join only for invited members. This means a leaked link alone is not enough, and the creator can remove a person. Full removal also needs key rotation, because a removed member still has the old key.

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
<b>Note:</b> On a fresh clone, the server prints "Client build not found ... Serving API only". This is expected in dev, because Vite serves the page on port 5173. Running `npm run build` will build the required `client/dist/` files.

Open http://localhost:5173. Vite serves the client and proxies `/api` and `/socket.io` to the server on port 3000. The server reloads when its files change.

**Production build**
```sh
npm run build
npm start
```
Open http://localhost:3000. The server serves the built client and the WebSocket on one port.

Set `PORT` to run the server on a different port in either mode.

**Checks**
```sh
npm run typecheck
npm test
```
These need no database. See "Testing" for the integration and end-to-end tests.

## Testing
[CI](.github/workflows/ci.yml) runs every level on each push and pull request, with a throwaway Postgres in a service container. The tests are in `tests/`.

| Level | Command | What it covers | Needs |
|---|---|---|---|
| Unit (Vitest) | `npm test` | Encryption (`client/crypto.ts`), every server validation rule at its limits, the room reducer, own messages, message groups and initials | Nothing |
| Integration (Vitest) | `npm run test:integration` | The real server on a random port: the REST routes and their errors, join and send errors, a repeated `clientId`, the `since` catch-up, presence, and join and leave events | `TEST_DATABASE_URL` |
| End to end (Playwright) | `npm run test:e2e` | The built app in Chromium: two people chat and see the history after a reload, a link without the key, the leave dialog, and an axe accessibility check of the home page and a room | `TEST_DATABASE_URL`, Playwright Chromium |

`npm run test:all` runs all three levels in that order. `npm run test:e2e` builds the app first.

**Test database.** The integration and end-to-end tests use `TEST_DATABASE_URL` and never `DATABASE_URL`. Without it they are skipped with a message. Use a database for testing, such as a Neon dev branch or a local Postgres, never production:
```sh
export TEST_DATABASE_URL="postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=verify-full"
npm run test:all
```
Each test creates its own rooms, and each test file deletes the rooms it created when it finishes (by their IDs, never all rows). A run that is stopped part way can leave some behind.

**Browser.** Install Playwright's Chromium once with `npx playwright install chromium` (add `--with-deps` on a Linux machine without its system libraries).

The integration tests take about 20 seconds, because two of them wait for the server's 5-second timer for "left" events.
