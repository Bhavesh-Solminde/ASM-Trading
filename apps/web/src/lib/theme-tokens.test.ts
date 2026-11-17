import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const declarations = (css: string) => Object.fromEntries([...css.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
const css = readFileSync("src/app/globals.css", "utf8");
const light = declarations(css.split(':root[data-theme="light"] {')[1]!.split("}")[0]!);
function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(v => { const x = parseInt(v, 16) / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
describe("theme token contracts", () => {
  for (const file of ["globals.css", "theme-surfaces.css", "theme-chart.css"]) {
    it(`${file} overrides every color token in light mode`, () => {
      const source = readFileSync(`src/app/${file}`, "utf8");
      const dark = declarations(source.split("@theme {")[1]!.split("}")[0]!);
      const overrides = declarations(source.split(':root[data-theme="light"]')[1]!.split("}")[0]!);
      expect(Object.keys(dark).filter(key => !(key in overrides))).toEqual([]);
    });
  }
  it("keeps all primary text readable on light page and card surfaces", () => {
    for (const text of ["ink", "ink-2", "ink-3", "brand", "up", "down", "caution"])
      for (const surface of ["ground", "panel", "tile", "tile-hi"])
        expect(contrast(light[`--color-${text}`]!, light[`--color-${surface}`]!), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps button labels readable on solid light fills", () => {
    for (const [fill, ink] of [["brand-fill", "brand-ink"], ["brand-fill-hi", "brand-ink"], ["up", "up-ink"], ["down", "down-ink"]])
      expect(contrast(light[`--color-${fill}`]!, light[`--color-${ink}`]!)).toBeGreaterThanOrEqual(4.5);
  });
});
