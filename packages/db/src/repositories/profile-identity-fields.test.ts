import { describe, expect, it } from "vitest";
import { KYC_IDENTITY_FIELDS } from "@asm/contracts";
import { IDENTITY_FIELDS } from "./profile";

// The mobile KYC flow decides "details complete" from the contracts list; the server decides "ready to submit"
// from IDENTITY_FIELDS. If they differ, the app would show a card as done that the server then rejects (or the
// reverse), so the two lists must be identical, in the same order.
describe("KYC identity fields", () => {
  it("are the same in @asm/contracts (what the app checks) and in the profile repository (what submit requires)", () => {
    expect([...KYC_IDENTITY_FIELDS]).toEqual([...IDENTITY_FIELDS]);
  });
});
