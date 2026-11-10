import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is client/.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: "tests/integration/startServer.ts",
          // The leave event test waits for the server's 5-second timer.
          testTimeout: 15_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
