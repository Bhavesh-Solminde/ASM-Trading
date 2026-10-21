import { describe, expect, it, vi } from "vitest";
import type { CreateWithdrawalInput } from "@asm/contracts";
import { ApiError } from "@/api/errors";
import {
  WITHDRAW_TIMEOUT_MS,
  createCancelSubmitter,
  createWithdrawSubmitter,
  withdrawErrorText,
  type CancelSubmitDeps,
  type WithdrawSubmitDeps,
} from "./withdraw-submit";

const t = (key: string) => `t:${key}`;
const body: CreateWithdrawalInput = {
  accountId: "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11",
  amount: 500_000,
  payout: { method: "UPI", upiId: "asha@okaxis" },
};

function setup(post: WithdrawSubmitDeps["post"], over: Partial<WithdrawSubmitDeps> = {}) {
  const calls: string[] = [];
  const busy: boolean[] = [];
  const deps: WithdrawSubmitDeps = {
    post,
    invalidateMoney: () => calls.push("money"),
    invalidatePrefill: () => calls.push("prefill"),
    navigate: (id) => calls.push(`go:${id}`),
    toast: (m, tone) => calls.push(`toast:${tone}:${m}`),
    session: () => "s1",
    setBusy: (b) => busy.push(b),
    t,
    ...over,
  };
  return { run: createWithdrawSubmitter(deps), calls, busy };
}

describe("withdrawErrorText", () => {
  it("translates offline, timeout, 5xx and a bare error, never showing the server's English for them", () => {
    expect(withdrawErrorText(new ApiError("No connection.", 0, "offline"), t)).toBe("t:common.noConnection");
    expect(withdrawErrorText(new ApiError("The request timed out.", 0, "timeout"), t)).toBe("t:withdraw.timedOut");
    expect(withdrawErrorText(new ApiError("Boom", 500, null), t)).toBe("t:common.genericError");
    expect(withdrawErrorText(new ApiError("Something went wrong.", 400, null), t)).toBe("t:common.genericError");
  });
  it("shows another 4xx's own message", () => {
    expect(withdrawErrorText(new ApiError("The cancel window has passed.", 409, null), t)).toBe("The cancel window has passed.");
    expect(withdrawErrorText(new ApiError("The minimum withdrawal is ₹700.", 400, null), t)).toBe("The minimum withdrawal is ₹700.");
  });
  it("falls back to the generic text for anything that is not an ApiError", () => {
    expect(withdrawErrorText(new Error("x"), t)).toBe("t:common.genericError");
  });
});

