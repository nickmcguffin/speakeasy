import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set. Add it to .env for npm run dev, or set it in the environment for npm start.",
  );
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  // Fail a request after 10 seconds instead of waiting forever. A Neon wake-up takes a few seconds.
  connectionTimeoutMillis: 10_000,
});

// Neon can close idle connections, for example when its compute scales to zero.
// Without this listener, that error on an idle client crashes the process.
pool.on("error", (error) => {
  console.error(`Postgres idle client error: ${error.message}`);
});

export async function createSchema() {
  // From cwd, like client/dist, because tsc does not copy .sql files into dist/.
  const schemaPath = path.join(process.cwd(), "server/schema.sql");
  await pool.query(await readFile(schemaPath, "utf8"));
}
