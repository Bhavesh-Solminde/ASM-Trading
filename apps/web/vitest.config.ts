import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path mapping. Next.js
    // resolves this at build/dev time, but vitest doesn't read tsconfig
    // paths on its own — needed as soon as any test transitively imports a
    // module (like a route handler) that uses the "@/" alias.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests share one real Postgres DB; some (e.g. deposit-matcher.test.ts)
    // briefly drop/recreate a live unique index. Serialize files so that
    // window never overlaps another file's writes to the same tables.
    fileParallelism: false,
  },
});
