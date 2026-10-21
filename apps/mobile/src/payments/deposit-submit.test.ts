import { describe, expect, it, vi } from "vitest";
import type { CreateDepositInput } from "@asm/contracts";
import { ApiError } from "@/api/errors";
import { createDepositSubmitter, depositErrorText, type DepositSubmitDeps } from "./deposit-submit";

const t = (key: string) => `t:${key}`;
const body: CreateDepositInput = { method: "PhonePe", amountInr: 200_000 };

function setup(post: DepositSubmitDeps["post"], over: Partial<DepositSubmitDeps> = {}) {
  const calls: string[] = [];
  const busy: boolean[] = [];
  const deps: DepositSubmitDeps = {
    post,
    savePending: (token) => calls.push(`save:${token}`),
    invalidateMoney: () => calls.push("invalidate"),
    navigate: (token) => calls.push(`go:${token}`),
    toast: (m) => calls.push(`toast:${m}`),
    session: () => "s1",
    setBusy: (b) => busy.push(b),
    t,
    ...over,
  };
  return { run: createDepositSubmitter(deps), calls, busy };
}

describe("depositErrorText", () => {
  it("translates offline, timeout and server errors, never showing the server's English for a 5xx", () => {
    expect(depositErrorText(new ApiError("No connection.", 0, "offline"), t)).toBe("t:common.noConnection");
    expect(depositErrorText(new ApiError("The request timed out.", 0, "timeout"), t)).toBe("t:deposit.timedOut");
    expect(depositErrorText(new ApiError("Something went wrong.", 503, null), t)).toBe("t:common.genericError");
    expect(depositErrorText(new ApiError("x", 500, null), t)).toBe("t:common.genericError");
  });
  it("explains a 503 the deposit route answered itself (a network, a method or the amounts are unavailable right now) in the user's language", () => {
    expect(depositErrorText(new ApiError("USDT on TRON is temporarily unavailable. Try again later.", 503, null), t)).toBe("t:deposit.unavailable");
    expect(depositErrorText(new ApiError("PhonePe deposits are coming soon. Use USDT for now.", 503, null), t)).toBe("t:deposit.unavailable");
  });
  it("shows another 4xx's own message, as the rules say, but the translated generic for a bare one", () => {
    expect(depositErrorText(new ApiError("Other TRON deposits are in progress. Try again in about 3 minutes.", 409, null), t)).toBe(
      "Other TRON deposits are in progress. Try again in about 3 minutes.",
    );
    expect(depositErrorText(new ApiError("Something went wrong.", 400, null), t)).toBe("t:common.genericError");
  });
  it("falls back to the generic text for anything that is not an ApiError", () => {
    expect(depositErrorText(new Error("x"), t)).toBe("t:common.genericError");
  });
});

describe("createDepositSubmitter", () => {
  it("on success saves the pending checkout, refreshes the money queries and goes to the pay screen, in that order", async () => {
    const { run, calls } = setup(async () => ({ checkoutToken: "tok-9" }));
    await run(body);
    expect(calls).toEqual(["save:tok-9", "invalidate", "go:tok-9"]);
  });

  it("sends the body it was given, exactly once", async () => {
    const post = vi.fn(async () => ({ checkoutToken: "tok-9" }));
    const { run } = setup(post);
    await run(body);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(body);
  });

  it("stays busy after a success: the screen is being replaced and a second tap must not create another deposit", async () => {
    const { run, busy } = setup(async () => ({ checkoutToken: "tok-9" }));
    await run(body);
    expect(busy).toEqual([true]);
  });

  it("ignores a second tap while the first is in flight (one POST, not two)", async () => {
    let release: (v: unknown) => void = () => {};
    const post = vi.fn(() => new Promise((r) => (release = r)));
    const { run, calls } = setup(post);
    const first = run(body);
    await run(body);
    await run(body);
    expect(post).toHaveBeenCalledTimes(1);
    release({ checkoutToken: "tok-1" });
    await first;
    expect(calls).toEqual(["save:tok-1", "invalidate", "go:tok-1"]);
  });

  it("on a timeout never retries or navigates: it refreshes the money queries and tells the user to check Payments", async () => {
    const post = vi.fn(async () => {
      throw new ApiError("The request timed out.", 0, "timeout");
    });
    const { run, calls, busy } = setup(post);
    await run(body);
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["invalidate", "toast:t:deposit.timedOut"]);
    expect(busy).toEqual([true, false]);
  });

  it("frees the button after an error so the user can try again, with a translated or server message", async () => {
    const { run, calls, busy } = setup(async () => {
      throw new ApiError("No connection.", 0, "offline");
    });
    await run(body);
    // The request may have reached the server before the connection dropped, so it reconciles as a timeout does.
    expect(calls).toEqual(["invalidate", "toast:t:common.noConnection"]);
    expect(busy).toEqual([true, false]);
  });

  it("stays quiet for errors something else already reports (rate limit toast, gate screen, sign-out)", async () => {
    for (const code of ["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]) {
      const { run, calls } = setup(async () => {
        throw new ApiError("x", 429, code);
      });
      await run(body);
      expect(calls, code).toEqual([]);
    }
  });

  it("treats an answer it cannot read as unknown: refreshes, toasts the generic error, never navigates", async () => {
    const { run, calls } = setup(async () => ({ wrong: true }));
    await run(body);
    expect(calls).toEqual(["invalidate", "toast:t:common.genericError"]);
  });

  it("drops the result when the session changed while the request was out", async () => {
    let token = "s1";
    const { run, calls } = setup(
      async () => {
        token = "s2";
        return { checkoutToken: "tok-9" };
      },
      { session: () => token },
    );
    await run(body);
    expect(calls).toEqual([]);
  });

  it("drops a failure too when the session changed", async () => {
    let token = "s1";
    const { run, calls } = setup(
      async () => {
        token = "s2";
        throw new ApiError("x", 500, null);
      },
      { session: () => token },
    );
    await run(body);
    expect(calls).toEqual([]);
  });
});
