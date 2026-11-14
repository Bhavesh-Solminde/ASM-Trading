// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProgramActivityItem, ProgramSummary } from "@asm/db";
import { ProgramEarningsPanel, rupeesToPaise } from "./ProgramEarningsPanel";

const { refresh, applyBalanceUpdate } = vi.hoisted(() => ({ refresh: vi.fn(), applyBalanceUpdate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/shell/PlatformProvider", () => ({ usePlatform: () => ({ applyBalanceUpdate }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function summary(over: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    isAffiliate: false,
    affiliateStatus: null,
    emailVerified: true,
    kycStatus: "VERIFIED",
    currency: "INR",
    pendingMinor: 50_00,
    heldMinor: 0,
    availableMinor: 5_000_00,
    reservedMinor: 0,
    transferredMinor: 0,
    paidMinor: 0,
    carryForwardMinor: 0,
    totalReferrals: 3,
    qualifiedUsers: 1,
    totalDepositedMinor: 500_00,
    terms: {
      userRewardMinor: 50_00,
      affiliateDepositRewardBps: 500,
      revenueShareBps: 0,
      minQualifyingDepositMinor: 500_00,
      minQualifyingTradeMinor: 100_00,
      inviteExtraBonusPct: 10,
      minWithdrawalMinor: 1_999_00,
      limits: { day: 1, week: 3, month: 5 },
    },
    used: { day: 0, week: 0, month: 0 },
    canTransfer: true,
    canWithdraw: true,
    blockers: [],
    ...over,
  };
}

function renderPanel(s: ProgramSummary = summary(), activity: ProgramActivityItem[] = []) {
  render(createElement(ProgramEarningsPanel, { summary: s, activity }));
}

function stubFetch(...responses: ({ ok: boolean; body: unknown } | Error)[]) {
  const fetch = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fetch.mockRejectedValueOnce(r);
    else fetch.mockResolvedValueOnce({ ok: r.ok, json: async () => r.body });
  }
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const sent = (fetch: ReturnType<typeof vi.fn>, i = 0) => JSON.parse(fetch.mock.calls[i]![1].body as string) as Record<string, unknown>;
const forms = () => document.querySelectorAll("form");

describe("rupeesToPaise", () => {
  it("converts rupee strings to integer paise without float drift", () => {
    expect(rupeesToPaise("1999")).toBe(1_999_00);
    expect(rupeesToPaise("0.1")).toBe(10);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("1e3")).toBeNull();
  });
});

