import { describe, expect, it } from "vitest";
import { outboxMessage, tradeResultsMessage } from "./messages";

describe("outboxMessage", () => {
  it("announces a credited deposit with its bonus and links to its timeline", () => {
    const m = outboxMessage("deposit_credited", { depositId: "d1", amountMinor: 200_000, bonusMinor: 200_000, currency: "INR" }, "en");
    expect(m).toEqual({
      title: "Deposit credited",
      body: "₹2,000.00 added to your balance (+₹2,000.00 bonus)",
      url: "/history?tx=d:d1",
      channel: "payments",
    });
  });
  it("speaks Hindi when the device is set to Hindi", () => {
    const m = outboxMessage("withdrawal_paid", { withdrawalId: "w1", amountMinor: 500_000, currency: "INR", method: "UPI" }, "hi");
    expect(m.title).toBe("निकासी भेज दी गई");
    expect(m.url).toBe("/history?tx=w:w1");
  });
  it("includes the rejection reason", () => {
    expect(outboxMessage("withdrawal_rejected", { withdrawalId: "w1", amountMinor: 70_000, currency: "INR", reason: "Name mismatch" }, "en").body).toContain(
      "Name mismatch",
    );
  });
  it("sends KYC decisions to the verify screen", () => {
    expect(outboxMessage("kyc_verified", {}, "en")).toMatchObject({ url: "/account/verify", channel: "account" });
  });
});

describe("tradeResultsMessage", () => {
  it("names the market and result for a single trade", () => {
    expect(tradeResultsMessage([{ symbol: "EURUSD", pnl: 18_000, stake: 10_000, currency: "INR" }], "en").body).toBe("EUR/USD trade won +₹180.00");
  });
  it("sums several trades into one line", () => {
    const m = tradeResultsMessage(
      [
        { symbol: "EURUSD", pnl: 18_000, stake: 10_000, currency: "INR" },
        { symbol: "BTCUSD", pnl: -10_000, stake: 10_000, currency: "INR" },
        { symbol: "NIFTY50", pnl: 34_000, stake: 20_000, currency: "INR" },
      ],
      "en",
    );
    expect(m).toMatchObject({ title: "Trades closed", body: "3 trades closed: +₹420.00", url: "/history", channel: "trades" });
  });
});

it("uses actual CFD loss and preserves different currencies in one group", () => {
  expect(tradeResultsMessage([{ symbol: "XAUUSD", pnl: -2_000, stake: 10_000, currency: "INR" }], "en").body).toBe("XAU/USD trade lost ₹20.00");
  const mixed = tradeResultsMessage([{ symbol: "XAUUSD", pnl: 1_000, stake: 1_000, currency: "INR" }, { symbol: "EURUSD", pnl: -100, stake: 100, currency: "USD" }], "en");
  expect(mixed.body).toBe("2 trades closed: +₹10.00 · −$1.00");
  expect(tradeResultsMessage([{ symbol: "EURUSD", pnl: 0, stake: 100, currency: "INR" }], "en").body).toContain("closed: ₹0.00");
});
