import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./request-context";

describe("clientIpFrom", () => {
  it("prefers X-Real-IP, which nginx overwrites with the TCP peer address", () => {
    const h = new Headers({ "x-real-ip": "49.36.1.2", "x-forwarded-for": "1.1.1.1, 49.36.1.2" });
    expect(clientIpFrom(h)).toBe("49.36.1.2");
  });

  it("ignores a client-supplied first X-Forwarded-For hop and takes the one nginx appended", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "1.1.1.1, 49.36.1.2" }))).toBe("49.36.1.2");
  });

  it("handles a single-hop X-Forwarded-For", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " 49.36.1.2 " }))).toBe("49.36.1.2");
  });

  it("falls back to 'local' when no proxy header is present", () => {
    expect(clientIpFrom(new Headers())).toBe("local");
  });
});
