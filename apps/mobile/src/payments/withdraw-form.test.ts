import { describe, expect, it } from "vitest";
import { CreateWithdrawalSchema, PayoutDetailsSchema, type WithdrawalPrefill } from "@asm/contracts";
import {
  amountProblem,
  accountConfirmValue,
  amountTextFromMinor,
  canCancelHeld,
  checkPayout,
  initialPayout,
  isFromLastWithdrawal,
  maxWithdrawMinor,
  nextCancelDeadlineMs,
  parseAmountMinor,
  payoutDestinationLabel,
  payoutIssueKey,
  withdrawAmountOpts,
  withdrawBody,
  withdrawModel,
  type PayoutDraft,
} from "./withdraw-form";

const ACCOUNT = "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11";
const TRON = "TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm";
const BSC = "0x52908400098527886E0F7030069857D2E4169EE7";

const prefill = (over: Partial<WithdrawalPrefill> = {}): WithdrawalPrefill => ({
  lastPayouts: {},
  initialMethod: null,
  kycName: "Asha Rao",
  kycStatus: "VERIFIED",
  heldWithdrawals: [],
  ...over,
});

describe("maxWithdrawMinor", () => {
  it("is the withdrawable balance when it is under the per-request limit", () => {
    expect(maxWithdrawMinor(820_000, "INR")).toBe(820_000);
  });
  it("is capped at the ₹50,000 limit", () => {
    expect(maxWithdrawMinor(9_000_000, "INR")).toBe(5_000_000);
  });
  it("floors an INR balance to whole rupees, because the keypad takes no paise", () => {
    expect(maxWithdrawMinor(820_099, "INR")).toBe(820_000);
    expect(maxWithdrawMinor(99, "INR")).toBe(0);
  });
  it("keeps cents on a USD account and caps it at $454.55 (₹50,000 at ₹110 = $1)", () => {
    expect(maxWithdrawMinor(12_345, "USD")).toBe(12_345);
    expect(maxWithdrawMinor(90_000, "USD")).toBe(45_455);
  });
  it("is never negative", () => {
    expect(maxWithdrawMinor(-500, "INR")).toBe(0);
    expect(maxWithdrawMinor(-500, "USD")).toBe(0);
  });
});

describe("parseAmountMinor", () => {
  it("turns whole rupees into paise without a float", () => {
    expect(parseAmountMinor("5000", "INR")).toBe(500_000);
    expect(parseAmountMinor("0", "INR")).toBe(0);
    expect(parseAmountMinor("", "INR")).toBe(0);
  });
  it("reads USD decimals digit by digit, so 0.29 is 29 cents and never 28.999", () => {
    expect(parseAmountMinor("12.5", "USD")).toBe(1250);
    expect(parseAmountMinor("0.29", "USD")).toBe(29);
    expect(parseAmountMinor("1.1", "USD")).toBe(110);
    expect(parseAmountMinor("7", "USD")).toBe(700);
    expect(parseAmountMinor("7.", "USD")).toBe(700);
  });
  it("is 0 for anything that is not a plain amount", () => {
    expect(parseAmountMinor("12.345", "USD")).toBe(0);
    expect(parseAmountMinor("1e3", "INR")).toBe(0);
    expect(parseAmountMinor("-5", "INR")).toBe(0);
    expect(parseAmountMinor("5.5", "INR")).toBe(0);
    expect(parseAmountMinor("99999999999999999999", "INR")).toBe(0);
  });
  it("always returns an integer", () => {
    for (const [text, cur] of [["1234567", "INR"], ["999.99", "USD"], ["0.01", "USD"]] as const) {
      expect(Number.isInteger(parseAmountMinor(text, cur))).toBe(true);
    }
  });
});

describe("amountTextFromMinor", () => {
  it("writes a whole-rupee max back as keypad text", () => {
    expect(amountTextFromMinor(820_000, "INR")).toBe("8200");
    expect(amountTextFromMinor(0, "INR")).toBe("");
  });
  it("writes USD with the cents it has and no stray zero", () => {
    expect(amountTextFromMinor(12_345, "USD")).toBe("123.45");
    expect(amountTextFromMinor(12_350, "USD")).toBe("123.5");
    expect(amountTextFromMinor(12_300, "USD")).toBe("123");
  });
  it("round-trips through parseAmountMinor", () => {
    expect(parseAmountMinor(amountTextFromMinor(820_000, "INR"), "INR")).toBe(820_000);
    expect(parseAmountMinor(amountTextFromMinor(12_305, "USD"), "USD")).toBe(12_305);
  });
});

