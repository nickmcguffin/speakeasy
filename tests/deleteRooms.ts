import pg from "pg";

// Deletes the listed test rooms from the test database, and with them their messages and events
// (ON DELETE CASCADE). Only these IDs, never every row.
export async function deleteRooms(roomIds: string[]) {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl || roomIds.length === 0) {
    return;
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("DELETE FROM rooms WHERE id = ANY($1::uuid[])", [roomIds]);
  } finally {
    await client.end();
  }
}
