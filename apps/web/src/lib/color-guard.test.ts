import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { expect, it } from "vitest";
import { colorException, literalColor } from "./color-guard";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|tsx|css)$/.test(path) && !/\.(test|spec)\./.test(path) ? [path] : [];
  });
}
it("uses tokens for every semantic colour", () => {
  const root = resolve("src"); const failures: string[] = [];
  for (const file of files(root)) {
    const name = relative(root, file).replaceAll("\\", "/");
    if (colorException(name)) continue;
    // Ignore comments, keeping newlines for useful source locations.
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
    source.split("\n").forEach((line, index) => {
      literalColor.lastIndex = 0;
      if (literalColor.test(line)) failures.push(`${name}:${index + 1}: use a semantic colour token: ${line.trim()}`);
    });
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
it("detects common regressions", () => {
  for (const sample of ['fill="#fff"', 'rgba(0,0,0,.5)', 'hsl(0 0% 10%)', 'hover:bg-white/10', 'text-[#abcdef]', 'shadow-black/40']) {
    literalColor.lastIndex = 0; expect(literalColor.test(sample)).toBe(true);
  }
});
