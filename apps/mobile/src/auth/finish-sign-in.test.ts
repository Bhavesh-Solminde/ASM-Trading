import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const signIn = vi.hoisted(() => vi.fn());
const startFreshSession = vi.hoisted(() => vi.fn());
const clearResume = vi.hoisted(() => vi.fn());
const loadLastUserId = vi.hoisted(() => vi.fn());

vi.mock("./session-store", () => ({ useSession: { getState: () => ({ signIn }) } }));
vi.mock("@/lock/lock-store", () => ({ useLock: { getState: () => ({ startFreshSession }) } }));

vi.mock("@/cache/resume-cache", () => ({ clearResume, loadLastUserId }));

import { finishSignIn } from "./finish-sign-in";

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  loadLastUserId.mockReturnValue(null);
  clearResume.mockImplementation(() => calls.push("clearResume"));
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

  it("wipes another user's cached snapshot before the new session appears (keystore read failed on cold start)", async () => {
    loadLastUserId.mockReturnValue("user-A");
    await finishSignIn("tok", "user-B");
    expect(clearResume).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["clearResume", "fresh", "signIn"]);
  });

  it("keeps the cache when the same user signs in again", async () => {
    loadLastUserId.mockReturnValue("user-1");
    await finishSignIn("tok", "user-1");
    expect(clearResume).not.toHaveBeenCalled();
  });

  it("keeps nothing to wipe when no user was remembered", async () => {
    await finishSignIn("tok", "user-1");
    expect(clearResume).not.toHaveBeenCalled();
  });
});
