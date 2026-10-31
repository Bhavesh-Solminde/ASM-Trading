import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  appIdHash,
  buildAuthorizeUrl,
  exchangeAuthCode,
  nextFyersExpiry,
} from "./fyers-oauth";

const ENV = {
  appId: "FQEO03EUPG-100",
  appSecret: "ILZY6ULDVX",
  redirectUri: "https://indianxtrade.com/api/integrations/fyers/callback",
};

describe("buildAuthorizeUrl", () => {
  it("builds the FYERS v3 generate-authcode URL with the four required params", () => {
    const url = new URL(buildAuthorizeUrl(ENV, "state123"));
    expect(url.origin + url.pathname).toBe("https://api-t1.fyers.in/api/v3/generate-authcode");
    expect(url.searchParams.get("client_id")).toBe(ENV.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(ENV.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state123");
  });

  it("url-encodes the redirect URI exactly once", () => {
    const url = buildAuthorizeUrl(ENV, "s");
    // Must contain the colon from https:// encoded, not double-encoded.
    expect(url).toContain("redirect_uri=https%3A%2F%2Findianxtrade.com%2Fapi%2Fintegrations%2Ffyers%2Fcallback");
  });
});

describe("appIdHash", () => {
  it("is SHA-256 hex of `APP_ID:APP_SECRET` — this is the FYERS v3 contract", () => {
    const expected = createHash("sha256").update("FQEO03EUPG-100:ILZY6ULDVX").digest("hex");
    expect(appIdHash(ENV)).toBe(expected);
    expect(appIdHash(ENV)).toHaveLength(64); // SHA-256 hex is always 64 chars
  });
});

describe("exchangeAuthCode", () => {
  it("POSTs grant_type + appIdHash + code to validate-authcode and returns the parsed body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ s: "ok", code: 200, access_token: "AT_XYZ", refresh_token: "RT_ABC" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const res = await exchangeAuthCode(ENV, "AUTH_CODE_123", fetchMock);

    expect(res).toEqual({ s: "ok", code: 200, access_token: "AT_XYZ", refresh_token: "RT_ABC" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      grant_type: "authorization_code",
      appIdHash: appIdHash(ENV),
      code: "AUTH_CODE_123",
    });
  });

  it("surfaces an error response verbatim so the caller can route by `s`", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ s: "error", code: -16, message: "Invalid Auth Code" }),
      { status: 200 },
    ));

    const res = await exchangeAuthCode(ENV, "BAD", fetchMock);
    expect(res.s).toBe("error");
    expect(res.message).toBe("Invalid Auth Code");
    expect(res.access_token).toBeUndefined();
  });
});

describe("nextFyersExpiry", () => {
  it("rolls to today's 00:30 UTC (06:00 IST) when `now` is just before it", () => {
    const now = new Date(Date.UTC(2026, 9, 24, 0, 15, 0)); // 2026-10-24 00:15 UTC
    const expiry = nextFyersExpiry(now);
    expect(expiry.toISOString()).toBe("2026-10-24T00:30:00.000Z");
  });

  it("rolls to tomorrow's 00:30 UTC when `now` is already past today's cutoff", () => {
    const now = new Date(Date.UTC(2026, 9, 24, 12, 0, 0)); // 2026-10-24 12:00 UTC
    const expiry = nextFyersExpiry(now);
    expect(expiry.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("treats the cutoff instant itself as expired — the next expiry is tomorrow", () => {
    const now = new Date(Date.UTC(2026, 9, 24, 0, 30, 0));
    expect(nextFyersExpiry(now).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});
