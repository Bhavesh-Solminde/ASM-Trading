/** A stretch of a figure string that is set in one family: `ui` = Anek, otherwise Martian Mono. */
export interface FigRun {
  text: string;
  ui: boolean;
}

/**
 * Splits a figure-bearing string into runs by glyph coverage. Martian Mono covers ASCII only, so any code point
 * above 0x7F (₹, Devanagari, the true minus, a middle dot, ...) goes to the UI family; everything else stays in
 * Martian. Whitespace joins the run before it (a leading space joins the first run); neighbours of one kind merge.
 */
export function splitFigRuns(text: string): FigRun[] {
  const runs: FigRun[] = [];
  let lead = "";
  for (const ch of text) {
    const last = runs[runs.length - 1];
    if (/\s/.test(ch)) {
      if (last) last.text += ch;
      else lead += ch;
      continue;
    }
    const ui = (ch.codePointAt(0) ?? 0) > 0x7f;
    if (last && last.ui === ui) last.text += ch;
    else runs.push({ text: lead + ch, ui });
    lead = "";
  }
  if (runs.length === 0 && lead) runs.push({ text: lead, ui: false });
  return runs;
}

const DEVANAGARI = /[\u0900-\u097f]/;

/**
 * One line height for every run of a figure string: 1.3x like <Txt>, or 1.5x when a Devanagari run is present
 * (the same ratio <Txt> uses for Hindi UI text). Set on every run so the line does not change height mid-string.
 */
export function figLineHeight(runs: FigRun[], size: number): number {
  return Math.round(size * (runs.some((r) => r.ui && DEVANAGARI.test(r.text)) ? 1.5 : 1.3));
}
