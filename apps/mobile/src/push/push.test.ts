import { beforeEach, describe, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ session: "session-a" as string | null, store: new Map<string, string | boolean>(), post: vi.fn(), permission: vi.fn(), token: vi.fn(), request: vi.fn() }));
vi.mock("expo-notifications", () => ({ setNotificationHandler: vi.fn(), getPermissionsAsync: env.permission, getDevicePushTokenAsync: env.token, requestPermissionsAsync: env.request, addPushTokenListener: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("react-native-mmkv", () => ({ createMMKV: () => ({ getString: (k: string) => env.store.get(k), getBoolean: (k: string) => env.store.get(k), set: (k: string, v: string | boolean) => env.store.set(k, v), remove: (k: string) => env.store.delete(k) }) }));
vi.mock("@/api/client", () => ({ api: env.post }));
vi.mock("@/auth/session-store", () => ({ useSession: { getState: () => ({ token: env.session }) } }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); env.store.clear(); env.session = "session-a";
  env.permission.mockResolvedValue({ status: "granted", canAskAgain: true });
  env.token.mockResolvedValue({ data: "fcm-token-for-test" }); env.post.mockResolvedValue(undefined);
});
describe("native push registration", () => {
  it("never requests permission just by loading or registering", async () => {
    const p = await import("./push"); await p.registerDevice();
    expect(env.request).not.toHaveBeenCalled();
    expect(env.post).toHaveBeenCalledWith("/api/v1/push/devices", expect.objectContaining({ token: "session-a", method: "POST" }));
  });
  it("does not register a native token acquired after the session departed", async () => {
    let release!: () => void;
    env.token.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: "fcm-old" }); }));
    const p = await import("./push"); const pending = p.registerDevice();
    await vi.waitFor(() => expect(env.token).toHaveBeenCalled()); env.session = "session-b"; release(); await pending;
    expect(env.post).not.toHaveBeenCalled();
  });
  it("removes a registration that finishes after sign-out using the departed bearer", async () => {
    let release!: () => void;
    env.post.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    const p = await import("./push"); const pending = p.registerDevice();
    await vi.waitFor(() => expect(env.post).toHaveBeenCalledTimes(1)); env.session = null; release(); await pending;
    expect(env.post).toHaveBeenLastCalledWith("/api/v1/push/devices", expect.objectContaining({ method: "DELETE", token: "session-a", body: { token: "fcm-token-for-test" } }));
  });
  it("a delayed old-user cleanup cannot remove the new user's registration", async () => {
    const p = await import("./push"); await p.registerDevice();
    env.session = "session-b"; await p.registerDevice(); env.post.mockClear();
    await p.unregisterDevice("session-a"); expect(env.post).not.toHaveBeenCalled();
    await p.unregisterDevice("session-b");
    expect(env.post).toHaveBeenCalledWith("/api/v1/push/devices", expect.objectContaining({ method: "DELETE", token: "session-b" }));
  });
});
