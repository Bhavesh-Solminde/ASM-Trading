import { describe, expect, it } from "vitest";
import { pushTarget } from "./push-target";
describe("pushTarget", () => {
  it("opens only supported internal targets", () => {
    for (const url of ["/history", "/history?tx=d:abc-123", "/history?tx=w:abc", "/account/verify"]) expect(pushTarget(url)).toBe(url);
    for (const url of [null, "https://evil.test", "//evil.test", "/account/verify?redirect=https://evil.test", "/history?tx=d:a&other=1"]) expect(pushTarget(url)).toBeNull();
  });
});
