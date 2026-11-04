import { describe, expect, it } from "vitest";
import config, { assertSecureUrls } from "../app.config";

const secure = { apiUrl: "https://indianxtrade.com", wsUrl: "wss://indianxtrade.com/ws" };

describe("assertSecureUrls", () => {
  it("accepts https and wss in a production build", () => {
    expect(() => assertSecureUrls({ ...secure, production: true })).not.toThrow();
  });

  it("refuses an http API URL in a production build", () => {
    expect(() => assertSecureUrls({ ...secure, apiUrl: "http://indianxtrade.com", production: true })).toThrow(/APP_API_URL/);
  });

  it("refuses a ws WebSocket URL in a production build", () => {
    expect(() => assertSecureUrls({ ...secure, wsUrl: "ws://indianxtrade.com/ws", production: true })).toThrow(/APP_WS_URL/);
  });

  it("refuses a URL that is not a URL at all", () => {
    expect(() => assertSecureUrls({ ...secure, apiUrl: "indianxtrade.com", production: true })).toThrow(/APP_API_URL/);
  });

  it("refuses a bare scheme with no host", () => {
    expect(() => assertSecureUrls({ ...secure, apiUrl: "https://", production: true })).toThrow(/APP_API_URL/);
    expect(() => assertSecureUrls({ ...secure, wsUrl: "wss://", production: true })).toThrow(/APP_WS_URL/);
  });

  it("allows cleartext localhost URLs for a development build (Metro, dev client)", () => {
    expect(() => assertSecureUrls({ apiUrl: "http://localhost:3200", wsUrl: "ws://localhost:4001/ws", production: false })).not.toThrow();
  });
});

describe("android permissions", () => {
  it("blocks the template defaults the app never uses (overlay and storage), so the release manifest is minimal", () => {
    const blocked = config.android?.blockedPermissions ?? [];
    for (const p of ["SYSTEM_ALERT_WINDOW", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE"]) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
  });

  it("never both requests and blocks a permission", () => {
    const blocked = new Set(config.android?.blockedPermissions ?? []);
    for (const p of config.android?.permissions ?? []) expect(blocked.has(p)).toBe(false);
  });
});

describe("KYC camera permissions", () => {
  const pluginOptions = (name: string): Record<string, unknown> => {
    const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === name);
    return (Array.isArray(entry) ? entry[1] : {}) as Record<string, unknown>;
  };

  it("requests CAMERA and blocks RECORD_AUDIO (a stills-only app never records audio)", () => {
    expect(config.android?.permissions).toContain("android.permission.CAMERA");
    expect(config.android?.blockedPermissions).toContain("android.permission.RECORD_AUDIO");
  });

  it("turns off the camera plugin's audio permission and the picker's microphone permission", () => {
    expect(pluginOptions("expo-camera").recordAudioAndroid).toBe(false);
    expect(pluginOptions("expo-image-picker").microphonePermission).toBe(false);
  });

  it("does not let the image picker block CAMERA: `cameraPermission: false` adds tools:node=remove and strips it from the manifest", () => {
    expect(pluginOptions("expo-image-picker").cameraPermission).not.toBe(false);
  });
});
