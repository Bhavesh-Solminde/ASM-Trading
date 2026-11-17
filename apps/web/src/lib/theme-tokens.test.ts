import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const declarations = (css: string) => Object.fromEntries([...css.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
// Palette rules are flat; removing comments keeps selector checks independent of prose.
const rules = (source: string) => [...source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector!.trim(), colors: declarations(body!) }));
const css = readFileSync("src/app/globals.css", "utf8");
const light = declarations(css.split(':root[data-theme="light"] {')[1]!.split("}")[0]!);
function luminance(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(v => { const x = parseInt(v, 16) / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
describe("theme token contracts", () => {
  for (const file of ["globals.css", "theme-surfaces.css", "theme-chart.css"]) {
    it(`${file} light color tokens do not depend on :has() support`, () => {
      const lightRules = rules(readFileSync(`src/app/${file}`, "utf8"))
        .filter(rule => rule.selector.includes('[data-theme="light"]') && Object.keys(rule.colors).length > 0);
      expect(lightRules.length).toBeGreaterThan(0);
      for (const rule of lightRules) expect(rule.selector).not.toContain(":has(");
    });
    it(`${file} overrides every color token in light mode`, () => {
      const source = readFileSync(`src/app/${file}`, "utf8");
      const dark = declarations(source.split("@theme {")[1]!.split("}")[0]!);
      const overrides = declarations(source.split(':root[data-theme="light"]')[1]!.split("}")[0]!);
      expect(Object.keys(dark).filter(key => !(key in overrides))).toEqual([]);
    });
  }
  it("rejects :has() dependencies in light color rules anywhere in the source tree", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter(path => path.endsWith(".css"));
    const failures: string[] = [];
    for (const file of files) for (const rule of rules(readFileSync(`src/${file}`, "utf8"))) {
      const lightSelector = /\[data-theme\s*=\s*["']?light["']?\s*\]/.test(rule.selector);
      if (!lightSelector || !rule.selector.includes(":has(") || !Object.keys(rule.colors).length) continue;
      // Special-page document ground is an enhancement; its actual page palette
      // is defined independently. The canonical light palette may never depend on it.
      const specialGround = file === "app/theme-special.css" && rule.selector === ':root[data-theme="light"]:has([data-start-page])'
        && Object.keys(rule.colors).every(token => token === "--color-ground" || token === "--color-rule");
      if (!specialGround) failures.push(`${file}: ${rule.selector}`);
    }
    expect(failures).toEqual([]);
  });
  it("only allows the existing special-page light ground enhancement to use :has()", () => {
    const enhancements = rules(readFileSync("src/app/theme-special.css", "utf8"))
      .filter(rule => rule.selector.includes('[data-theme="light"]') && rule.selector.includes(":has(") && Object.keys(rule.colors).length > 0);
    expect(enhancements.map(rule => rule.selector)).toEqual([':root[data-theme="light"]:has([data-start-page])']);
    expect(Object.keys(enhancements[0]!.colors).sort()).toEqual(["--color-ground", "--color-rule"]);
  });
  it("keeps the admin reset available without :has() support", () => {
    const paletteRules = rules(css);
    const admin = paletteRules.find(rule => rule.selector === ".admin-root");
    const overscroll = paletteRules.find(rule => rule.selector === ":root:has(.admin-root)");
    expect(admin).toBeDefined();
    expect(Object.keys(admin!.colors).length).toBeGreaterThan(0);
    expect(admin!.colors).toEqual(overscroll!.colors);
  });
  it("keeps the selected bonus tier and NEXT chip readable on tinted light surfaces", () => {
    const surfaces = declarations(readFileSync("src/app/theme-surfaces.css", "utf8").split(':root[data-theme="light"] {')[1]!.split("}")[0]!);
    const blend = (foreground: string, background: string, alpha: number) => "#" + [1, 3, 5]
      .map(offset => Math.round(parseInt(foreground.slice(offset, offset + 2), 16) * alpha + parseInt(background.slice(offset, offset + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0"))
      .join("");
    for (const opacity of [.15, .18]) {
      const background = blend(light["--color-up"]!, surfaces["--color-bonus-surface"]!, opacity);
      expect(contrast(surfaces["--color-bonus-accent"]!, background), `bonus text on ${opacity * 100}% up tint`).toBeGreaterThanOrEqual(4.5);
    }
  });
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