describe("withdrawAmountOpts", () => {
  it("takes whole rupees on INR and two decimals on USD", () => {
    expect(withdrawAmountOpts("INR").decimals).toBe(false);
    expect(withdrawAmountOpts("USD").decimals).toBe(true);
  });
});

describe("amountProblem", () => {
  it("enforces ₹700 minimum and ₹50,000 maximum on INR", () => {
    expect(amountProblem(69_900, "INR", 10_000_000)).toBe("min");
    expect(amountProblem(5_000_100, "INR", 10_000_000)).toBe("max");
    expect(amountProblem(70_000, "INR", 10_000_000)).toBeNull();
    expect(amountProblem(5_000_000, "INR", 10_000_000)).toBeNull();
  });
  it("cannot exceed the withdrawable balance", () => {
    expect(amountProblem(100_000, "INR", 90_000)).toBe("balance");
  });
  it("uses $6.36 to $454.55 on a USD account (₹700 to ₹50,000 at ₹110 = $1)", () => {
    expect(amountProblem(635, "USD", 100_000)).toBe("min");
    expect(amountProblem(45_456, "USD", 100_000)).toBe("max");
    expect(amountProblem(636, "USD", 100_000)).toBeNull();
    expect(amountProblem(45_455, "USD", 100_000)).toBeNull();
  });
  it("shows no problem for an empty amount (the button is simply off)", () => {
    expect(amountProblem(0, "INR", 10_000_000)).toBeNull();
  });
});

describe("initialPayout", () => {
  it("is empty for a method never used, with the bank holder defaulting to the verified name", () => {
    expect(initialPayout(prefill(), "BANK")).toEqual({ method: "BANK", accountHolder: "Asha Rao", accountNumber: "", ifsc: "" });
    expect(initialPayout(prefill(), "UPI")).toEqual({ method: "UPI", upiId: "" });
    expect(initialPayout(prefill(), "USDT")).toEqual({ method: "USDT", usdtNetwork: "tron", usdtAddress: "" });
  });
  it("is the last payout for that method", () => {
    const p = prefill({
      lastPayouts: {
        BANK: { accountHolder: "A Rao", accountNumber: "123456789", ifsc: "HDFC0001234" },
        UPI: { upiId: "asha@okaxis" },
        USDT: { usdtNetwork: "bsc", usdtAddress: BSC },
      },
    });
    expect(initialPayout(p, "BANK")).toEqual({ method: "BANK", accountHolder: "A Rao", accountNumber: "123456789", ifsc: "HDFC0001234" });
    expect(initialPayout(p, "UPI")).toEqual({ method: "UPI", upiId: "asha@okaxis" });
    expect(initialPayout(p, "USDT")).toEqual({ method: "USDT", usdtNetwork: "bsc", usdtAddress: BSC });
  });
  it("does not carry one method's details into another", () => {
    const p = prefill({ lastPayouts: { UPI: { upiId: "asha@okaxis" } } });
    expect(initialPayout(p, "BANK")).toMatchObject({ accountNumber: "", ifsc: "" });
  });
});

describe("isFromLastWithdrawal", () => {
  const p = prefill({ lastPayouts: { UPI: { upiId: "asha@okaxis" } } });
  it("is true while every field still equals the saved one", () => {
    expect(isFromLastWithdrawal(p, { method: "UPI", upiId: "asha@okaxis" })).toBe(true);
  });
  it("turns off once the user changes a field", () => {
    expect(isFromLastWithdrawal(p, { method: "UPI", upiId: "asha@okaxi" })).toBe(false);
  });
  it("is false when nothing was saved for the method (the holder name alone is not a last withdrawal)", () => {
    expect(isFromLastWithdrawal(p, initialPayout(p, "BANK"))).toBe(false);
  });
});

