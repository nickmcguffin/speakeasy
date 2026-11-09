import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    serverUrl: string | null; // null when TEST_DATABASE_URL is not set
  }
}

async function findFreePort() {
  const probe = createServer().listen(0);
  await once(probe, "listening");
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === "string") {
    throw new Error("Could not find a free port");
  }
  return address.port;
}

async function waitForHealth(url: string, server: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`The server exited with code ${server.exitCode} before it was ready`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The server did not answer /api/health within 30 seconds");
}

// Starts the real server once for all integration tests, on a random port, with the test
// database. DATABASE_URL from the environment is never used.
export default async function startServer(project: TestProject) {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    console.warn("TEST_DATABASE_URL is not set, so the integration tests are skipped.");
    project.provide("serverUrl", null);
    return;
  }

  const port = await findFreePort();
  const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const url = `http://localhost:${port}`;
  try {
    await waitForHealth(url, server);
  } catch (error) {
    server.kill();
    throw error;
  }
  project.provide("serverUrl", url);

  return async () => {
    server.kill();
    if (server.exitCode === null) {
      await once(server, "exit");
    }
  };
}
