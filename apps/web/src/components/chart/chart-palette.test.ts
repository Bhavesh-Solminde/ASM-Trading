import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("emits every dark canvas token and its light override in compiled Tailwind CSS", async () => {
  // JS-only @theme entries otherwise disappear during Tailwind tree shaking.
  const require = createRequire(resolve("package.json"));
  const tailwind = require("@tailwindcss/postcss");
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const source = readFileSync(resolve("src/app/theme-chart.css"), "utf8");
  const result = await postcss([tailwind()]).process(`@import "tailwindcss" source(none);\n${source}`, { from: resolve("chart-theme-check.css") });
  const definitions = [...source.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)];
  expect(definitions.length).toBeGreaterThan(50);
  for (const [, name, value] of definitions) {
    const emitted = [...result.css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map(match => match[1]);
    expect(emitted, `${name} must retain ${value}, including its dark default`).toContain(value);
  }
  expect(result.css).toContain("background-color: var(--color-chart-classic)");
});
