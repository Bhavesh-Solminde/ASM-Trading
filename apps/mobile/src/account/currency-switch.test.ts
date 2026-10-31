import { describe, expect, it, vi } from "vitest";
import { USD_INR_RATE } from "@asm/contracts";
import { ApiError } from "@/api/errors";
import {
  CURRENCY_SWITCH_TIMEOUT_MS,
  SWITCH_CURRENCIES,
  createCurrencySwitcher,
  currencyRows,
  currencySwitchErrorText,
  otherCurrency,
  type CurrencySwitchDeps,
} from "./currency-switch";

const DEMO = { id: "d1", type: "DEMO" as const, currency: "INR", realBalance: 10_00_000_00, bonusBalance: 0 };
const LIVE = { id: "l1", type: "LIVE" as const, currency: "USD", realBalance: 1_234_56, bonusBalance: 50_00 };

describe("currencies", () => {
  it("come from the contract's enum (no local mirror)", () => {
    expect([...SWITCH_CURRENCIES]).toEqual(["INR", "USD"]);
  });
  it("otherCurrency flips INR and USD and refuses anything else", () => {
    expect(otherCurrency("INR")).toBe("USD");
    expect(otherCurrency("USD")).toBe("INR");
    expect(otherCurrency("EUR")).toBeNull();
  });
});

describe("currencyRows", () => {
  it("lists Demo then Live, each with the other currency and the converted preview of the whole balance", () => {
    const rows = currencyRows([LIVE, DEMO]);
    expect(rows.map((r) => r.type)).toEqual(["DEMO", "LIVE"]);
    // Demo: INR minor (paise) / 110 = cents (₹110 = $1), rounded.
    expect(rows[0]).toMatchObject({ accountId: "d1", currency: "INR", next: "USD", totalMinor: 10_00_000_00, previewMinor: 9_09_091 });
    // Live: real + bonus, USD cents * 110 = paise.
    expect(rows[1]).toMatchObject({ accountId: "l1", currency: "USD", next: "INR", totalMinor: 1_284_56, previewMinor: 1_284_56 * USD_INR_RATE });
  });
  it("prefers the socket's live balance over the bootstrap's", () => {
    const rows = currencyRows([DEMO, LIVE], { l1: { realBalance: 200_00, bonusBalance: 0 } });
    expect(rows[1]).toMatchObject({ totalMinor: 200_00, previewMinor: 200_00 * USD_INR_RATE });
  });
  it("rounds an INR to USD preview the way the server does", () => {
    const rows = currencyRows([{ ...DEMO, realBalance: 15_050, bonusBalance: 49 }]);
    expect(rows[0]!.previewMinor).toBe(Math.round(15_050 / USD_INR_RATE) + Math.round(49 / USD_INR_RATE));
  });
  it("rounds the real and the bonus balance separately, as the server does (149 + 149 paise is 2 cents, not 3)", () => {
    const rows = currencyRows([{ ...DEMO, realBalance: 149, bonusBalance: 149 }]);
    expect(rows[0]!.previewMinor).toBe(2);
    expect(rows[0]!.totalMinor).toBe(298);
  });
  it("leaves out an account whose currency cannot be switched", () => {
    expect(currencyRows([{ ...DEMO, currency: "EUR" }, LIVE]).map((r) => r.accountId)).toEqual(["l1"]);
  });
  it("is empty without accounts", () => {
    expect(currencyRows(undefined)).toEqual([]);
    expect(currencyRows([])).toEqual([]);
  });
});

const t = (k: string, o?: Record<string, unknown>) => `<${k}${o ? JSON.stringify(o) : ""}>`;

