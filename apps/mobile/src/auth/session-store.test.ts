import { beforeEach, describe, expect, it, vi } from "vitest";

const secure = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
const apiMock = vi.hoisted(() => ({ api: vi.fn(), configureApi: vi.fn() }));
const clear = vi.hoisted(() => vi.fn());
const resetSocket = vi.hoisted(() => vi.fn());
const clearResume = vi.hoisted(() => vi.fn());
const clearToasts = vi.hoisted(() => vi.fn());
const clearPending = vi.hoisted(() => vi.fn());
const signOutOfGoogle = vi.hoisted(() => vi.fn());

vi.mock("expo-secure-store", () => ({ ...secure, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));
vi.mock("@/api/client", () => apiMock);
vi.mock("@/api/queries", () => ({ queryClient: { clear } }));
vi.mock("@/cache/resume-cache", () => ({ clearResume }));
vi.mock("@/payments/pending-checkout", () => ({ clearAllPendingCheckouts: clearPending }));
vi.mock("@/ui/Toast", () => ({ toast: vi.fn(), clearToasts }));
vi.mock("./google", () => ({ signOutOfGoogle }));
vi.mock("@/socket/socket-store", () => ({ useSocket: { getState: () => ({ reset: resetSocket }) } }));

import { useListLoaded } from "@/trade/list-loaded-store";
import { useSession } from "./session-store";

beforeEach(() => {
  vi.clearAllMocks();
  secure.getItemAsync.mockResolvedValue(null);
  secure.setItemAsync.mockResolvedValue(undefined);
  secure.deleteItemAsync.mockResolvedValue(undefined);
  apiMock.api.mockResolvedValue(null);
  useSession.setState({ token: null, ready: false });
});

describe("useSession", () => {
  it("hydrates the stored token and marks ready", async () => {
    secure.getItemAsync.mockResolvedValue("tok");
    await useSession.getState().hydrate();
    expect(useSession.getState()).toMatchObject({ token: "tok", ready: true });
  });

  it("still becomes ready when the keystore read fails", async () => {
    secure.getItemAsync.mockRejectedValue(new Error("keystore"));
    await useSession.getState().hydrate();
    expect(useSession.getState()).toMatchObject({ token: null, ready: true });
  });

  it("drops the resume cache when the keystore cannot be read (a session nobody can read has no cache worth keeping)", async () => {
    secure.getItemAsync.mockRejectedValue(new Error("keystore"));
    await useSession.getState().hydrate();
    expect(clearResume).toHaveBeenCalledTimes(1);
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  it("keeps the resume cache when the keystore is readable but empty", async () => {
    secure.getItemAsync.mockResolvedValue(null);
    await useSession.getState().hydrate();
    expect(clearResume).not.toHaveBeenCalled();
    expect(clearPending).not.toHaveBeenCalled();
  });

  it("clears the in-memory token even when a cleanup step throws (a live token must not outlive a sign-out)", async () => {
    useSession.setState({ token: "tok", ready: true });
    clear.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(useSession.getState().signOut()).rejects.toThrow("boom");
    expect(useSession.getState().token).toBeNull();
  });

  it("signs out remotely once even when several calls overlap", async () => {
    useSession.setState({ token: "tok", ready: true });
    await Promise.all([
      useSession.getState().signOut(),
      useSession.getState().signOut({ remote: false }),
      useSession.getState().signOut(),
    ]);
    expect(apiMock.api).toHaveBeenCalledTimes(1);
    expect(apiMock.api).toHaveBeenCalledWith("/api/auth/logout", { method: "POST", token: "tok" });
    expect(secure.deleteItemAsync).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(resetSocket).toHaveBeenCalledTimes(1);
    expect(clearResume).toHaveBeenCalledTimes(1);
    expect(clearToasts).toHaveBeenCalledTimes(1);
    expect(signOutOfGoogle).toHaveBeenCalledTimes(1);
    expect(useSession.getState().token).toBeNull();
  });

  it("forgets which account's trade list was loaded", async () => {
    useSession.setState({ token: "tok", ready: true });
    useListLoaded.getState().set("acct-1");
    await useSession.getState().signOut({ remote: false });
    expect(useListLoaded.getState().loadedFor).toBeNull();
  });

  it("forgets the payment in progress, so the next person on this phone is not offered it", async () => {
    useSession.setState({ token: "tok", ready: true });
    await useSession.getState().signOut({ remote: false });
    expect(clearPending).toHaveBeenCalledTimes(1);
  });

  it("still ends the session when forgetting the payment in progress throws", async () => {
    useSession.setState({ token: "tok", ready: true });
    clearPending.mockImplementationOnce(() => {
      throw new Error("storage");
    });
    await expect(useSession.getState().signOut({ remote: false })).rejects.toThrow("storage");
    expect(useSession.getState().token).toBeNull();
  });

  it("does nothing when already signed out", async () => {
    await useSession.getState().signOut();
    expect(apiMock.api).not.toHaveBeenCalled();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("clears the session even if the remote logout fails", async () => {
    useSession.setState({ token: "tok", ready: true });
    apiMock.api.mockRejectedValue(new Error("offline"));
    await useSession.getState().signOut();
    expect(useSession.getState().token).toBeNull();
  });

  it("clears local state before the remote logout and does not wait for it", async () => {
    useSession.setState({ token: "tok", ready: true });
    let tokenAtRemoteCall: string | null | undefined;
    apiMock.api.mockImplementation(() => {
      tokenAtRemoteCall = useSession.getState().token;
      return new Promise(() => {}); // a stalled network: never settles
    });
    await useSession.getState().signOut();
    expect(tokenAtRemoteCall).toBeNull();
    expect(secure.deleteItemAsync).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(useSession.getState().token).toBeNull();
  });

  it("skips the remote logout when asked", async () => {
    useSession.setState({ token: "tok", ready: true });
    await useSession.getState().signOut({ remote: false });
    expect(apiMock.api).not.toHaveBeenCalled();
    expect(useSession.getState().token).toBeNull();
  });

  it("can sign out again after signing back in", async () => {
    useSession.setState({ token: "a", ready: true });
    await useSession.getState().signOut({ remote: false });
    await useSession.getState().signIn("b");
    await useSession.getState().signOut({ remote: false });
    expect(secure.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(useSession.getState().token).toBeNull();
  });
});