describe("payoutIssueKey", () => {
  const issues = (draft: PayoutDraft) => {
    const r = PayoutDetailsSchema.safeParse(draft);
    return r.success ? [] : r.error.issues;
  };
  it("maps each field's schema problem to its own i18n key", () => {
    expect(payoutIssueKey(issues({ method: "BANK", accountHolder: "", accountNumber: "123456789", ifsc: "HDFC0001234" }))).toBe("withdraw.errHolder");
    expect(payoutIssueKey(issues({ method: "BANK", accountHolder: "Asha", accountNumber: "12", ifsc: "HDFC0001234" }))).toBe("withdraw.errAccount");
    expect(payoutIssueKey(issues({ method: "BANK", accountHolder: "Asha", accountNumber: "123456789", ifsc: "bad" }))).toBe("withdraw.errIfsc");
    expect(payoutIssueKey(issues({ method: "UPI", upiId: "nope" }))).toBe("withdraw.errUpi");
    expect(payoutIssueKey(issues({ method: "USDT", usdtNetwork: "tron", usdtAddress: "0xabc" }))).toBe("withdraw.errAddress");
  });
  it("never returns the schema's English message", () => {
    const key = payoutIssueKey(issues({ method: "UPI", upiId: "nope" }));
    expect(key.startsWith("withdraw.")).toBe(true);
    expect(key).not.toMatch(/Enter a valid/);
  });
  it("falls back to a generic key for a problem with no field", () => {
    expect(payoutIssueKey([])).toBe("withdraw.errDetails");
    expect(payoutIssueKey([{ path: [] }])).toBe("withdraw.errDetails");
    expect(payoutIssueKey([{ path: ["method"] }])).toBe("withdraw.errDetails");
  });
});

describe("checkPayout", () => {
  it("returns the contract-normalised payout when valid", () => {
    const r = checkPayout({ method: "UPI", upiId: "  Asha@OkAxis " });
    expect(r).toEqual({ ok: true, payout: { method: "UPI", upiId: "asha@okaxis" } });
  });
  it("upper-cases the IFSC and trims the holder", () => {
    const r = checkPayout({ method: "BANK", accountHolder: " Asha Rao ", accountNumber: "123456789", ifsc: "hdfc0001234" });
    expect(r).toEqual({ ok: true, payout: { method: "BANK", accountHolder: "Asha Rao", accountNumber: "123456789", ifsc: "HDFC0001234" } });
  });
  it("names the field and key of the first problem", () => {
    expect(checkPayout({ method: "BANK", accountHolder: "Asha", accountNumber: "123456789", ifsc: "bad" })).toEqual({
      ok: false,
      field: "ifsc",
      key: "withdraw.errIfsc",
      fieldKeys: { ifsc: "withdraw.errIfsc" },
    });
  });
  it("reports every failing field, so each shows its own message once it has been touched", () => {
    const r = checkPayout({ method: "BANK", accountHolder: "", accountNumber: "12", ifsc: "HDFC0001234" });
    expect(r).toMatchObject({ ok: false, field: "accountHolder" });
    expect(!r.ok && r.fieldKeys).toEqual({ accountHolder: "withdraw.errHolder", accountNumber: "withdraw.errAccount" });
  });
  it("checks the address against the chosen network", () => {
    expect(checkPayout({ method: "USDT", usdtNetwork: "tron", usdtAddress: TRON }).ok).toBe(true);
    expect(checkPayout({ method: "USDT", usdtNetwork: "bsc", usdtAddress: TRON })).toMatchObject({ ok: false, field: "usdtAddress" });
    expect(checkPayout({ method: "USDT", usdtNetwork: "bsc", usdtAddress: BSC }).ok).toBe(true);
  });
});

