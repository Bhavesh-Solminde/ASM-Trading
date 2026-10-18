import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "./proxy";

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

  it("leaves the website's API calls alone", () => {
    process.env["MAINTENANCE_MODE"] = "";
    process.env["APP_MIN_VERSION"] = "2.0.0";
    const res = proxy(new NextRequest("http://localhost/api/v1/wallet"));
    expect(res.status).not.toBe(426);
  });
});
