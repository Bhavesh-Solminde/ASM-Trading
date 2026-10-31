import { describe, expect, it } from "vitest";
import { findPaymentRow, paymentRows } from "./payment-rows";

const row = (key: string) => ({ key });
describe("paymentRows", () => {
  const data = { pages: [{ rows: [row("a"), row("b")] }, { rows: [row("c")] }], pageParams: [null, "x"] };
  it("flattens the infinite query's pages in order", () => {
    expect(paymentRows(data).map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
  it("caps at limit", () => {
    expect(paymentRows(data, 2).map((r) => r.key)).toEqual(["a", "b"]);
    expect(paymentRows(data, 99)).toHaveLength(3);
  });
  it("is empty before data arrives", () => {
    expect(paymentRows(undefined)).toEqual([]);
  });
});

describe("findPaymentRow", () => {
  const data = { pages: [{ rows: [{ key: "d:1" }, { key: "w:2" }] }, { rows: [{ key: "d:3" }] }] };
  it("finds a row on any loaded page", () => {
    expect(findPaymentRow(data, "d:3")).toEqual({ key: "d:3" });
    expect(findPaymentRow(data, "w:2")).toEqual({ key: "w:2" });
  });
  it("is undefined for an unloaded key or no data", () => {
    expect(findPaymentRow(data, "d:9")).toBeUndefined();
    expect(findPaymentRow(undefined, "d:1")).toBeUndefined();
  });
});
