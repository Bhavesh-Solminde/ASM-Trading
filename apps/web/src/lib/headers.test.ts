import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

describe("security headers", () => {
  const res = middleware(new NextRequest("http://localhost:3000/"));

  it("denies framing", () => {
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets a content security policy with frame-ancestors none", () => {
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("disables MIME sniffing", () => {
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sends no referrer", () => {
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
