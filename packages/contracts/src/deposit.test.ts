import { describe, expect, it } from "vitest";
import { ClaimUtrSchema, CreateDepositSchema } from "./deposit";

describe("CreateDepositSchema", () => {
  const valid = { method: "PhonePe", amountInr: 100_000 };

  it("accepts a valid request", () => {
    expect(CreateDepositSchema.parse(valid).amountInr).toBe(100_000);
  });

  it("rejects a client-supplied USD amount", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, amountUsd: 1 }).success).toBe(false);
  });

  it("rejects a client-supplied VPA", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, vpa: "me@bank" }).success).toBe(false);
  });

  it("rejects a client-supplied status", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, status: "COMPLETED" }).success).toBe(false);
  });

  it("rejects an unknown method", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, method: "Cash" }).success).toBe(false);
  });

  it("rejects a fractional amount", () => {
    expect(CreateDepositSchema.safeParse({ ...valid, amountInr: 10.5 }).success).toBe(false);
  });
});

describe("ClaimUtrSchema", () => {
  it("accepts a 12-digit reference", () => {
    expect(ClaimUtrSchema.parse({ utr: "528312345678" }).utr).toBe("528312345678");
  });

  it("trims surrounding whitespace", () => {
    expect(ClaimUtrSchema.parse({ utr: "  528312345678  " }).utr).toBe("528312345678");
  });

  it("rejects a reference that is too short", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "123" }).success).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "5283abc45678" }).success).toBe(false);
  });

  it("rejects an injected depositId", () => {
    expect(ClaimUtrSchema.safeParse({ utr: "528312345678", depositId: "other" }).success).toBe(false);
  });
});