describe("currencySwitchErrorText", () => {
  it("shows the server's own message for a refusal (409)", () => {
    expect(currencySwitchErrorText(new ApiError("Account not found.", 409, null), t)).toBe("Account not found.");
  });
  it("shows the server's refusal verbatim, whatever its code (e.g. a pending withdrawal)", () => {
    const msg = "Finish or cancel your pending withdrawal first.";
    expect(currencySwitchErrorText(new ApiError(msg, 409, "pending_withdrawal"), t)).toBe(msg);
  });
  it("reads offline and timeout as 'check your balance first' (the switch may have landed)", () => {
    expect(currencySwitchErrorText(new ApiError("x", 0, "timeout"), t)).toBe("<currency.timedOut>");
    expect(currencySwitchErrorText(new ApiError("x", 0, "offline"), t)).toBe("<currency.timedOut>");
  });
  it("is generic for a 5xx, a bare error and a non-ApiError", () => {
    expect(currencySwitchErrorText(new ApiError("Something went wrong.", 500, null), t)).toBe("<common.genericError>");
    expect(currencySwitchErrorText(new Error("boom"), t)).toBe("<common.genericError>");
  });
});

function setup(post: CurrencySwitchDeps["post"]) {
  const deps = {
    post: vi.fn(post),
    refresh: vi.fn(),
    refetchTrades: vi.fn(),
    toast: vi.fn(),
    session: vi.fn(() => "tok-A" as string | null),
    setBusy: vi.fn(),
    t,
  };
  return { deps, run: createCurrencySwitcher(deps) };
}

describe("createCurrencySwitcher (a money-moving POST: one at a time, no retry)", () => {
  it("has a request timeout", () => {
    expect(CURRENCY_SWITCH_TIMEOUT_MS).toBe(15_000);
  });

  it("posts the account and the new currency, then refreshes money, refetches that account's trades and says so", async () => {
    const { deps, run } = setup(async () => ({ currency: "USD" }));
    await run("l1", "USD");
    expect(deps.post).toHaveBeenCalledWith("l1", "USD");
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.refetchTrades).toHaveBeenCalledWith("l1");
    expect(deps.toast).toHaveBeenCalledWith('<currency.done{"currency":"USD"}>', "up");
    expect(deps.setBusy.mock.calls).toEqual([["l1"], [null]]);
  });

  it("ignores a second tap while one is in flight (two taps in one frame cannot both pass)", async () => {
    let release!: (v: unknown) => void;
    let calls = 0;
    const { deps, run } = setup(() => (calls++ === 0 ? new Promise((r) => (release = r)) : Promise.resolve({})));
    const first = run("l1", "USD");
    await run("d1", "USD");
    await run("l1", "USD");
    expect(deps.post).toHaveBeenCalledTimes(1);
    release({});
    await first;
    await run("l1", "INR");
    expect(deps.post).toHaveBeenCalledTimes(2);
  });

  it("shows the server's message on a 409 and does not refresh or retry", async () => {
    const { deps, run } = setup(async () => {
      throw new ApiError("Unsupported currency.", 409, null);
    });
    await run("l1", "USD");
    expect(deps.post).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith("Unsupported currency.", "down");
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.setBusy.mock.calls.at(-1)).toEqual([null]);
  });

  it.each(["timeout", "offline"])("after %s it refreshes anyway (the switch may have landed) and never resends", async (code) => {
    const { deps, run } = setup(async () => {
      throw new ApiError("x", 0, code);
    });
    await run("l1", "USD");
    expect(deps.post).toHaveBeenCalledTimes(1);
    expect(deps.refresh).toHaveBeenCalledTimes(1);
    expect(deps.refetchTrades).toHaveBeenCalledWith("l1");
    expect(deps.toast).toHaveBeenCalledWith("<currency.timedOut>", "down");
  });

  it.each(["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"])("does not toast %s (already reported elsewhere)", async (code) => {
    const { deps, run } = setup(async () => {
      throw new ApiError("x", 429, code);
    });
    await run("l1", "USD");
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.setBusy.mock.calls.at(-1)).toEqual([null]);
  });

  it("drops the outcome when the session changed while the request was in flight", async () => {
    const { deps, run } = setup(async () => {
      deps.session.mockReturnValue("tok-B");
      return {};
    });
    await run("l1", "USD");
    expect(deps.refresh).not.toHaveBeenCalled();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.setBusy.mock.calls.at(-1)).toEqual([null]);
  });
});
