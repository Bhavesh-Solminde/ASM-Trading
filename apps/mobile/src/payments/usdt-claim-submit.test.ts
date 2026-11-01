import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { createUsdtClaimSubmitter, type UsdtClaimSubmitDeps } from "./usdt-claim-submit";

const t = (key: string) => `t:${key}`;
const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

function setup(post: UsdtClaimSubmitDeps["post"], over: Partial<UsdtClaimSubmitDeps> = {}) {
  const calls: string[] = [];
  const busy: boolean[] = [];
  const errors: (string | null)[] = [];
  const deps: UsdtClaimSubmitDeps = {
    post,
    refreshCheckout: () => calls.push("checkout"),
    leave: () => calls.push("leave"),
    setError: (e) => errors.push(e),
    toast: (m, tone) => calls.push(`toast:${tone}:${m}`),
    session: () => "s1",
    setBusy: (b) => busy.push(b),
    network: () => "tron",
    t,
    ...over,
  };
  return { run: createUsdtClaimSubmitter(deps), calls, busy, errors };
}

describe("createUsdtClaimSubmitter", () => {
  it("posts the normalized hash alone, once", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const { run } = setup(post);
    await run(`0x${HASH.toUpperCase()}`);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ txHash: HASH });
  });

  it("on success refreshes the checkout (it now carries the hash), says so, then leaves, in that order", async () => {
    const { run, calls, errors } = setup(async () => ({ ok: true }));
    await run(HASH);
    expect(calls).toEqual(["checkout", "toast:up:t:usdtClaim.sent", "leave"]);
    expect(errors).toEqual([null]);
  });

  it("stays busy after a success: the screen is going away and a second tap must not send a second claim", async () => {
    const { run, busy } = setup(async () => ({}));
    await run(HASH);
    expect(busy).toEqual([true]);
  });

  it("sends nothing and shows the problem, in the network's own words, for a hash the server would refuse", async () => {
    const post = vi.fn();
    const tron = setup(post);
    await tron.run("123");
    await tron.run("   ");
    const bsc = setup(post, { network: () => "bsc" });
    await bsc.run("123");
    expect(post).not.toHaveBeenCalled();
    expect(tron.errors).toEqual(["t:usdtClaim.formatTron", "t:usdtClaim.required"]);
    expect(bsc.errors).toEqual(["t:usdtClaim.formatBsc"]);
    expect(tron.calls).toEqual([]);
    expect(tron.busy).toEqual([]);
  });

  it("shows a 409 as the server's own message where the form is, refreshes the checkout, and stays open", async () => {
    const { run, calls, errors, busy } = setup(async () => {
      throw new ApiError("This deposit has already been resolved.", 409, null);
    });
    await run(HASH);
    expect(errors).toEqual([null, "This deposit has already been resolved."]);
    expect(calls).toEqual(["checkout"]);
    expect(busy).toEqual([true, false]);
  });

  it("shows a 409 as the server's message even when the server marks it resolved (no silent leave)", async () => {
    const { run, calls, errors } = setup(async () => {
      throw new ApiError("This deposit has already been resolved.", 409, null, true);
    });
    await run(HASH);
    expect(errors).toEqual([null, "This deposit has already been resolved."]);
    expect(calls).toEqual(["checkout"]);
  });

  it("shows another 4xx's message verbatim, and the translated generic for a bare one", async () => {
    const a = setup(async () => {
      throw new ApiError("Deposit not found.", 404, null);
    });
    await a.run(HASH);
    expect(a.errors).toEqual([null, "Deposit not found."]);
    const b = setup(async () => {
      throw new ApiError("Something went wrong.", 400, null);
    });
    await b.run(HASH);
    expect(b.errors).toEqual([null, "t:common.genericError"]);
  });

  it("shows a 5xx as translated text on the form, not the server's English", async () => {
    const { run, errors } = setup(async () => {
      throw new ApiError("Internal", 500, null);
    });
    await run(HASH);
    expect(errors).toEqual([null, "t:common.genericError"]);
  });

  it("on a timeout refetches and tells the user to check, never retries, and lets them try again by hand", async () => {
    const post = vi.fn(async () => {
      throw new ApiError("The request timed out.", 0, "timeout");
    });
    const { run, calls, busy } = setup(post);
    await run(HASH);
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["checkout", "toast:down:t:claim.timedOut"]);
    expect(busy).toEqual([true, false]);
  });

  it("on a dropped connection also refetches (the request may have arrived) and toasts the translated text", async () => {
    const { run, calls } = setup(async () => {
      throw new ApiError("No connection.", 0, "offline");
    });
    await run(HASH);
    expect(calls).toEqual(["checkout", "toast:down:t:common.noConnection"]);
  });

  it("leaves what another layer already reports to that layer (a rate-limit toast, a gate screen, sign-out)", async () => {
    for (const code of ["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]) {
      const { run, calls, errors, busy } = setup(async () => {
        throw new ApiError("x", code === "rate_limited" ? 429 : 503, code);
      });
      await run(HASH);
      expect(calls).toEqual([]);
      expect(errors).toEqual([null]);
      expect(busy).toEqual([true, false]);
    }
  });

  it("ignores a tap while a claim is in flight (two taps in one frame make one request)", async () => {
    let release: (v: unknown) => void = () => {};
    const post = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const { run } = setup(post);
    const first = run(HASH);
    const second = run(HASH);
    release({});
    await Promise.all([first, second]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("allows a new attempt once a failed one has finished", async () => {
    const post = vi.fn().mockRejectedValueOnce(new ApiError("Deposit not found.", 404, null)).mockResolvedValueOnce({});
    const { run } = setup(post);
    await run(HASH);
    await run(HASH);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("drops a result that lands after the session changed, touching nothing", async () => {
    let current = "s1";
    const { run, calls, errors } = setup(
      async () => {
        current = "s2";
        return {};
      },
      { session: () => current },
    );
    await run(HASH);
    expect(calls).toEqual([]);
    expect(errors).toEqual([null]);
  });
});
