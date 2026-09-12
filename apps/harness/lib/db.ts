import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __harnessSql: ReturnType<typeof postgres> | undefined;
}

/**
 * Lazy on purpose: constructing this eagerly at module load time would run
 * during `next build`'s route-collection step, failing the build itself if
 * DATABASE_URL isn't set yet (e.g. before the first Vercel env var is added).
 */
export function getSql() {
  if (globalThis.__harnessSql) return globalThis.__harnessSql;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const client = postgres(url, { ssl: "require" });
  globalThis.__harnessSql = client;
  return client;
}
