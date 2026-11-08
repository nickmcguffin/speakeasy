CREATE TABLE IF NOT EXISTS rooms (
  id          uuid PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- CREATE TABLE IF NOT EXISTS does not add columns to an existing table, so later columns
-- are added here. The optional room name is encrypted in the browser like a message.
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
