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

-- Join and leave events share the messages table, and every row records its author's
-- presenceKey (author_key). Rows from before this change are messages with no author_key.
-- Every statement is idempotent and works on a table that already has rows.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author_key text;
ALTER TABLE messages ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN ciphertext DROP NOT NULL;
ALTER TABLE messages ALTER COLUMN iv DROP NOT NULL;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the block checks pg_constraint first.
-- A message has its encrypted fields. An event has an author_key and no encrypted fields.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_kind_fields' AND conrelid = 'messages'::regclass
  ) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_kind_fields CHECK (
      (kind = 'message' AND client_id IS NOT NULL AND ciphertext IS NOT NULL AND iv IS NOT NULL)
      OR (kind IN ('join', 'leave') AND author_key IS NOT NULL
          AND client_id IS NULL AND ciphertext IS NULL AND iv IS NULL)
    );
  END IF;
END $$;

-- The last join or leave event of one browser in one room.
CREATE INDEX IF NOT EXISTS messages_room_author_events
  ON messages (room_id, author_key, id) WHERE kind IN ('join', 'leave');
