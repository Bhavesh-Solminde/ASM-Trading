import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GoogleSignInError } from "./google-oauth";
import { googleNativeAudiences, verifyNativeIdToken } from "./google-native";

const AUD = "android-client.apps.googleusercontent.com";
type Sign = (claims: Record<string, unknown>) => Promise<string>;
let sign: Sign;
let otherKeySign: Sign;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
  sign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(privateKey);
  const other = await generateKeyPair("RS256");
  otherKeySign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(other.privateKey);
});

const base = () => ({
  iss: "https://accounts.google.com",
  aud: AUD,
  sub: "1234567890",
  email: "Asha@Example.com",
  email_verified: true,
  given_name: "Asha",
  exp: Math.floor(Date.now() / 1000) + 600,
  iat: Math.floor(Date.now() / 1000),
});

describe("verifyNativeIdToken", () => {
  it("returns the normalised profile for a valid token", async () => {
    expect(await verifyNativeIdToken(await sign(base()), { audiences: [AUD], jwks })).toEqual({
      sub: "1234567890",
      email: "asha@example.com",
      givenName: "Asha",
      familyName: null,
    });
  });
  it("rejects a token signed by another key", async () => {
    await expect(verifyNativeIdToken(await otherKeySign(base()), { audiences: [AUD], jwks })).rejects.toBeInstanceOf(GoogleSignInError);
  });
  it("rejects a token issued for another app", async () => {
    await expect(verifyNativeIdToken(await sign({ ...base(), aud: "someone-else" }), { audiences: [AUD], jwks })).rejects.toBeInstanceOf(GoogleSignInError);
  });
  it("rejects an unverified email", async () => {
    await expect(verifyNativeIdToken(await sign({ ...base(), email_verified: false }), { audiences: [AUD], jwks })).rejects.toBeInstanceOf(GoogleSignInError);
  });
  it("rejects an expired token", async () => {
    const expired = { ...base(), exp: Math.floor(Date.now() / 1000) - 60 };
    await expect(verifyNativeIdToken(await sign(expired), { audiences: [AUD], jwks })).rejects.toBeInstanceOf(GoogleSignInError);
  });
});

describe("verifyNativeIdToken authorized party", () => {
  const WEB = "web-client.apps.googleusercontent.com";
  const opts = () => ({ audiences: [AUD, WEB], webClientId: WEB, androidClientIds: [AUD], jwks });
  it("accepts a web-audience token issued to an Android client", async () => {
    const t = await sign({ ...base(), aud: WEB, azp: AUD });
    expect((await verifyNativeIdToken(t, opts())).sub).toBe("1234567890");
  });
  it("rejects a web-audience token issued to the web client (browser sign-in)", async () => {
    const t = await sign({ ...base(), aud: WEB, azp: WEB });
    await expect(verifyNativeIdToken(t, opts())).rejects.toThrow("unexpected authorized party");
  });
  it("rejects a web-audience token with no azp", async () => {
    const t = await sign({ ...base(), aud: WEB });
    await expect(verifyNativeIdToken(t, opts())).rejects.toBeInstanceOf(GoogleSignInError);
  });
  it("does not require azp for an Android-audience token", async () => {
    expect((await verifyNativeIdToken(await sign(base()), opts())).sub).toBe("1234567890");
  });
});

describe("googleNativeAudiences", () => {
  it("accepts the Android client ids plus the web client id", () => {
    expect(googleNativeAudiences({ GOOGLE_ANDROID_CLIENT_IDS: " a , b ", GOOGLE_CLIENT_ID: "web" })).toEqual(["a", "b", "web"]);
  });
  it("is empty when nothing is configured", () => {
    expect(googleNativeAudiences({})).toEqual([]);
  });
});
