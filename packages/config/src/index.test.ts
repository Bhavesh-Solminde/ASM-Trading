import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, parseConfig } from "./index";

const valid = {
  DATABASE_URL: "postgresql://u:p@localhost:5433/db",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  BANK_FEED: "simulated",
  NODE_ENV: "development",
  LOG_LEVEL: "info",
};

describe("parseConfig", () => {
  it("parses a valid environment", () => {
    const c = parseConfig(valid);
    expect(c.databaseUrl).toBe(valid.DATABASE_URL);
    expect(c.bankFeed).toBe("simulated");
  });

  it("rejects a session secret under 32 characters", () => {
    expect(() => parseConfig({ ...valid, SESSION_SECRET: "tooshort" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("rejects an unknown bank feed", () => {
    expect(() => parseConfig({ ...valid, BANK_FEED: "sms-live" })).toThrow();
  });

  it("defaults bank feed to simulated when absent", () => {
    const { BANK_FEED: _omit, ...rest } = valid;
    expect(parseConfig(rest).bankFeed).toBe("simulated");
  });
});

// These tests exercise the exported `config` object itself (not `parseConfig`),
// which lazily parses `process.env` on first field access and caches the
// result. Scope the env vars it needs to just this describe block so the
// `parseConfig`-based tests above (which never touch `process.env`) are
// unaffected, and so we don't leak ambient state to other test files.
//
// This guards against a regression where `config` was a `Proxy` over an
// empty target: its `getOwnPropertyDescriptor` trap reported descriptors
// from the real config while the target stayed `{}`, which is an invalid
// Proxy invariant — `Object.keys`, spread, and `JSON.stringify` threw a
// TypeError, and `console.log` silently printed `{}` because `util.inspect`
// reads the proxy's raw target directly, bypassing traps.
describe("config", () => {
  const managedKeys = [
    "DATABASE_URL",
    "REDIS_URL",
    "SESSION_SECRET",
    "BANK_FEED",
    "LOG_LEVEL",
    "DATABASE_MIGRATE_URL",
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of managedKeys) {
      originalEnv[key] = process.env[key];
    }
    process.env.DATABASE_URL = valid.DATABASE_URL;
    process.env.REDIS_URL = valid.REDIS_URL;
    process.env.SESSION_SECRET = valid.SESSION_SECRET;
    // Leave BANK_FEED/LOG_LEVEL unset so the schema's defaults kick in
    // deterministically, matching the expectations below.
    delete process.env.BANK_FEED;
    delete process.env.LOG_LEVEL;
    delete process.env.DATABASE_MIGRATE_URL;
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

  it("Object.keys(config) does not throw and includes the expected fields", () => {
    let keys: string[] = [];
    expect(() => {
      keys = Object.keys(config);
    }).not.toThrow();
    expect(keys.sort()).toEqual(
      ["databaseUrl", "redisUrl", "sessionSecret", "bankFeed", "nodeEnv", "logLevel"].sort(),
    );
  });

  it("JSON.stringify(config) produces the expected shape", () => {
    let serialized = "";
    expect(() => {
      serialized = JSON.stringify(config);
    }).not.toThrow();
    expect(JSON.parse(serialized)).toEqual({
      databaseUrl: valid.DATABASE_URL,
      redisUrl: valid.REDIS_URL,
      sessionSecret: valid.SESSION_SECRET,
      bankFeed: "simulated",
      nodeEnv: config.nodeEnv,
      logLevel: "info",
    });
  });

  it("spreading config does not throw and copies every field", () => {
    let spread: Record<string, unknown> = {};
    expect(() => {
      spread = { ...config };
    }).not.toThrow();
    expect(spread).toEqual({
      databaseUrl: valid.DATABASE_URL,
      redisUrl: valid.REDIS_URL,
      sessionSecret: valid.SESSION_SECRET,
      bankFeed: "simulated",
      nodeEnv: config.nodeEnv,
      logLevel: "info",
    });
  });

  it("for...in enumerates every field without throwing", () => {
    const seen: string[] = [];
    expect(() => {
      for (const key in config) {
        seen.push(key);
      }
    }).not.toThrow();
    expect(seen.sort()).toEqual(
      ["databaseUrl", "redisUrl", "sessionSecret", "bankFeed", "nodeEnv", "logLevel"].sort(),
    );
  });

  it("console.log(config) prints real values, not an empty object", () => {
    // console.log formats objects via node:util's inspect under the hood, so
    // this exercises the same code path without depending on how console.log
    // happens to route its output.
    const printed = inspect(config);
    expect(printed).toContain(valid.DATABASE_URL);
    expect(printed.replace(/\s/g, "")).not.toBe("{}");
  });

  it("assigning to a config field throws instead of silently no-op'ing", () => {
    expect(() => {
      (config as { databaseUrl: string }).databaseUrl = "mutated";
    }).toThrow();
  });
});
