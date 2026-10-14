import { beforeEach, describe, expect, it, vi } from "vitest";

const secure = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
const apiMock = vi.hoisted(() => ({ api: vi.fn(), configureApi: vi.fn() }));
const clear = vi.hoisted(() => vi.fn());
const resetSocket = vi.hoisted(() => vi.fn());

vi.mock("expo-secure-store", () => ({ ...secure, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));
vi.mock("@/api/client", () => apiMock);
vi.mock("@/api/queries", () => ({ queryClient: { clear } }));
vi.mock("@/ui/Toast", () => ({ toast: vi.fn() }));
vi.mock("@/socket/socket-store", () => ({ useSocket: { getState: () => ({ reset: resetSocket }) } }));

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
