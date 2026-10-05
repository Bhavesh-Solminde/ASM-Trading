import { afterEach, describe, expect, it, vi } from "vitest";
import { TatumError, resetTatumPacing, tatumRequest } from "./http";

afterEach(() => {
  vi.unstubAllEnvs();
  resetTatumPacing();
});

function sequence(...responses: Array<{ status: number; body?: unknown }>) {
  const calls: number[] = [];
  const impl = (async () => {
    calls.push(Date.now());
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("tatumRequest", () => {
  it("retries a 429 (rate limited) and returns the eventual success", async () => {
    const f = sequence({ status: 429, body: { message: "limit" } }, { status: 200, body: { ok: 1 } });
    expect(await tatumRequest(f.impl, "k", "https://api.tatum.io/x")).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(2);
  });

  it("paces requests to TATUM_MAX_RPS", async () => {
    vi.stubEnv("TATUM_MAX_RPS", "10");
    resetTatumPacing();
    const f = sequence({ status: 200, body: {} });
    await Promise.all([1, 2, 3, 4].map(() => tatumRequest(f.impl, "k", "https://api.tatum.io/x")));
    expect(f.calls[3]! - f.calls[0]!).toBeGreaterThanOrEqual(290); // 3 gaps of 100ms
  });

  it("carries Tatum's errorCode on failures and never the API key", async () => {
    const f = sequence({ status: 403, body: { errorCode: "tron.tx.not.found", message: "nope" } });
    const err = await tatumRequest(f.impl, "secret-key", "https://api.tatum.io/v3/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TatumError);
    expect((err as TatumError).code).toBe("tron.tx.not.found");
    expect((err as TatumError).status).toBe(403);
    expect(String((err as Error).message)).not.toContain("secret-key");
  });
});
