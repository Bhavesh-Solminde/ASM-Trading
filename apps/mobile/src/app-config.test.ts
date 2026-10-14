import { describe, expect, it } from "vitest";
import { assertSecureUrls } from "../app.config";

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

  it("allows cleartext localhost URLs for a development build (Metro, dev client)", () => {
    expect(() => assertSecureUrls({ apiUrl: "http://localhost:3200", wsUrl: "ws://localhost:4001/ws", production: false })).not.toThrow();
  });
});
