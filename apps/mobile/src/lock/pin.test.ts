import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPin, isValidPin } from "./pin";

const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");

describe("pin", () => {
  it("accepts exactly four digits", () => {
    expect(isValidPin("0420")).toBe(true);
    expect(isValidPin("042")).toBe(false);
    expect(isValidPin("04a0")).toBe(false);
  });
  it("hashes with the install salt so equal PINs on two phones differ", async () => {
    const a = await hashPin("1234", "salt-a", sha256);
    const b = await hashPin("1234", "salt-b", sha256);
    expect(a).not.toBe(b);
    expect(a).toBe(await hashPin("1234", "salt-a", sha256));
  });
});
