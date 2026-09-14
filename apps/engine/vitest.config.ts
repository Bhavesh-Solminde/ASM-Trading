import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // registry.test.ts and server.test.ts share one real Postgres test DB.
    fileParallelism: false,
  },
});
