#!/usr/bin/env node
/**
 * Generate marketing images via Higgsfield and save them under
 * apps/web/public/marketing/. Reads HIGGSFIELD_API_KEY (format ID:SECRET) from
 * .env at repo root.
 *
 * Uses Marketing Studio Image by default — cheapest image model, campaign-tuned.
 * Docs: https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit
 *
 * Usage: node scripts/gen-higgsfield-images.mjs [slotId]   # runs all when omitted
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
//   marketing-studio/image        — $0.0121/image  (default for images)
//   seedance-2/reference-to-video — video, up to 4K, 4s/15s
//   kling-3/turbo-text-to-video   — video, up to 1080p, 1s/3s/15s
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
//   Both are DESKTOP-ONLY in the layout (hidden md:block on <Image>). Keep this
//   list short — mobile weight is a hard constraint.
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
    process.stdout.write(`  status=${body.status}\n`);
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
  console.log(`  request_id=${initial.request_id}`);
  const done = await poll(initial.status_url);
  if (done.status !== "completed") throw new Error(`${slot.id}: ${done.status}: ${JSON.stringify(done)}`);
  const url = done.images?.[0]?.url ?? done.image?.url;
  if (!url) throw new Error(`${slot.id}: no image URL in ${JSON.stringify(done)}`);
  const dest = join(outDir, slot.filename);
  const bytes = await saveFromUrl(url, dest);
  console.log(`  ✓ saved ${slot.filename} (${(bytes / 1024).toFixed(1)} KB) from ${url}`);
}

const only = process.argv[2];
const targets = only ? slots.filter((s) => s.id === only) : slots;
if (targets.length === 0) {
  console.error(`No slot matched "${only}". Available: ${slots.map((s) => s.id).join(", ")}`);
  process.exit(1);
}

for (const slot of targets) {
  try {
    await generateSlot(slot);
  } catch (e) {
    console.error(`  ✗ ${slot.id}: ${e.message}`);
    process.exitCode = 1;
  }
}
