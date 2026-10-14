import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const signIn = vi.hoisted(() => vi.fn());
const startFreshSession = vi.hoisted(() => vi.fn());

vi.mock("./session-store", () => ({ useSession: { getState: () => ({ signIn }) } }));
vi.mock("@/lock/lock-store", () => ({ useLock: { getState: () => ({ startFreshSession }) } }));

import { finishSignIn } from "./finish-sign-in";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  startFreshSession.mockImplementation(async () => {
    await Promise.resolve();
    calls.push("fresh");
  });
  signIn.mockImplementation(() => {
    calls.push("signIn");
    return Promise.resolve();
  });
});

describe("finishSignIn", () => {
  it("binds the lock to the user and clears the cold-start lock before the session appears", async () => {
    await finishSignIn("tok", "user-1");
    expect(startFreshSession).toHaveBeenCalledWith("user-1");
    expect(signIn).toHaveBeenCalledWith("tok");
    expect(calls).toEqual(["fresh", "signIn"]);
  });

  it("rejects when storing the token fails", async () => {
    signIn.mockRejectedValue(new Error("keystore"));
    await expect(finishSignIn("tok", "user-1")).rejects.toThrow();
  });
});
