import { describe, expect, it } from "vitest";
import { GLYPHS, ICON_NAMES } from "./icon-glyphs";

describe("icon glyphs", () => {
  it("ship every name the primitives brief lists, including the ones existing callers use", () => {
    for (const n of ["trade", "wallet", "history", "user", "chevron", "more", "star", "search", "lock", "bolt", "close", "briefcase"]) {
      expect(ICON_NAMES).toContain(n);
    }
    for (const n of ["chevronDown", "plus", "arrowUp", "arrowDown", "fingerprint", "key", "eye", "eyeOff", "delete", "download", "expand", "collapse"]) {
      expect(ICON_NAMES).toContain(n);
    }
    for (const n of ["arrowLeft", "arrowUpRight", "check", "badgeCheck", "copy", "timer", "atSign", "indianRupee", "rotateCcw"]) {
      expect(ICON_NAMES).toContain(n);
    }
    for (const n of ["idCard", "creditCard", "scanFace", "flashlight", "image", "bell", "shieldCheck", "languages", "lifeBuoy"]) {
      expect(ICON_NAMES).toContain(n);
    }
    expect(ICON_NAMES).toHaveLength(42);
  });

  it("has drawable geometry for every name", () => {
    for (const n of ICON_NAMES) {
      const g = GLYPHS[n];
      expect(g.paths.length + (g.circles?.length ?? 0), n).toBeGreaterThan(0);
    }
  });

  it("uses only well-formed path data starting with a move command", () => {
    for (const n of ICON_NAMES) {
      for (const d of GLYPHS[n].paths) {
        expect(d, `${n}: ${d}`).toMatch(/^[Mm][-0-9.\sMmLlHhVvCcSsQqTtAaZz,]+$/);
      }
    }
  });

  it("has unique path and circle keys per glyph (they are React keys)", () => {
    for (const n of ICON_NAMES) {
      const g = GLYPHS[n];
      expect(new Set(g.paths).size, `${n} paths`).toBe(g.paths.length);
      const keys = (g.circles ?? []).map((c) => `${c.cx}-${c.cy}`);
      expect(new Set(keys).size, `${n} circles`).toBe(keys.length);
    }
  });
});
