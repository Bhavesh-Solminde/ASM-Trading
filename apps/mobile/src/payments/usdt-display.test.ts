import { describe, expect, it } from "vitest";
import { networkLabel, networkNote, usdtAddressNoteKey, usdtAmountText, usdtHintKey, usdtStatusLineKey } from "./usdt-display";

describe("usdtAmountText", () => {
  it("formats USDT cents with two decimals", () => {
    expect(usdtAmountText(1234)).toBe("12.34");
    expect(usdtAmountText(2000)).toBe("20.00");
    expect(usdtAmountText(5)).toBe("0.05");
    expect(usdtAmountText(null)).toBe("0.00");
  });
  it("has no thousands separator: it is the text that gets copied into a wallet", () => {
    expect(usdtAmountText(123_456_789)).toBe("1234567.89");
  });
  it("reads anything that is not a usable number as zero rather than throwing", () => {
    expect(usdtAmountText(Number.NaN)).toBe("0.00");
    expect(usdtAmountText(-300)).toBe("0.00");
    expect(usdtAmountText(12.7)).toBe("0.12");
  });
});

describe("networkLabel", () => {
  it("is the short label the contract gives: name and token standard", () => {
    expect(networkLabel("tron")).toBe("TRON (TRC-20)");
    expect(networkLabel("bsc")).toBe("BNB Smart Chain (BEP-20)");
  });
  it("falls back to plain USDT for a network this app does not know", () => {
    expect(networkLabel("eth")).toBe("USDT");
    expect(networkLabel("BSC")).toBe("USDT");
    expect(networkLabel(null)).toBe("USDT");
  });
});

describe("networkNote", () => {
  it("names the chain alone, for the sentence 'on the <chain> network only'", () => {
    expect(networkNote("tron").chain).toBe("TRON");
    expect(networkNote("bsc").chain).toBe("BNB Smart Chain");
    expect(networkNote(null).chain).toBe("USDT");
  });
  it("flags BSC's look-alike risk (its addresses read the same as Ethereum's), as the website does", () => {
    expect(networkNote("bsc").lookalike).toBe(true);
    expect(networkNote("tron").lookalike).toBe(false);
    expect(networkNote(null).lookalike).toBe(false);
  });
});

describe("usdtStatusLineKey", () => {
  it("says a gateway payment is detected by itself, and a manual one is waited for", () => {
    expect(usdtStatusLineKey({ status: "AWAITING_PAYMENT", isGateway: true })).toBe("usdt.detectAuto");
    expect(usdtStatusLineKey({ status: "AWAITING_PAYMENT", isGateway: false })).toBe("pay.waiting");
  });
  it("says 'confirming' once it is being confirmed (never the UTR line: there is no UTR on-chain)", () => {
    expect(usdtStatusLineKey({ status: "PENDING_CONFIRMATION", isGateway: false })).toBe("usdt.confirming");
  });
  it("is nothing for a final status: the result screen takes over", () => {
    for (const status of ["COMPLETED", "REJECTED", "EXPIRED"]) expect(usdtStatusLineKey({ status, isGateway: false })).toBeNull();
  });
});

describe("usdtHintKey", () => {
  it("picks the website's sending rule for the rail: gateway (at least), slot (within 3%), manual (exact)", () => {
    expect(usdtHintKey({ isGateway: true, isSlot: false })).toBe("usdt.hintGateway");
    expect(usdtHintKey({ isGateway: false, isSlot: true })).toBe("usdt.hintSlot");
    expect(usdtHintKey({ isGateway: false, isSlot: false })).toBe("usdt.hintManual");
  });
  it("lets the gateway win if the server ever sends both", () => {
    expect(usdtHintKey({ isGateway: true, isSlot: true })).toBe("usdt.hintGateway");
  });
});

describe("usdtAddressNoteKey", () => {
  it("says whose the address is: unique to this deposit (gateway), reserved until the timer ends (slot), else nothing", () => {
    expect(usdtAddressNoteKey({ isGateway: true, isSlot: false })).toBe("usdt.addressUnique");
    expect(usdtAddressNoteKey({ isGateway: false, isSlot: true })).toBe("usdt.addressReserved");
    expect(usdtAddressNoteKey({ isGateway: false, isSlot: false })).toBeNull();
  });
});
