import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { buildLogger, logger, newCorrelationId } from "./index.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)));
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("redacts password, token and cookie fields", () => {
    const { lines, stream } = capture();
    const log = buildLogger({ level: "info", destination: stream });
    log.info(
      { password: "hunter2", token: "abc", cookie: "sid=1", email: "a@b.com" },
      "test",
    );
    const line = lines[0]!;
    expect(line.password).toBe("[REDACTED]");
    expect(line.token).toBe("[REDACTED]");
    expect(line.cookie).toBe("[REDACTED]");
    expect(line.email).toBe("a@b.com");
  });

  it("redacts nested request headers", () => {
    const { lines, stream } = capture();
    const log = buildLogger({ level: "info", destination: stream });
    log.info({ req: { headers: { authorization: "Bearer x" } } }, "test");
    expect((lines[0]!.req as any).headers.authorization).toBe("[REDACTED]");
  });

  it("emits evt and lvl on every line", () => {
    const { lines, stream } = capture();
    const log = buildLogger({ level: "info", destination: stream });
    log.warn({ evt: "engine.feed_gap", asset: "AUDNZD_OTC" }, "gap");
    expect(lines[0]!.evt).toBe("engine.feed_gap");
    expect(lines[0]!.lvl).toBe("warn");
  });

  it("generates 6-character hex correlation ids", () => {
    const id = newCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{6}$/);
    expect(newCorrelationId()).not.toBe(id);
  });
});

// `logger` is a lazy `get`-only Proxy over the real pino instance (see
// index.ts for why). This guards against a regression where the Proxy had
// no `set` trap: writing `logger.level = "debug"` (a documented pino idiom)
// would silently land on the empty proxy target instead of the real
// instance, and subsequent reads via the `get` trap would keep returning
// the real instance's unchanged value — a silent no-op with no error.
describe("logger (singleton proxy)", () => {
  const managedKeys = ["DATABASE_URL", "REDIS_URL", "SESSION_SECRET", "LOG_LEVEL"] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of managedKeys) {
      originalEnv[key] = process.env[key];
    }
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5433/db";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.LOG_LEVEL = "info";
  });

  afterEach(() => {
    for (const key of managedKeys) {
      const original = originalEnv[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  it("writing logger.level round-trips through the real underlying instance", () => {
    expect(logger.level).toBe("info");
    logger.level = "debug";
    expect(logger.level).toBe("debug");
  });
});