describe("withdrawModel", () => {
  const upi: PayoutDraft = { method: "UPI", upiId: "asha@okaxis" };
  it("can submit a valid amount with valid details", () => {
    const m = withdrawModel({ amountText: "5000", currency: "INR", withdrawable: 820_000, payout: upi });
    expect(m).toMatchObject({ amountMinor: 500_000, problem: null, canSubmit: true });
  });
  it("cannot submit an empty amount, and shows no problem for it", () => {
    expect(withdrawModel({ amountText: "", currency: "INR", withdrawable: 820_000, payout: upi })).toMatchObject({ problem: null, canSubmit: false });
  });
  it("cannot submit under the minimum, over the limit or over the balance", () => {
    expect(withdrawModel({ amountText: "699", currency: "INR", withdrawable: 820_000, payout: upi })).toMatchObject({ problem: "min", canSubmit: false });
    expect(withdrawModel({ amountText: "50001", currency: "INR", withdrawable: 9_000_000, payout: upi })).toMatchObject({ problem: "max", canSubmit: false });
    expect(withdrawModel({ amountText: "9000", currency: "INR", withdrawable: 820_000, payout: upi })).toMatchObject({ problem: "balance", canSubmit: false });
  });
  it("cannot submit invalid details, and says which field and key", () => {
    const m = withdrawModel({ amountText: "5000", currency: "INR", withdrawable: 820_000, payout: { method: "UPI", upiId: "nope" } });
    expect(m.canSubmit).toBe(false);
    expect(m.payout).toEqual({ ok: false, field: "upiId", key: "withdraw.errUpi", fieldKeys: { upiId: "withdraw.errUpi" } });
  });
  it("is told when the balance cannot reach the minimum at all", () => {
    expect(withdrawModel({ amountText: "", currency: "INR", withdrawable: 50_000, payout: upi }).belowMinimum).toBe(true);
    expect(withdrawModel({ amountText: "", currency: "INR", withdrawable: 70_000, payout: upi }).belowMinimum).toBe(false);
  });
  it("exposes the max the Max button writes", () => {
    expect(withdrawModel({ amountText: "", currency: "INR", withdrawable: 820_099, payout: upi }).maxMinor).toBe(820_000);
  });
});

describe("withdrawBody", () => {
  it("builds a valid UPI withdrawal", () => {
    const body = withdrawBody(ACCOUNT, 70_000, { method: "UPI", upiId: "asha@okaxis" });
    expect(body).toEqual({ accountId: ACCOUNT, amount: 70_000, payout: { method: "UPI", upiId: "asha@okaxis" } });
  });
  it("is exactly what the server's schema accepts, with an integer amount", () => {
    const body = withdrawBody(ACCOUNT, 500_000, { method: "USDT", usdtNetwork: "bsc", usdtAddress: BSC });
    expect(CreateWithdrawalSchema.safeParse(body).success).toBe(true);
    expect(Number.isInteger(body.amount)).toBe(true);
  });
  it("throws on an invalid IFSC so a bad body is never sent", () => {
    expect(() => withdrawBody(ACCOUNT, 70_000, { method: "BANK", accountHolder: "Asha", accountNumber: "123456789", ifsc: "bad" })).toThrow();
  });
  it("throws rather than sending a float, a zero or a negative amount", () => {
    const payout = { method: "UPI", upiId: "asha@okaxis" } as const;
    expect(() => withdrawBody(ACCOUNT, 70_000.5, payout)).toThrow();
    expect(() => withdrawBody(ACCOUNT, 0, payout)).toThrow();
    expect(() => withdrawBody(ACCOUNT, -1, payout)).toThrow();
    expect(() => withdrawBody(ACCOUNT, Number.NaN, payout)).toThrow();
  });
  it("throws for an account id that is not a uuid", () => {
    expect(() => withdrawBody("live", 70_000, { method: "UPI", upiId: "asha@okaxis" })).toThrow();
  });
});

describe("withdrawModel account confirmation", () => {
  const bank: PayoutDraft = { method: "BANK", accountHolder: "Asha Rao", accountNumber: "123456789012", ifsc: "HDFC0001234" };
  const run = (accountConfirm?: string, payout: PayoutDraft = bank) =>
    withdrawModel({ amountText: "5000", currency: "INR", withdrawable: 820_000, payout, accountConfirm });

  it("blocks a bank payout until the number is typed twice the same", () => {
    expect(run("123456789012")).toMatchObject({ canSubmit: true, accountConfirmKey: null });
  });
  it("blocks on a mismatch and names the problem line", () => {
    expect(run("123456789013")).toMatchObject({ canSubmit: false, accountConfirmKey: "withdraw.errAccountMatch" });
  });
  it("blocks while the confirmation is empty or was never given", () => {
    expect(run("")).toMatchObject({ canSubmit: false, accountConfirmKey: "withdraw.errAccountMatch" });
    expect(run(undefined)).toMatchObject({ canSubmit: false, accountConfirmKey: "withdraw.errAccountMatch" });
  });
  it("ignores surrounding spaces in the confirmation", () => {
    expect(run(" 123456789012 ")).toMatchObject({ canSubmit: true });
  });
  it("is not asked for UPI or USDT payouts", () => {
    expect(run(undefined, { method: "UPI", upiId: "asha@okaxis" })).toMatchObject({ canSubmit: true, accountConfirmKey: null });
    expect(run("zzz", { method: "USDT", usdtNetwork: "tron", usdtAddress: TRON })).toMatchObject({ canSubmit: true, accountConfirmKey: null });
  });
});

