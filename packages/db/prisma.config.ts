import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "prisma/config";

const rootEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.env",
);
loadEnv({ path: rootEnvPath });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need DDL privileges (CREATE, etc.) that the restricted
    // runtime role (asm_app, see sql/restrict-role.sql) deliberately lacks.
    // Prefer the owner-scoped DATABASE_MIGRATE_URL for the CLI; fall back to
    // DATABASE_URL so this still works in environments that haven't set the
    // migrate URL (e.g. a single-role local setup).
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_MIGRATE_URL"] ?? process.env["DATABASE_URL"],
  },
});
