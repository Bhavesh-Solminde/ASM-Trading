import { describe, expect, it } from "vitest";
import { withdrawalLimitsMinor as serverLimits } from "@asm/db";
import { withdrawalLimitsMinor as formLimits } from "@asm/contracts";

describe("withdrawal limits mirror", () => {
  it("matches what the server enforces, for every currency", () => {
    for (const currency of ["INR", "USD"]) {
      expect(formLimits(currency)).toEqual(serverLimits(currency));
    }
  });
});
