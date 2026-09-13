import { describe, expect, it } from "vitest";
import { parseConfig } from "./index.js";

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
