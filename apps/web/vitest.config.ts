import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const envPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env");
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq);
    let val = t.slice(eq + 1);
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {}

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
