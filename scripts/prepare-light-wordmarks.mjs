/**
 * Deterministic light-surface wordmarks from the supplied black-lettered art.
 * Run: node scripts/prepare-light-wordmarks.mjs
 *
 * The source is flattened on white and includes a gray drop shadow. A normal
 * white key leaves a halo, so neutral lettering is rebuilt as black coverage;
 * chromatic flag/tagline pixels retain their source hue. The X's white stripe
 * is preserved inside its explicit silhouette, never keyed as background.
 */
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import console from "node:console";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const sharp = require("sharp");
const brandDir = fileURLToPath(new URL("../apps/web/public/brand/", import.meta.url));
const { data, info } = await sharp(`${brandDir}indianxtrade-wordmark-light.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const pixels = Buffer.alloc(width * height * 4);

// Outline follows the X's black edge; its anti-aliased mask excludes the shadow.
const xMask = await sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><path fill="white" d="M496 30 L579 30 L625 88 L673 30 L755 30 L665 143 L754 261 L674 261 L625 202 L577 261 L496 261 L586 143 Z"/></svg>`)).ensureAlpha().raw().toBuffer();
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const o = (y * width + x) * 4;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const hi = Math.max(...rgb);
    const lo = Math.min(...rgb);
    const chroma = hi - lo;
    const inX = xMask[o + 3];
    if (inX) {
      rgb.forEach((value, c) => { pixels[o + c] = value; });
      pixels[o + 3] = inX;
      continue;
    }
    // Restrict to the lettering/tagline bands to remove the original shadow.
    const lettering = y >= 99 && y <= 200 && (x < 520 || x > 721);
    const tagline = y >= 296 && y <= 329;
    const flagInA = y >= 155 && y <= 200 && ((x >= 354 && x <= 385) || (x >= 969 && x <= 1006));
    if (!lettering && !tagline && !flagInA) continue;
    if (chroma > 65 && lo < 170) {
      // Remove the white matte from partial chromatic edge coverage.
      const alpha = 255 - lo;
      rgb.forEach((value, c) => { pixels[o + c] = Math.max(0, Math.round((value - lo) * 255 / alpha)); });
      pixels[o + 3] = alpha;
    } else if (lettering || tagline) {
      pixels[o + 3] = Math.round(Math.min(1, Math.max(0, (145 - hi) / 35)) * 255);
    }
  }
}

const source = sharp(pixels, { raw: { width, height, channels: 4 } });
await source.clone().extract({ left: 34, top: 29, width: 1190, height: 301 })
  .resize(1179, 298, { fit: "contain", background: "transparent" })
  .png().toFile(`${brandDir}indianxtrade-wordmark-onlight.png`);
await source.clone().extract({ left: 34, top: 29, width: 1190, height: 233 })
  .resize(1170, 229, { fit: "contain", background: "transparent" })
  .png().toFile(`${brandDir}indianxtrade-wordmark-onlight-compact.png`);
console.log("Prepared transparent black wordmarks: 1179×298 and 1170×229.");
