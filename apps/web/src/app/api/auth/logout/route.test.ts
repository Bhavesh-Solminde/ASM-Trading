import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function post(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers });
}

describe("POST /api/auth/logout", () => {
  it("redirects a plain form post to /login so the browser leaves the page", async () => {
    const res = await POST(post({ "content-type": "application/x-www-form-urlencoded" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie")).toMatch(/asm_session=;.*Max-Age=0/i);
  });

  it("answers fetch() callers with an empty 204 and still clears the cookie", async () => {
    const res = await POST(post());
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/asm_session=;.*Max-Age=0/i);
  });
});
