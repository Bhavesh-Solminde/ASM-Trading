import { describe, expect, it } from "vitest";
import type { PaymentRow } from "@asm/client-core";
import { detailModel } from "./detail-model";

const id = "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11";
const base: PaymentRow = {
  key: `d:${id}`, id, kind: "deposit", createdAt: "2026-10-21T05:00:00.000Z", updatedAt: "2026-10-21T05:01:00.000Z", status: "COMPLETED",
  methodLabel: "UPI", amountMinor: 200_000, currency: "INR", destination: null, expiresAt: null, holdUntil: null, cancelableUntil: null,
};
const now = Date.parse("2026-10-21T06:00:00.000Z");
const held: PaymentRow = { ...base, key: `w:${id}`, kind: "withdrawal", status: "HELD", updatedAt: null, destination: "me@okbank", holdUntil: "2026-10-22T06:00:00.000Z", cancelableUntil: "2026-10-22T18:00:00.000Z" };

describe("detailModel", () => {
  it("gives a credited deposit a reference, a confirmed time and a signed up figure", () => {
    const m = detailModel(base, now);
    expect(m.reference).toBe(`DP-${id.slice(0, 8).toUpperCase()}`);
    expect(m.confirmedAtMs).toBe(Date.parse(base.updatedAt!));
    expect(m.sign).toBe("+");
    expect(m.tone).toBe("up");
    expect(m.canCancel).toBe(false);
    expect(m.holdUntilMs).toBeNull();
  });
  it("has no confirmed time for a deposit that is not credited", () => {
    expect(detailModel({ ...base, status: "AWAITING_PAYMENT" }, now).confirmedAtMs).toBeNull();
    expect(detailModel({ ...base, status: "REJECTED" }, now).confirmedAtMs).toBeNull();
    expect(detailModel({ ...base, updatedAt: null }, now).confirmedAtMs).toBeNull();
  });
  it("mutes the figure of money that never moved", () => {
    const m = detailModel({ ...base, status: "EXPIRED" }, now);
    expect(m.sign).toBe("");
    expect(m.tone).toBe("ink3");
  });
  it("offers Cancel on a held withdrawal only inside its window, and shows when the hold lifts", () => {
    const m = detailModel(held, now);
    expect(m.canCancel).toBe(true);
    expect(m.holdUntilMs).toBe(Date.parse(held.holdUntil!));
    expect(m.sign).toBe("−");
    expect(m.reference.startsWith("WD-")).toBe(true);
    expect(detailModel(held, Date.parse(held.cancelableUntil!) + 1).canCancel).toBe(false);
    expect(detailModel({ ...held, cancelableUntil: null }, now).canCancel).toBe(false);
  });
  it("hides the hold time once it has passed, and for anything but a held withdrawal", () => {
    expect(detailModel(held, Date.parse(held.holdUntil!) + 1).holdUntilMs).toBeNull();
    expect(detailModel({ ...held, status: "APPROVED" }, now).holdUntilMs).toBeNull();
    expect(detailModel({ ...held, status: "APPROVED" }, now).canCancel).toBe(false);
  });
  it("never offers Cancel on a deposit", () => {
    expect(detailModel({ ...base, status: "HELD", cancelableUntil: "2030-01-01T00:00:00.000Z" }, now).canCancel).toBe(false);
  });
});
