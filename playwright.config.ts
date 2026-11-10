import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const databaseUrl = process.env.TEST_DATABASE_URL;

// Runs the built app (npm run build first) with the test database. Without TEST_DATABASE_URL
// no server starts and every test is skipped.
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  // In CI also an HTML report in playwright-report/, which the workflow uploads when a step fails.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // A failed test keeps its trace and a screenshot in test-results/.
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: databaseUrl
    ? {
        command: "node dist/server/index.js",
        url: `http://localhost:${port}/api/health`,
        env: { DATABASE_URL: databaseUrl, PORT: String(port) },
        stdout: "ignore",
      }
    : undefined,
});
