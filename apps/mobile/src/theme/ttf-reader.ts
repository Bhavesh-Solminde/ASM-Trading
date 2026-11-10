import { readFileSync } from "node:fs";

/**
 * Test support: reads glyph advance widths from a bundled TrueType file (`head`, `hhea`, `hmtx` and the
 * format 4 `cmap`), so layout constants can be checked against the fonts the app really ships. Not imported by app code.
 */
export interface FontMetrics {
  unitsPerEm: number;
  /** Advance of `ch` in em, or null when the font has no glyph for it. */
  advanceEm(ch: string): number | null;
  /** Every code point the font maps, ascending. */
  codePoints(): number[];
}

export function readFont(path: string): FontMetrics {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0, n = view.getUint16(4); i < n; i++) {
    const rec = 12 + i * 16;
    tables.set(String.fromCharCode(...buf.subarray(rec, rec + 4)), view.getUint32(rec + 8));
  }
  const at = (tag: string): number => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`${path}: no ${tag} table`);
    return offset;
  };
  const unitsPerEm = view.getUint16(at("head") + 18);
  const metricCount = view.getUint16(at("hhea") + 34);
  const hmtx = at("hmtx");
  const advanceOf = (gid: number) => view.getUint16(hmtx + 4 * Math.min(gid, metricCount - 1));

  // cmap: the Windows Unicode BMP subtable (platform 3, encoding 1), format 4.
  const cmap = at("cmap");
  let sub = -1;
  for (let i = 0, n = view.getUint16(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + i * 8;
    if (view.getUint16(rec) === 3 && view.getUint16(rec + 2) === 1) sub = cmap + view.getUint32(rec + 4);
  }
  if (sub < 0 || view.getUint16(sub) !== 4) throw new Error(`${path}: no format 4 Unicode cmap`);
  const segs = view.getUint16(sub + 6) / 2;
  const endCodes = sub + 14;
  const startCodes = endCodes + segs * 2 + 2;
  const deltas = startCodes + segs * 2;
  const rangeOffsets = deltas + segs * 2;
  const glyphOf = (cp: number): number => {
    for (let s = 0; s < segs; s++) {
      if (cp > view.getUint16(endCodes + s * 2)) continue;
      if (cp < view.getUint16(startCodes + s * 2)) return 0;
      const ro = view.getUint16(rangeOffsets + s * 2);
      if (ro === 0) return (cp + view.getInt16(deltas + s * 2)) & 0xffff;
      const g = view.getUint16(rangeOffsets + s * 2 + ro + (cp - view.getUint16(startCodes + s * 2)) * 2);
      return g === 0 ? 0 : (g + view.getInt16(deltas + s * 2)) & 0xffff;
    }
    return 0;
  };
  return {
    unitsPerEm,
    advanceEm(ch) {
      const gid = glyphOf(ch.codePointAt(0) ?? 0);
      return gid === 0 ? null : advanceOf(gid) / unitsPerEm;
    },
    codePoints() {
      const out: number[] = [];
      for (let s = 0; s < segs; s++) {
        for (let c = view.getUint16(startCodes + s * 2), e = view.getUint16(endCodes + s * 2); c <= e && c < 0xffff; c++) {
          if (glyphOf(c) !== 0) out.push(c);
        }
      }
      return out;
    },
  };
}

/** Path of a bundled @expo-google-fonts file, e.g. fontPath("martian-mono", "MartianMono_600SemiBold"). */
export function fontPath(pkg: string, family: string): string {
  const dir = family.split("_")[1];
  return new URL(`../../node_modules/@expo-google-fonts/${pkg}/${dir}/${family}.ttf`, import.meta.url).pathname;
}
