#!/usr/bin/env node
/**
 * Generate marketing images via Higgsfield and save them under
 * apps/web/public/marketing/. Reads HIGGSFIELD_API_KEY (format ID:SECRET) from
 *.env at repo root.
 *
 * Uses Marketing Studio Image by default — cheapest image model, campaign-tuned.
 * Docs: https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit
 *
 * Usage: node scripts/gen-higgsfield-images.mjs [slotId] # runs all when omitted
 *
 * NOTE: two Soul-v2 renders (hero-editorial.jpg, platform-editorial.jpg) are
 * currently checked in and used by the landing. Re-running this script will
 * OVERWRITE them with Marketing Studio Image renders — commit or move them
 * aside first if you want to keep the Soul versions.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(repoRoot, "apps/web/public/marketing");
mkdirSync(outDir, { recursive: true });

function loadEnv() {
  const path = join(repoRoot, ".env");
  if (!existsSync(path)) throw new Error(`.env not found at ${path}`);
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

const KEY = process.env.HIGGSFIELD_API_KEY;
if (!KEY) throw new Error("HIGGSFIELD_API_KEY not set");

const AUTH = `Key ${KEY}`;
const BASE = "https://api.higgsfield.ai";
const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

// -----------------------------------------------------------------------------
// Model catalog — three models per current console pricing.
// marketing-studio/image — $0.0121/image (default for images)
// seedance-2/reference-to-video — video, up to 4K, 4s/15s
// kling-3/turbo-text-to-video — video, up to 1080p, 1s/3s/15s
// Video models exist for future work; this script only wires the image model.
// -----------------------------------------------------------------------------

const MODELS = {
  "marketing-studio/image": {
    submitPath: "/marketing-studio/image",
    /** Build the JSON body from a slot's params, applying defaults. */
    buildBody: (slot) => ({
      prompt: slot.prompt,
      resolution: slot.resolution ?? "2k",
      aspect_ratio: slot.aspectRatio ?? "1:1",
      quality: slot.quality ?? "high",
    }),
  },
  "soul/v2": {
    submitPath: "/higgsfield-ai/soul/v2/standard",
    buildBody: (slot) => ({ prompt: slot.prompt }),
  },
};

// -----------------------------------------------------------------------------
// Landing-page image slots.
// Both are DESKTOP-ONLY in the layout (hidden md:block on <Image>). Keep this
// list short — mobile weight is a hard constraint.
// -----------------------------------------------------------------------------

