import { describe, expect, it } from "vitest";
import { wsTicketKey } from "./ws-ticket";

describe("wsTicketKey", () => {
  it("matches the engine's derivation exactly", () => {
    // Same literal as apps/engine/src/auth/ws-ticket.test.ts.
    expect(wsTicketKey("fixture-ticket")).toBe(
      "ws:ticket:26152d453a0f9a9c4528463c1ce383dea7b43fbfac71b6f5446228ac05e52d38",
    );
  });
});
