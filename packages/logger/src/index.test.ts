import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { buildLogger, newCorrelationId } from "./index.js";

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