const slots = [
  {
    id: "hero-editorial",
    filename: "hero-editorial.jpg",
    model: "marketing-studio/image",
    resolution: "2k",
    aspectRatio: "1:1",
    prompt:
      "Cinematic editorial photograph of a young trader in a dark room, warm amber " +
      "glow from a large curved monitor showing an abstract candlestick chart with green " +
      "and red bars, shallow depth of field, moody chiaroscuro lighting, subtle bokeh, " +
      "matte black surfaces, no visible text or logos, hyper-real skin texture, 35mm film " +
      "grain, shot on Leica Q3.",
  },
  {
    id: "platform-editorial",
    filename: "platform-editorial.jpg",
    model: "marketing-studio/image",
    resolution: "2k",
    aspectRatio: "1:1",
    prompt:
      "Editorial photograph of a modern trading floor at night, wide angle, reflected " +
      "candlestick charts on glass surfaces, amber warm accents against deep black " +
      "background, no visible text or logos, moody cinematic depth, subtle motion blur on " +
      "walking people, shot on Sony A7R V.",
  },
  // Logo concept explorations (run individually by id). These are direction
  // studies only — the production logo is a hand-built SVG, not a raster render.
  {
    id: "logo-candle-a",
    filename: "logo-concept-candle-a.png",
    model: "marketing-studio/image",
    resolution: "2k",
    aspectRatio: "1:1",
    prompt:
      "Minimalist premium app icon for a trading brand. A single bold geometric letter A " +
      "monogram constructed from a candlestick — the A is an upward bullish candle body in " +
      "warm amber gold (#FFB000) with a thin vertical wick extending above the apex. Flat " +
      "vector style, sharp clean edges, centered, generous negative space, rounded-square " +
      "matte black tile with a subtle inner bevel. No text, no letters, no words except the " +
      "single symbol. Dribbble logo design, crisp, iconic, high contrast.",
  },
  {
    id: "logo-candle-bars",
    filename: "logo-concept-candle-bars.png",
    model: "marketing-studio/image",
    resolution: "2k",
    aspectRatio: "1:1",
    prompt:
      "Minimalist premium app icon for a trading brand. Three ascending " +
      "candlestick bars implying upward momentum, the tallest center bar in warm amber gold " +
      "(#FFB000), thin wicks, flat vector style, sharp clean edges, centered inside a " +
      "rounded-square matte black tile. No text, no letters, no numbers, single geometric " +
      "symbol only. Crisp iconic logo, high contrast, Dribbble quality.",
  },
  {
    id: "logo-tick-diamond",
    filename: "logo-concept-tick-diamond.png",
    model: "marketing-studio/image",
    resolution: "2k",
    aspectRatio: "1:1",
    prompt:
      "Minimalist premium app icon for a trading brand. An up-chevron and down-chevron " +
      "stacked into a sharp diamond mark, the upper half warm amber gold (#FFB000), flat " +
      "vector style, sharp clean geometric edges, centered inside a rounded-square matte " +
      "black tile. No text, no letters, no numbers, single geometric symbol only. Crisp " +
      "iconic logo, high contrast, Dribbble quality.",
  },
  {
    id: "logo-bull",
    filename: "logo-concept-bull.png",
    model: "marketing-studio/image",
    resolution: "2k",
    aspectRatio: "1:1",
    prompt:
      "FLAT 2D VECTOR logo of a geometric bull head for a trading brand, front view, bold " +
      "symmetric horns sweeping upward, minimal facets, a single upward arrow integrated as " +
      "the blaze on the forehead. Solid warm amber gold (#FFB000) on a flat matte black " +
      "background. Absolutely flat design: NO 3D, NO metallic chrome, NO glossy bevels, NO " +
      "reflections, NO gradients, NO glow, NO drop shadows, NO lens flare. Clean crisp " +
      "geometry, thick even line weight, generous negative space, one solid color. Modern " +
      "flat mono-line logomark, Dribbble minimalist logo, no text, no letters, no words.",
  },
  // Fancy premium crest emblems (the client wants ornate, not minimal).
  {
    id: "logo-crest-blue",
    filename: "logo-crest-blue.png",
    model: "marketing-studio/image",
    resolution: "4k",
    aspectRatio: "1:1",
    prompt:
      "Premium circular emblem logo for a trading brand. A powerful geometric bull head in " +
      "polished gold with subtle electric-blue rim light, framed by an ornate circular gold " +
      "ring with fine tick marks, a bold upward arrow and rising candlestick chart bars " +
      "behind the bull, deep pure-black background, dramatic yet clean, razor-sharp edges, " +
      "high-end luxury fintech emblem, centered, perfectly symmetric. NO TEXT, no letters, " +
      "no words, no numbers.",
  },
  {
    id: "logo-crest-green",
    filename: "logo-crest-green.png",
    model: "marketing-studio/image",
    resolution: "4k",
    aspectRatio: "1:1",
    prompt:
      "Premium circular emblem logo for a trading brand. A bold geometric bull head in warm " +
      "amber gold with a bright green upward arrow blaze on the forehead, framed by an ornate " +
      "gold bezel ring with fine tick marks like a dial, small rising green and red " +
      "candlesticks flanking the bull, deep matte black background, crisp sharp edges, " +
      "high-end luxury fintech crest, centered, perfectly symmetric. NO TEXT, no letters, no " +
      "words, no numbers.",
  },
  {
    id: "logo-crest-3d",
    filename: "logo-crest-3d.png",
    model: "marketing-studio/image",
    resolution: "4k",
    aspectRatio: "1:1",
    prompt:
      "Luxury emblem logo, sculpted metallic gold bull head with sharp polished horns, ornate " +
      "circular gold frame with engraved tick marks, a bold upward stock-market arrow and " +
      "candlestick bars, pure black background, cinematic studio lighting, premium trading " +
      "brand mark, ultra sharp and clean, centered and symmetric. Refined and expensive, not " +
      "gaudy. NO TEXT, no letters, no words, no numbers.",
  },
];

async function submit(slot) {
  const model = MODELS[slot.model];
  if (!model) throw new Error(`unknown model "${slot.model}" for slot "${slot.id}"`);
  const url = `${BASE}${model.submitPath}`;
  const body = model.buildBody(slot);
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`submit ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function poll(statusUrl) {
  let delay = 2000;
  for (;;) {
    const r = await fetch(statusUrl, { headers: { Authorization: AUTH } });
    const text = await r.text();
    if (!r.ok) throw new Error(`poll ${r.status}: ${text}`);
    const body = JSON.parse(text);
    process.stdout.write(` status=${body.status}\n`);
    if (TERMINAL.has(body.status)) return body;
    await new Promise((res) => setTimeout(res, delay + Math.random() * 500));
    delay = Math.min(delay * 1.5, 10_000);
  }
}

async function saveFromUrl(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}

async function generateSlot(slot) {
  console.log(`\n▶ ${slot.id} (${slot.model})`);
  const initial = await submit(slot);
  console.log(` request_id=${initial.request_id}`);
  const done = await poll(initial.status_url);
  if (done.status !== "completed") throw new Error(`${slot.id}: ${done.status}: ${JSON.stringify(done)}`);
  const url = done.images?.[0]?.url ?? done.image?.url;
  if (!url) throw new Error(`${slot.id}: no image URL in ${JSON.stringify(done)}`);
  const dest = join(outDir, slot.filename);
  const bytes = await saveFromUrl(url, dest);
  console.log(` ✓ saved ${slot.filename} (${(bytes / 1024).toFixed(1)} KB) from ${url}`);
}

const only = process.argv[2];
const targets = only ? slots.filter((s) => s.id === only): slots;
if (targets.length === 0) {
  console.error(`No slot matched "${only}". Available: ${slots.map((s) => s.id).join(", ")}`);
  process.exit(1);
}

for (const slot of targets) {
  try {
    await generateSlot(slot);
  } catch (e) {
    console.error(` ✗ ${slot.id}: ${e.message}`);
    process.exitCode = 1;
  }
}
