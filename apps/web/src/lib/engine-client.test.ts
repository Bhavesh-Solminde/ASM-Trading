import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineRejected, EngineUnavailable, engineOpenTrade } from "./engine-client";

const input = {
  symbol: "AUDNZD_OTC",
  direction: "UP" as const,
  stake: 1_000,
  durationSec: 60,
  accountId: "3f2a9c1e-0000-4000-8000-000000000000",
  actorId: "3f2a9c1e-0000-4000-8000-000000000001",
};

function engineReplies(status: number, body: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
}

beforeEach(() => {
  vi.stubEnv("ENGINE_INTERNAL_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("engineOpenTrade", () => {
  it("surfaces a refusal the trader can act on with its status and reason", async () => {
    engineReplies(409, { error: "insufficient_funds" });
    const err = await engineOpenTrade(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineRejected);
    expect(err).toMatchObject({ status: 409, reason: "insufficient_funds" });
  });

  it("treats a rejected secret as an outage, never as the trader being signed out", async () => {
    engineReplies(401, { error: "unauthorised" });
    await expect(engineOpenTrade(input)).rejects.toBeInstanceOf(EngineUnavailable);
  });

  it("treats a payload the engine refuses to parse as an outage, not the trader's mistake", async () => {
    engineReplies(400, { error: "invalid" });
    await expect(engineOpenTrade(input)).rejects.toBeInstanceOf(EngineUnavailable);
  });
});
