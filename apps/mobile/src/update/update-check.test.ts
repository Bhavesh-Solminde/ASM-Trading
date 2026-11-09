import { describe, expect, it } from "vitest";
import { updatePrompt, updateUrl } from "./update-check";
describe("direct APK updates", () => {
  const s = {
    variant: "direct" as const,
    current: "1.0.0",
    latest: "1.1.0",
    dismissedVersion: null,
  };
  it("prompts once per newer version, direct only", () => {
    expect(updatePrompt(s)).toBe("prompt");
    expect(updatePrompt({ ...s, variant: "play" })).toBe("none");
    expect(updatePrompt({ ...s, dismissedVersion: "1.1.0" })).toBe("none");
    expect(updatePrompt({ ...s, current: "1.1.0" })).toBe("none");
    expect(updatePrompt({ ...s, latest: "x" })).toBe("none");
  });
  it("opens only the site APK path", () => {
    expect(updateUrl("https://indianxtrade.com", "/download/app")).toBe(
      "https://indianxtrade.com/download/app",
    );
    for (const p of [
      "//evil.test/x",
      "https://evil.test/download/app",
      "/login",
      "/download/app?redirect=x",
      "javascript:alert(1)",
    ])
      expect(updateUrl("https://indianxtrade.com", p)).toBeNull();
  });
});
