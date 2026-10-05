import { defineConfig } from "vitest/config";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// processor.test.ts writes to the real DB, like packages/db's own tests.
loadDotenv({ path: resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
  },
});
