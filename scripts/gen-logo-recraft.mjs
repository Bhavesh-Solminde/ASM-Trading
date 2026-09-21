#!/usr/bin/env node
/**
 * Generate flat-vector logo concepts via Recraft V4.1 Pro (Higgsfield REST).
 * Recraft is tuned for clean design/vector output; with a flat-vector prompt +
 * locked palette this reads as a designed mark, not a 3D AI render.
 *
 * Endpoint: POST /recraft/v4.1/pro/text-to-image  (raster PNG, palette-locked)
 * Docs: https://docs.higgsfield.ai/docs/models/recraft-v4-1-pro/generate
 *
 * Usage: node scripts/gen-logo-recraft.mjs [slotId]   # all when omitted
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(repoRoot, "brandkit", "logo");
mkdirSync(outDir, { recursive: true });

function loadEnv() {
  const p = join(repoRoot, ".env");
  if (!existsSync(p)) throw new Error(`.env not found at ${p}`);
  for (const line of readFileSync(p, "utf8").split("\n")) {
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
const URL = "https://api.higgsfield.ai/recraft/v4.1/pro/text-to-image";
const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

// Locked palette (site tokens): amber primary, green accent, near-black bg.
const AMBER = { rgb: [255, 176, 0] };
const GREEN = { rgb: [59, 229, 132] };
const BG = { rgb: [5, 5, 5] };

const slots = [
  {
    id: "x-neon-charged",
    filename: "logo-x-neon.png",
    colors: [AMBER, GREEN],
    prompt:
      "High-energy esports crypto logo mark: an aggressive angular low-poly bull head charging " +
      "forward with sharp swept-forward horns, filled with a rich molten gold gradient and traced " +
      "by an intense glowing neon-green edge, a bold neon-green upward arrow blazing up the center " +
      "of the face, dynamic diagonal energy streaks and speed lines radiating outward behind the " +
      "horns, a strong neon-green glow halo on a deep near-black background, sharp dramatic " +
      "faceted planes, powerful mirror symmetry, centered. Bold, electric, futuristic, premium " +
      "gaming-crypto brand energy, striking not calm. Smooth vector gradient fills with glow and " +
      "energy lines, crisp edges, no photoreal 3D sculpture, no bevels, no text.",
  },
  {
    id: "x-medallion",
    filename: "logo-x-medallion.png",
    colors: [AMBER, GREEN],
    prompt:
      "Premium collectible crypto medallion emblem: a faceted gold bull head with sharp horns " +
      "centered inside a layered hexagon coin badge with concentric inner bevel rings and fine " +
      "tech tick marks, a brilliant glowing neon-green upward arrow as the central spine, a row " +
      "of rising green and amber candlestick bars across the lower half behind the bull, subtle " +
      "engraved circuit detailing in the badge frame, rich gold gradient with a neon-green glow, " +
      "deep near-black background, centered and symmetric. Luxurious, detailed, futuristic " +
      "trading-token medallion, exciting and high-value. Smooth vector gradients, glow, fine " +
      "detail, crisp edges, no photoreal 3D sculpture, no heavy bevels, no text.",
  },
  {
    id: "x-burst",
    filename: "logo-x-burst.png",
    colors: [AMBER, GREEN],
    prompt:
      "Dynamic modern crypto emblem: a bold angular gold bull head bursting upward through a " +
      "broken hexagon frame, a powerful glowing neon-green upward arrow shooting through the bull " +
      "and past the top of the frame, a rising neon-green candlestick chart line climbing behind " +
      "the bull, motion energy and a green glow, rich gold gradient with sharp faceted planes, " +
      "deep near-black background, strong upward diagonal momentum, centered composition. Bold, " +
      "energetic, futuristic, premium fintech-crypto brand. Smooth vector gradients with glow and " +
      "motion, crisp edges, no photoreal 3D sculpture, no bevels, no text.",
  },
];

async function submit(slot) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: slot.prompt,
      resolution: "2k",
      aspect_ratio: "1:1",
      output_format: "png",
      colors: slot.colors,
      background_color: BG,
    }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`submit ${r.status}: ${t}`);
  return JSON.parse(t);
}
async function poll(statusUrl) {
  let d = 2000;
  for (;;) {
    const r = await fetch(statusUrl, { headers: { Authorization: AUTH } });
    const t = await r.text();
    if (!r.ok) throw new Error(`poll ${r.status}: ${t}`);
    const b = JSON.parse(t);
    process.stdout.write(`  status=${b.status}\n`);
    if (TERMINAL.has(b.status)) return b;
    await new Promise((res) => setTimeout(res, d + Math.random() * 500));
    d = Math.min(d * 1.5, 10000);
  }
}
async function save(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}
async function run(slot) {
  console.log(`\n▶ ${slot.id}`);
  const init = await submit(slot);
  console.log(`  request_id=${init.request_id}`);
  const done = await poll(init.status_url);
  if (done.status !== "completed") throw new Error(`${slot.id}: ${done.status}: ${JSON.stringify(done)}`);
  const url = done.images?.[0]?.url ?? done.image?.url;
  if (!url) throw new Error(`${slot.id}: no image url in ${JSON.stringify(done)}`);
  const dest = join(outDir, slot.filename);
  const bytes = await save(url, dest);
  console.log(`  ✓ saved ${dest} (${(bytes / 1024).toFixed(1)} KB)`);
}

const only = process.argv[2];
const targets = only ? slots.filter((s) => s.id === only) : slots;
if (!targets.length) {
  console.error(`No slot "${only}". Available: ${slots.map((s) => s.id).join(", ")}`);
  process.exit(1);
}
for (const s of targets) {
  try {
    await run(s);
  } catch (e) {
    console.error(`  ✗ ${s.id}: ${e.message}`);
    process.exitCode = 1;
  }
}
