import { describe, expect, it } from "vitest";
import { BUTTON_SKIN } from "./button-skin";
import { color } from "./tokens";

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("button skins", () => {
  it("defines the four kinds", () => {
    expect(Object.keys(BUTTON_SKIN).sort()).toEqual(["light", "primary", "secondary", "text"]);
  });

  it("primary is the accent fill with white text, light is ink with ground text", () => {
    expect(BUTTON_SKIN.primary).toMatchObject({ bg: color.accent, ink: color.onAccent });
    expect(BUTTON_SKIN.light).toMatchObject({ bg: color.ink, ink: color.ground });
  });

  it("filled buttons pass AA for their label", () => {
    expect(contrast(BUTTON_SKIN.primary.ink, BUTTON_SKIN.primary.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BUTTON_SKIN.light.ink, BUTTON_SKIN.light.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("outlined and text buttons are legible on the ground and on a sheet", () => {
    for (const bg of [color.ground, color.surface]) {
      expect(contrast(BUTTON_SKIN.secondary.ink, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(BUTTON_SKIN.text.ink, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every kind is at least 44pt tall", () => {
    for (const s of Object.values(BUTTON_SKIN)) expect(s.height).toBeGreaterThanOrEqual(44);
  });
});
