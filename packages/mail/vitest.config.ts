import { defineConfig } from "vitest/config";

// Pure unit tests: fetch is faked and the logger is mocked, so no .env is read.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