describe("accountConfirmValue", () => {
  const saved = prefill({ lastPayouts: { BANK: { accountHolder: "Asha Rao", accountNumber: "123456789012", ifsc: "HDFC0001234" } } });
  it("starts as the saved account number (as on the website), so an untouched saved payout needs no retyping", () => {
    expect(accountConfirmValue(saved, null)).toBe("123456789012");
  });
  it("starts empty when there is no saved bank payout", () => {
    expect(accountConfirmValue(prefill(), null)).toBe("");
  });
  it("is what the user typed once they have typed (even nothing)", () => {
    expect(accountConfirmValue(saved, "1234")).toBe("1234");
    expect(accountConfirmValue(saved, "")).toBe("");
  });
});

describe("payoutDestinationLabel", () => {
  it("shows a UPI ID in full", () => {
    expect(payoutDestinationLabel({ method: "UPI", upiId: "asha.rao@okaxis" })).toBe("asha.rao@okaxis");
  });
  it("shows a bank payout as holder, masked account and IFSC", () => {
    expect(payoutDestinationLabel({ method: "BANK", accountHolder: "Asha Rao", accountNumber: "123456789012", ifsc: "HDFC0001234" })).toBe(
      "Asha Rao\nA/c \u2022\u2022\u2022\u20229012 \u00b7 HDFC0001234",
    );
  });
  it("shows a USDT payout as its network and a shortened address", () => {
    expect(payoutDestinationLabel({ method: "USDT", usdtNetwork: "tron", usdtAddress: TRON })).toBe("TRC-20 TQrY8t\u2026yn4STm");
    expect(payoutDestinationLabel({ method: "USDT", usdtNetwork: "bsc", usdtAddress: BSC })).toBe("BEP-20 0x5290\u2026169EE7");
  });
});

describe("canCancelHeld", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  it("offers Cancel only while the cancel deadline is ahead", () => {
    expect(canCancelHeld({ cancelableUntil: "2026-10-20T12:00:01Z" }, NOW)).toBe(true);
    expect(canCancelHeld({ cancelableUntil: "2026-10-20T12:00:00Z" }, NOW)).toBe(false);
    expect(canCancelHeld({ cancelableUntil: "2026-10-20T08:00:00Z" }, NOW)).toBe(false);
  });
  it("keeps offering it when an older server sent no deadline field at all, or one that cannot be read", () => {
    expect(canCancelHeld({}, NOW)).toBe(true);
    expect(canCancelHeld({ cancelableUntil: undefined }, NOW)).toBe(true);
    expect(canCancelHeld({ cancelableUntil: "soon" }, NOW)).toBe(true);
  });
  it("does not offer it when the server says the row has no cancel deadline (null: it cannot be cancelled)", () => {
    expect(canCancelHeld({ cancelableUntil: null }, NOW)).toBe(false);
  });
});

describe("nextCancelDeadlineMs", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  it("is the soonest deadline still ahead, so the screen can re-check then", () => {
    const rows = [{ cancelableUntil: "2026-10-20T08:00:00Z" }, { cancelableUntil: "2026-10-20T15:00:00Z" }, { cancelableUntil: "2026-10-20T13:00:00Z" }, { cancelableUntil: null }];
    expect(nextCancelDeadlineMs(rows, NOW)).toBe(Date.parse("2026-10-20T13:00:00Z"));
  });
  it("is null when none is ahead", () => {
    expect(nextCancelDeadlineMs([{ cancelableUntil: "2026-10-20T08:00:00Z" }, { cancelableUntil: null }], NOW)).toBeNull();
    expect(nextCancelDeadlineMs([], NOW)).toBeNull();
  });
});