describe("createWithdrawSubmitter", () => {
  it("has a 15 second money-POST timeout", () => {
    expect(WITHDRAW_TIMEOUT_MS).toBe(15_000);
  });

  it("on success toasts, refreshes the money and prefill queries and opens the withdrawal in History, in that order", async () => {
    const { run, calls } = setup(async () => ({ id: "w-9", status: "REQUESTED" }));
    await run(body);
    expect(calls).toEqual(["toast:up:t:withdraw.requested", "money", "prefill", "go:w-9"]);
  });

  it("says a first withdrawal is on hold when the server held it", async () => {
    const { run, calls } = setup(async () => ({ id: "w-9", status: "HELD" }));
    await run(body);
    expect(calls[0]).toBe("toast:up:t:withdraw.heldToast");
  });

  it("sends the body it was given, exactly once", async () => {
    const post = vi.fn(async () => ({ id: "w-9", status: "REQUESTED" }));
    const { run } = setup(post);
    await run(body);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(body);
  });

  it("ignores a second tap while the first is in flight", async () => {
    let finish: (v: unknown) => void = () => undefined;
    const post = vi.fn(() => new Promise<unknown>((resolve) => (finish = resolve)));
    const { run } = setup(post);
    const first = run(body);
    await run(body);
    await run(body);
    expect(post).toHaveBeenCalledTimes(1);
    finish({ id: "w-9", status: "REQUESTED" });
    await first;
  });

  it("is busy for the whole call and stays busy after a success, because the screen is being replaced", async () => {
    const { run, busy } = setup(async () => ({ id: "w-9", status: "REQUESTED" }));
    await run(body);
    expect(busy).toEqual([true]);
  });

  it("ignores a tap after a success (no second withdrawal while the screen leaves)", async () => {
    const post = vi.fn(async () => ({ id: "w-9", status: "REQUESTED" }));
    const { run } = setup(post);
    await run(body);
    await run(body);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("on a timeout refetches, tells the user to check Payments, never retries, and frees the button", async () => {
    const post = vi.fn(async () => {
      throw new ApiError("The request timed out.", 0, "timeout");
    });
    const { run, calls, busy } = setup(post);
    await run(body);
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["money", "prefill", "toast:down:t:withdraw.timedOut"]);
    expect(busy).toEqual([true, false]);
  });

  it("a second tap after a timeout is a fresh, deliberate attempt", async () => {
    const post = vi
      .fn<WithdrawSubmitDeps["post"]>()
      .mockRejectedValueOnce(new ApiError("t", 0, "timeout"))
      .mockResolvedValueOnce({ id: "w-9", status: "REQUESTED" });
    const { run } = setup(post);
    await run(body);
    await run(body);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("on a 4xx shows the server's message, refreshes the prefill (the gate may have changed) and frees the button", async () => {
    const { run, calls, busy } = setup(async () => {
      throw new ApiError("Verify your identity before withdrawing.", 400, null);
    });
    await run(body);
    expect(calls).toEqual(["prefill", "toast:down:Verify your identity before withdrawing."]);
    expect(busy).toEqual([true, false]);
  });

  it("on a 5xx shows the translated generic text and does not claim anything was sent", async () => {
    const { run, calls } = setup(async () => {
      throw new ApiError("Boom", 500, null);
    });
    await run(body);
    expect(calls).toEqual(["toast:down:t:common.genericError"]);
  });

  it("stays quiet for an error something else already reports (rate limit, gates, sign-out)", async () => {
    for (const code of ["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]) {
      const { run, calls, busy } = setup(async () => {
        throw new ApiError("x", 429, code);
      });
      await run(body);
      expect(calls.filter((c) => c.startsWith("toast"))).toEqual([]);
      expect(busy).toEqual([true, false]);
    }
  });

  it("reconciles instead of guessing when the answer cannot be read", async () => {
    const { run, calls, busy } = setup(async () => ({ nope: true }));
    await run(body);
    expect(calls).toEqual(["money", "prefill", "toast:down:t:withdraw.unclear"]);
    expect(busy).toEqual([true, false]);
  });

  it("drops a result that arrives under a different session", async () => {
    let token = "s1";
    const { run, calls } = setup(
      async () => {
        token = "s2";
        return { id: "w-9", status: "REQUESTED" };
      },
      { session: () => token },
    );
    await run(body);
    expect(calls).toEqual([]);
  });
});

function setupCancel(post: CancelSubmitDeps["post"], over: Partial<CancelSubmitDeps> = {}) {
  const calls: string[] = [];
  const busy: Array<string | null> = [];
  const deps: CancelSubmitDeps = {
    post,
    invalidateMoney: () => calls.push("money"),
    invalidatePrefill: () => calls.push("prefill"),
    toast: (m, tone) => calls.push(`toast:${tone}:${m}`),
    session: () => "s1",
    setBusyId: (id) => busy.push(id),
    t,
    ...over,
  };
  return { run: createCancelSubmitter(deps), calls, busy };
}

describe("createCancelSubmitter", () => {
  it("posts the id, refreshes money and prefill and says it is cancelled", async () => {
    const post = vi.fn(async () => ({ withdrawal: {}, balance: null }));
    const { run, calls, busy } = setupCancel(post);
    await run("w-1");
    expect(post).toHaveBeenCalledWith("w-1");
    expect(calls).toEqual(["money", "prefill", "toast:up:t:withdraw.cancelled"]);
    expect(busy).toEqual(["w-1", null]);
  });

  it("ignores a second tap while one cancel is in flight", async () => {
    let finish: (v: unknown) => void = () => undefined;
    const post = vi.fn(() => new Promise<unknown>((resolve) => (finish = resolve)));
    const { run } = setupCancel(post);
    const first = run("w-1");
    await run("w-1");
    await run("w-2");
    expect(post).toHaveBeenCalledTimes(1);
    finish({});
    await first;
  });

  it("shows the server's message when the window has passed, and refreshes the prefill so the box goes", async () => {
    const { run, calls, busy } = setupCancel(async () => {
      throw new ApiError("The cancel window has passed.", 409, null);
    });
    await run("w-1");
    expect(calls).toEqual(["prefill", "toast:down:The cancel window has passed."]);
    expect(busy).toEqual(["w-1", null]);
  });

  it("on a timeout refetches, tells the user to check Payments and never retries", async () => {
    const post = vi.fn(async () => {
      throw new ApiError("The request timed out.", 0, "timeout");
    });
    const { run, calls } = setupCancel(post);
    await run("w-1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["money", "prefill", "toast:down:t:withdraw.timedOut"]);
  });

  it("drops a result that arrives under a different session", async () => {
    let token = "s1";
    const { run, calls } = setupCancel(
      async () => {
        token = "s2";
        return {};
      },
      { session: () => token },
    );
    await run("w-1");
    expect(calls).toEqual([]);
  });
});
