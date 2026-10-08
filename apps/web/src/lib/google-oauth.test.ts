import { describe, expect, it } from "vitest";
import { GoogleSignInError, parseIdToken } from "./google-oauth";

const CLIENT = "client-123.apps.googleusercontent.com";
const NOW = 1_800_000_000_000;

function token(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
}

const VALID = {
  iss: "https://accounts.google.com",
  aud: CLIENT,
  exp: NOW / 1000 + 300,
  sub: "1234567890",
  email: "Asha.Rao@Gmail.com",
  email_verified: true,
  given_name: "Asha",
  family_name: "Rao",
};

describe("parseIdToken", () => {
  it("returns the identity with the email lowercased", () => {
    expect(parseIdToken(token(VALID), CLIENT, NOW)).toEqual({
      sub: "1234567890",
      email: "asha.rao@gmail.com",
      givenName: "Asha",
      familyName: "Rao",
    });
  });

  it.each([
    ["a foreign issuer", { iss: "https://evil.example" }],
    ["another app's audience", { aud: "someone-else" }],
    ["an expired token", { exp: NOW / 1000 - 1 }],
    ["an unverified email", { email_verified: false }],
    ["a missing subject", { sub: "" }],
  ])("rejects %s", (_label, override) => {
    expect(() => parseIdToken(token({ ...VALID, ...override }), CLIENT, NOW)).toThrow(GoogleSignInError);
  });

  it("rejects a malformed token", () => {
    expect(() => parseIdToken("not-a-jwt", CLIENT, NOW)).toThrow(GoogleSignInError);
    expect(() => parseIdToken("a.%%%.c", CLIENT, NOW)).toThrow(GoogleSignInError);
  });
});
