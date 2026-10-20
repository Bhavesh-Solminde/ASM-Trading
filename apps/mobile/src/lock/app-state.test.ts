import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digestStringAsync: async () => "", randomUUID: () => "id" }));
vi.mock("expo-local-authentication", () => ({ hasHardwareAsync: async () => true, isEnrolledAsync: async () => true, authenticateAsync: async () => ({ success: true }) }));
vi.mock("i18next", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/auth/session-store", () => ({ useSession: { getState: () => ({ signOut: async () => {} }) } }));

import { onAppStateChange, useAppStatus } from "./app-state";
import { LOCK_AFTER_MS } from "./rules";
import { useLock } from "./lock-store";

const NOW = 1_000_000_000;

beforeEach(() => {
  useLock.setState({ enabled: true, method: "pin", locked: false, loaded: true, backgroundedAt: null });
  useAppStatus.setState({ appState: "active" });
});

describe("onAppStateChange", () => {
  it("marks the app away on background and stamps the lock timer", () => {
    onAppStateChange("background", NOW);
    expect(useAppStatus.getState().appState).toBe("background");
    expect(useLock.getState().backgroundedAt).toBe(NOW);
  });

  it("marks the app away BEFORE anything else reacts, so the cover can be up for the snapshot", () => {
    const seen: string[] = [];
    const un = useLock.subscribe((s) => seen.push(`lock:${s.backgroundedAt}:${useAppStatus.getState().appState}`));
    onAppStateChange("background", NOW);
    un();
    expect(seen).toEqual([`lock:${NOW}:background`]);
  });

  it("decides the relock BEFORE it reports the app active, so no render sees active + unlocked + stale", () => {
    onAppStateChange("background", NOW);
    const frames: string[] = [];
    // Every store change a render could observe: the pair (appState, locked) must never be (active, false) after a long absence.
    const a = useAppStatus.subscribe((s) => frames.push(`${s.appState}:${useLock.getState().locked}`));
    const l = useLock.subscribe((s) => frames.push(`${useAppStatus.getState().appState}:${s.locked}`));
    onAppStateChange("active", NOW + LOCK_AFTER_MS);
    a();
    l();
    expect(frames).not.toContain("active:false");
    expect(frames).toContain("active:true");
    expect(useLock.getState().locked).toBe(true);
  });

  it("returns active without relocking after a short trip away", () => {
    onAppStateChange("background", NOW);
    onAppStateChange("active", NOW + 60_000);
    expect(useAppStatus.getState().appState).toBe("active");
    expect(useLock.getState().locked).toBe(false);
  });

  it("treats inactive as away without starting the relock timer", () => {
    onAppStateChange("inactive", NOW);
    expect(useAppStatus.getState().appState).toBe("inactive");
    expect(useLock.getState().backgroundedAt).toBeNull();
  });
});
