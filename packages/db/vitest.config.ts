import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests share one real Postgres DB; some (e.g. deposit.test.ts) exercise
    // the amount-reservation partial unique index directly. Serialize files
    // so no two files' writes to the same tables can race.
    fileParallelism: false,
  },
});
