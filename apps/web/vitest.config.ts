import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests share one real Postgres DB; some (e.g. deposit-matcher.test.ts)
    // briefly drop/recreate a live unique index. Serialize files so that
    // window never overlaps another file's writes to the same tables.
    fileParallelism: false,
  },
});
