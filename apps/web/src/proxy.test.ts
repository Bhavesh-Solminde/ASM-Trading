import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "./proxy";
import { SESSION_COOKIE } from "@/lib/session-cookie";

const saved = { maintenance: process.env["MAINTENANCE_MODE"], min: process.env["APP_MIN_VERSION"] };

afterEach(() => {
  for (const [k, v] of [["MAINTENANCE_MODE", saved.maintenance], ["APP_MIN_VERSION", saved.min]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("proxy", () => {
  it("answers API calls during maintenance with the maintenance code", async () => {
    process.env["MAINTENANCE_MODE"] = "1";
    const res = proxy(new NextRequest("http://localhost/api/v1/wallet"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("maintenance");
  });

  it("tells an outdated app to upgrade", () => {
    process.env["MAINTENANCE_MODE"] = "";
    process.env["APP_MIN_VERSION"] = "2.0.0";
    const res = proxy(new NextRequest("http://localhost/api/v1/wallet", { headers: { "x-client": "app/1.0.0" } }));
    expect(res.status).toBe(426);
  });

  it("sends a signed-out visitor from the affiliate dashboard to the affiliate login", () => {
    process.env["MAINTENANCE_MODE"] = "";
    const res = proxy(new NextRequest("http://localhost/affiliate/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/affiliate/login");
    for (const path of ["/affiliate", "/affiliate/login", "/affiliate/register", "/affiliate/forgot-password"]) {
      expect(proxy(new NextRequest(`http://localhost${path}`)).headers.get("location")).toBeNull();
    }
    const signedIn = new NextRequest("http://localhost/affiliate/dashboard");
    signedIn.cookies.set(SESSION_COOKIE, "token");
    expect(proxy(signedIn).headers.get("location")).toBeNull();
  });

  it("leaves the website's API calls alone", () => {
    process.env["MAINTENANCE_MODE"] = "";
    process.env["APP_MIN_VERSION"] = "2.0.0";
    const res = proxy(new NextRequest("http://localhost/api/v1/wallet"));
    expect(res.status).not.toBe(426);
  });
});
