import { beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const lock = vi.hoisted(() => ({ method: null as "pin" | "biometric" | null }));

vi.mock("expo-router", () => ({ router: { replace } }));
vi.mock("./session-store", () => ({ useSession: { getState: () => ({ signIn }) } }));
vi.mock("@/lock/lock-store", () => ({ useLock: { getState: () => lock } }));

import { finishSignIn } from "./finish-sign-in";

beforeEach(() => {
  vi.clearAllMocks();
  signIn.mockResolvedValue(undefined);
  lock.method = null;
});

describe("finishSignIn", () => {
  it("stores the token and offers lock setup when the device has no lock", async () => {
    await finishSignIn("tok");
    expect(signIn).toHaveBeenCalledWith("tok");
    expect(replace).toHaveBeenCalledWith("/lock-setup");
  });

  it("skips lock setup when a lock method is already stored", async () => {
    lock.method = "pin";
    await finishSignIn("tok");
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("does not navigate if storing the token fails", async () => {
    signIn.mockRejectedValue(new Error("keystore"));
    await expect(finishSignIn("tok")).rejects.toThrow();
    expect(replace).not.toHaveBeenCalled();
  });
});
