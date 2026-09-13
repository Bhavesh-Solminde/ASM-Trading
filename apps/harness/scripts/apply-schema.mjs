/* eslint-disable no-undef -- Node.js script executed directly with `node`; process/console are ambient Node globals, not undeclared. */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "lib", "schema.sql"), "utf8");

const sql = postgres(url, { ssl: "require" });
await sql.unsafe(schema);
console.log("schema applied");
await sql.end();