describe("transfer form", () => {
  it("sends paise and a UUID idempotency key, then updates the trading balance", async () => {
    const fetch = stubFetch({ ok: true, body: { transferId: "t1", accountId: "acc1", balance: { realBalance: 1, bonusBalance: 0 } } });
    renderPanel();
    fireEvent.change(screen.getAllByLabelText("Amount (₹)")[0]!, { target: { value: "250.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await screen.findByText("₹250.50 moved to your trading balance.");
    expect(fetch.mock.calls[0]![0]).toBe("/api/program/transfer");
    expect(sent(fetch)).toEqual({ amountMinor: 250_50, idempotencyKey: expect.stringMatching(UUID) });
    expect(applyBalanceUpdate).toHaveBeenCalledWith("acc1", { realBalance: 1, bonusBalance: 0 });
    expect(refresh).toHaveBeenCalled();
  });

  it("reuses the key after a network failure and renews it after an answer", async () => {
    const fetch = stubFetch(new Error("offline"), { ok: false, body: { error: "Nope." } }, { ok: false, body: { error: "Nope." } });
    renderPanel();
    fireEvent.change(screen.getAllByLabelText("Amount (₹)")[0]!, { target: { value: "10" } });
    const button = screen.getByRole("button", { name: "Transfer" });
    fireEvent.click(button);
    await screen.findByText(/Network error/);
    fireEvent.click(button);
    await screen.findByText("Nope.");
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(sent(fetch, 1).idempotencyKey).toBe(sent(fetch, 0).idempotencyKey);
    expect(sent(fetch, 2).idempotencyKey).not.toBe(sent(fetch, 1).idempotencyKey);
  });

  it("refuses more than available without calling the API", () => {
    const fetch = stubFetch();
    renderPanel();
    fireEvent.change(screen.getAllByLabelText("Amount (₹)")[0]!, { target: { value: "5000.01" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    expect(screen.getByRole("alert").textContent).toMatch(/more than your available/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("withdrawal form", () => {
  it("sends paise, the UPI payout and a UUID key", async () => {
    const fetch = stubFetch({ ok: true, body: { id: "w1", status: "REQUESTED", amountMinor: 1_999_00 } });
    renderPanel();
    fireEvent.change(screen.getAllByLabelText("Amount (₹)")[1]!, { target: { value: "1999" } });
    fireEvent.click(screen.getByRole("radio", { name: /UPI/ }));
    fireEvent.change(screen.getByLabelText("UPI ID"), { target: { value: "me@okaxis" } });
    fireEvent.click(screen.getByRole("button", { name: "Request withdrawal" }));
    await screen.findByText(/Withdrawal of ₹1,999.00 requested/);
    expect(fetch.mock.calls[0]![0]).toBe("/api/program/withdrawals");
    expect(sent(fetch)).toEqual({
      amountMinor: 1_999_00,
      payout: { method: "UPI", upiId: "me@okaxis" },
      idempotencyKey: expect.stringMatching(UUID),
    });
  });

  it("checks the minimum and the bank details before sending", () => {
    const fetch = stubFetch();
    renderPanel();
    const amount = screen.getAllByLabelText("Amount (₹)")[1]!;
    fireEvent.change(amount, { target: { value: "1998.99" } });
    fireEvent.click(screen.getByRole("button", { name: "Request withdrawal" }));
    expect(screen.getByRole("alert").textContent).toBe("The minimum withdrawal is ₹1,999.");
    fireEvent.change(amount, { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Account holder name"), { target: { value: "Asha Rao" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "001234567890" } });
    fireEvent.change(screen.getByLabelText("Confirm account number"), { target: { value: "001234567891" } });
    fireEvent.change(screen.getByLabelText("IFSC code"), { target: { value: "HDFC0001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Request withdrawal" }));
    expect(screen.getByRole("alert").textContent).toBe("The account numbers don't match.");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("requirements and blockers", () => {
  it("explains each blocker and disables the blocked forms", () => {
    renderPanel(
      summary({
        kycStatus: "NOT_STARTED",
        canWithdraw: false,
        blockers: ["kyc_required", "limit_day"],
        used: { day: 1, week: 1, month: 1 },
      }),
    );
    expect(screen.getByText("Verify your identity before withdrawing earnings.")).toBeTruthy();
    expect(screen.getByText(/today's withdrawal limit \(1 per day\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start verification" }).getAttribute("href")).toBe("/account/verify");
    expect(screen.getByText(/Minimum withdrawal ₹1,999\. Withdrawals used: today 1\/1, this week 1\/3, this month 1\/5\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Request withdrawal" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Transfer" }) as HTMLButtonElement).disabled).toBe(false);
    expect(forms()).toHaveLength(2);
  });

  it("shows the affiliate status and carried-forward Revenue Share", () => {
    renderPanel(
      summary({ isAffiliate: true, affiliateStatus: "SUSPENDED", carryForwardMinor: -120_00, blockers: ["affiliate_not_active"] }),
    );
    expect(screen.getByText(/affiliate account is suspended/)).toBeTruthy();
    expect(screen.getByText("−₹120.00")).toBeTruthy();
  });
});

describe("history", () => {
  const at = new Date("2026-11-10T10:00:00Z");
  const items: ProgramActivityItem[] = [
    { id: "w1", date: at, type: "WITHDRAWAL", kind: "WITHDRAWAL", amountMinor: 2_000_00, status: "REQUESTED", method: "UPI", reason: null },
    { id: "w2", date: at, type: "WITHDRAWAL", kind: "WITHDRAWAL", amountMinor: 3_000_00, status: "REJECTED", method: "BANK", reason: "Name mismatch" },
    { id: "e1", date: at, type: "EARNING", kind: "REFERRAL_REWARD", amountMinor: 50_00, status: "HELD", method: null, reason: "self-referral flag open or confirmed" },
  ];

  it("lists rows, shows only withdrawal rejection reasons, and cancels REQUESTED withdrawals", async () => {
    const fetch = stubFetch({ ok: true, body: { id: "w1", status: "CANCELLED" } });
    renderPanel(summary(), items);
    expect(screen.getByText(/Name mismatch/)).toBeTruthy();
    expect(screen.queryByText(/self-referral/)).toBeNull(); // internal hold reasons stay internal
    expect(screen.getByText("Referral reward")).toBeTruthy();
    const cancels = screen.getAllByRole("button", { name: /^Cancel withdrawal/ });
    expect(cancels).toHaveLength(1);
    fireEvent.click(cancels[0]!);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch.mock.calls[0]![0]).toBe("/api/program/withdrawals/w1/cancel");
    expect(fetch.mock.calls[0]![1].method).toBe("POST");
  });
});
