// Package the browser demo as one shareable HTML file. No application build.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const read = path => readFile(new URL(path, import.meta.url), "utf8");
let html = await read("index.html");
html = html.replace('<link rel="stylesheet" href="demo.css">', `<style>${await read("demo.css")}</style>`);
for (const path of ["vendor/lightweight-charts-5.2.1.js", "vendor/klinecharts-9.8.12.js", "live-feed.js", "demo.js"]) {
  const source = (await read(path)).replace(/<\/script/gi, "<\\/script");
  html = html.replace(`<script src="${path}"></script>`, () => `<script>\n${source}\n</script>`);
}
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const license = await read("vendor/LICENSE-Apache-2.0.txt");
const notice = await read("vendor/NOTICE-lightweight-charts.txt");
html = html.replace('href="vendor/LICENSE-Apache-2.0.txt" target="_blank"', 'href="#third-party-licenses"');
html = html.replace("</main>", `<details class="comparison-details" id="third-party-licenses"><summary>Third-party licenses <span>+</span></summary><pre style="padding:20px;white-space:pre-wrap;font-size:11px;color:var(--muted)">${escape(notice)}\nKLineChart 9.8.12 · Copyright 2018-present liihuu\n\n${escape(license)}</pre></details></main>`);
const output = new URL("../chart-comparison.html", import.meta.url);
await writeFile(output, html);
console.log(`Standalone demo saved to ${fileURLToPath(output)} (${Buffer.byteLength(html).toLocaleString()} bytes)`);
