import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { CLAIM_TIMEOUT_MS, claimErrorText, createClaimSubmitter, type ClaimSubmitDeps } from "./claim-submit";

const t = (key: string) => `t:${key}`;
const UTR = "412345678901";

function setup(post: ClaimSubmitDeps["post"], over: Partial<ClaimSubmitDeps> = {}) {
  const calls: string[] = [];
  const busy: boolean[] = [];
  const errors: (string | null)[] = [];
  const deps: ClaimSubmitDeps = {
    post,
    invalidateMoney: () => calls.push("money"),
    refreshCheckout: () => calls.push("checkout"),
    leave: () => calls.push("leave"),
    setError: (e) => errors.push(e),
    toast: (m) => calls.push(`toast:${m}`),
    session: () => "s1",
    setBusy: (b) => busy.push(b),
    t,
    ...over,
  };
  return { run: createClaimSubmitter(deps), calls, busy, errors };
}

describe("claimErrorText", () => {
  it("translates offline, timeout and any 5xx", () => {
    expect(claimErrorText(new ApiError("No connection.", 0, "offline"), t)).toBe("t:common.noConnection");
    expect(claimErrorText(new ApiError("The request timed out.", 0, "timeout"), t)).toBe("t:claim.timedOut");
    expect(claimErrorText(new ApiError("boom", 500, null), t)).toBe("t:common.genericError");
  });
  it("shows another 4xx's own message verbatim, and the translated generic for a bare one", () => {
    expect(claimErrorText(new ApiError("A reference has already been submitted for this deposit.", 409, null), t)).toBe(
      "A reference has already been submitted for this deposit.",
    );
    expect(claimErrorText(new ApiError("Deposit not found.", 404, null), t)).toBe("Deposit not found.");
    expect(claimErrorText(new ApiError("Something went wrong.", 400, null), t)).toBe("t:common.genericError");
  });
  it("is the generic text for anything that is not an ApiError", () => {
    expect(claimErrorText(new Error("x"), t)).toBe("t:common.genericError");
  });
});

describe("createClaimSubmitter", () => {
  it("posts the UTR alone, once, with the money-POST timeout", async () => {
    expect(CLAIM_TIMEOUT_MS).toBe(15_000);
    const post = vi.fn(async () => ({ status: "PENDING_CONFIRMATION" }));
    const { run } = setup(post);
    await run(UTR);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ utr: UTR });
  });

  it("on success refreshes the money and checkout queries, then leaves, in that order", async () => {
    const { run, calls, errors } = setup(async () => ({ status: "PENDING_CONFIRMATION" }));
    await run(UTR);
    expect(calls).toEqual(["money", "checkout", "leave"]);
    expect(errors).toEqual([null]);
  });

  it("stays busy after a success: the screen is going away and a second tap must not send a second claim", async () => {
    const { run, busy } = setup(async () => ({}));
    await run(UTR);
    expect(busy).toEqual([true]);
  });

  it("sends nothing and shows the problem for a reference the server would refuse", async () => {
    const post = vi.fn();
    const { run, calls, errors, busy } = setup(post);
    await run("123");
    await run("");
    expect(post).not.toHaveBeenCalled();
    expect(errors).toEqual(["t:claim.format", "t:claim.required"]);
    expect(calls).toEqual([]);
    expect(busy).toEqual([]);
  });

  it("cleans a pasted reference before sending it", async () => {
    const post = vi.fn(async () => ({}));
    const { run } = setup(post);
    await run("4123 4567 8901");
    expect(post).toHaveBeenCalledWith({ utr: UTR });
  });

  it("takes a 409 'resolved' as good news: the matcher got there first, so it refreshes and leaves without an error", async () => {
    const { run, calls, errors } = setup(async () => {
      throw new ApiError("This deposit has already been resolved.", 409, null, true);
    });
    await run(UTR);
    expect(calls).toEqual(["money", "checkout", "leave"]);
    expect(errors).toEqual([null]);
  });

  it("shows another 4xx where the form is, refreshes the checkout (a claim may already exist) and stays open", async () => {
    const { run, calls, errors, busy } = setup(async () => {
      throw new ApiError("A reference has already been submitted for this deposit.", 409, null);
    });
    await run(UTR);
    expect(errors).toEqual([null, "A reference has already been submitted for this deposit."]);
    expect(calls).toEqual(["checkout"]);
    expect(busy).toEqual([true, false]);
  });

  it("on a timeout refetches and tells the user to check, never retries, and lets them try again by hand", async () => {
    const post = vi.fn(async () => {
      throw new ApiError("The request timed out.", 0, "timeout");
    });
    const { run, calls, busy } = setup(post);
    await run(UTR);
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["money", "checkout", "toast:t:claim.timedOut"]);
    expect(busy).toEqual([true, false]);
  });

  it("on a dropped connection also refetches (the request may have arrived) and toasts the translated text", async () => {
    const { run, calls } = setup(async () => {
      throw new ApiError("No connection.", 0, "offline");
    });
    await run(UTR);
    expect(calls).toEqual(["money", "checkout", "toast:t:common.noConnection"]);
  });

  it("shows a 5xx as translated text on the form, not the server's English", async () => {
    const { run, errors } = setup(async () => {
      throw new ApiError("Internal", 500, null);
    });
    await run(UTR);
    expect(errors).toEqual([null, "t:common.genericError"]);
  });

  it("leaves what another layer already reports to that layer (a rate-limit toast, a gate screen, sign-out)", async () => {
    for (const code of ["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]) {
      const { run, calls, errors, busy } = setup(async () => {
        throw new ApiError("x", code === "rate_limited" ? 429 : 503, code);
      });
      await run(UTR);
      expect(calls).toEqual([]);
      expect(errors).toEqual([null]);
      expect(busy).toEqual([true, false]);
    }
  });

  it("ignores a tap while a claim is in flight (two taps in one frame make one request)", async () => {
    let release: (v: unknown) => void = () => {};
    const post = vi.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const { run } = setup(post);
    const first = run(UTR);
    const second = run(UTR);
    release({});
    await Promise.all([first, second]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("allows a new attempt once a failed one has finished", async () => {
    const post = vi.fn().mockRejectedValueOnce(new ApiError("Deposit not found.", 404, null)).mockResolvedValueOnce({});
    const { run } = setup(post);
    await run(UTR);
    await run(UTR);
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
    await run(UTR);
    expect(calls).toEqual([]);
    expect(errors).toEqual([null]);
  });
});
