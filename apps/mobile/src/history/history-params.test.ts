import { describe, expect, it } from "vitest";
import { historyParams } from "./history-params";

const id = "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11";

describe("historyParams", () => {
  it("does nothing without params", () => {
    expect(historyParams({})).toEqual({ segment: null, filter: null, txKey: null });
  });
  it("filter=payments selects the Payments segment with every row", () => {
    expect(historyParams({ filter: "payments" })).toEqual({ segment: "payments", filter: "all", txKey: null });
  });
  it("filter=deposits / withdrawals select Payments and filter it", () => {
    expect(historyParams({ filter: "deposits" })).toEqual({ segment: "payments", filter: "deposits", txKey: null });
    expect(historyParams({ filter: "withdrawals" })).toEqual({ segment: "payments", filter: "withdrawals", txKey: null });
  });
  it("filter=trades selects the Trade segment", () => {
    expect(historyParams({ filter: "trades" })).toEqual({ segment: "trades", filter: null, txKey: null });
  });
  it("tx=d:<id> / w:<id> selects Payments and names the payment to open", () => {
    expect(historyParams({ tx: `d:${id}` })).toEqual({ segment: "payments", filter: null, txKey: `d:${id}` });
    expect(historyParams({ tx: `w:${id}`, filter: "withdrawals" })).toEqual({ segment: "payments", filter: "withdrawals", txKey: `w:${id}` });
  });
  it("tx wins over filter=trades", () => {
    expect(historyParams({ tx: `d:${id}`, filter: "trades" }).segment).toBe("payments");
  });
  it("ignores a tx that is not a payment key (a trade key, junk, an empty string)", () => {
    for (const tx of [`t:${id}`, "d:", "junk", ""]) expect(historyParams({ tx })).toEqual({ segment: null, filter: null, txKey: null });
  });
  it("ignores an unknown filter", () => {
    expect(historyParams({ filter: "everything" })).toEqual({ segment: null, filter: null, txKey: null });
  });
  it("takes the first value of a repeated param", () => {
    expect(historyParams({ filter: ["deposits", "trades"], tx: [`d:${id}`, "x"] })).toEqual({ segment: "payments", filter: "deposits", txKey: `d:${id}` });
  });
});
