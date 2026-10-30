import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/errors";
import { DEMO_RESET_TIMEOUT_MS, createDemoResetSubmitter, demoResetErrorText, type DemoResetDeps } from "./demo-reset";

const t = (key: string) => `t:${key}`;

function setup(post: DemoResetDeps["post"], over: Partial<DemoResetDeps> = {}) {
  const calls: string[] = [];
  const busy: boolean[] = [];
  const deps: DemoResetDeps = {
    post,
    refresh: () => calls.push("refresh"),
    toast: (m, tone) => calls.push(`toast:${tone}:${m}`),
    session: () => "s1",
    setBusy: (b) => busy.push(b),
    t,
    ...over,
  };
  return { run: createDemoResetSubmitter(deps), calls, busy };
}

describe("demoResetErrorText", () => {
  it("translates offline and timeout (the reset may have landed: look before trying again), 5xx and a bare error", () => {
    expect(demoResetErrorText(new ApiError("No connection.", 0, "offline"), t)).toBe("t:account.demoResetTimedOut");
    expect(demoResetErrorText(new ApiError("The request timed out.", 0, "timeout"), t)).toBe("t:account.demoResetTimedOut");
    expect(demoResetErrorText(new ApiError("Boom", 500, null), t)).toBe("t:common.genericError");
    expect(demoResetErrorText(new ApiError("Something went wrong.", 409, null), t)).toBe("t:common.genericError");
  });
  it("shows another 4xx's own message", () => {
    expect(demoResetErrorText(new ApiError("Only a demo account can be reset.", 409, null), t)).toBe("Only a demo account can be reset.");
  });
  it("is generic for anything that is not an ApiError", () => {
    expect(demoResetErrorText(new Error("x"), t)).toBe("t:common.genericError");
  });
});

describe("createDemoResetSubmitter", () => {
  it("has a 15 second timeout", () => {
    expect(DEMO_RESET_TIMEOUT_MS).toBe(15_000);
  });

  it("posts the demo account id once, then refreshes the balances and toasts", async () => {
    const post = vi.fn(async () => undefined);
    const { run, calls, busy } = setup(post);
    await run("demo-1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("demo-1");
    expect(calls).toEqual(["refresh", "toast:up:t:account.demoResetDone"]);
    expect(busy).toEqual([true, false]);
  });

  it("ignores a second tap while the first is in flight, and never retries", async () => {
    let release: () => void = () => undefined;
    const post = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { run } = setup(post);
    const first = run("demo-1");
    await run("demo-1");
    release();
    await first;
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("allows another reset once the first has ended", async () => {
    const post = vi.fn(async () => undefined);
    const { run } = setup(post);
    await run("demo-1");
    await run("demo-1");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("after a timeout refreshes (the reset may have landed), says to check, and does not retry", async () => {
    const post = vi.fn(async () => {
      throw new ApiError("The request timed out.", 0, "timeout");
    });
    const { run, calls, busy } = setup(post);
    await run("demo-1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["refresh", "toast:down:t:account.demoResetTimedOut"]);
    expect(busy).toEqual([true, false]);
  });

  it("shows a refusal's message and does not claim success", async () => {
    const { run, calls } = setup(async () => {
      throw new ApiError("Only a demo account can be reset.", 409, null);
    });
    await run("live-1");
    expect(calls).toEqual(["toast:down:Only a demo account can be reset."]);
  });

  it("stays quiet when the api layer already reports it (rate limit, gate, sign-out)", async () => {
    for (const code of ["rate_limited", "maintenance", "blocked", "upgrade", "unauthenticated"]) {
      const { run, calls } = setup(async () => {
        throw new ApiError("x", 429, code);
      });
      await run("demo-1");
      expect(calls).toEqual([]);
    }
  });

  it("drops the result when the session changed while the request was in flight", async () => {
    let token = "s1";
    const { run, calls } = setup(
      async () => {
        token = "s2";
      },
      { session: () => token },
    );
    await run("demo-1");
    expect(calls).toEqual([]);
  });
});
