import { describe, expect, it } from "vitest";
import { ticketKey } from "./ws-ticket";

describe("ticketKey", () => {
  it("derives the Redis key from the sha256 of the ticket", () => {
    // The same literal is pinned in apps/web/src/lib/ws-ticket.test.ts.
    // If either side changes its derivation, both tests must change together.
    expect(ticketKey("fixture-ticket")).toBe(
      "ws:ticket:26152d453a0f9a9c4528463c1ce383dea7b43fbfac71b6f5446228ac05e52d38",
    );
  });
});
