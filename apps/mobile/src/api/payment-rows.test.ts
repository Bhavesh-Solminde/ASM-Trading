import { describe, expect, it } from "vitest";
import { paymentRows } from "./payment-rows";

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
