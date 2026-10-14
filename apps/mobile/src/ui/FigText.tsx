import { Txt, type TxtProps } from "@/theme/ui";
import { figLineHeight, splitFigRuns } from "./fig-runs";

export type FigTextProps = Omit<TxtProps, "font" | "children"> & { text: string };

/**
 * A figure string that may hold ₹ or Hindi words. Digits and ASCII punctuation are set in Martian Mono; every
 * glyph Martian lacks (₹, Devanagari, the true minus, ...) is a nested Anek run, which picks Anek Devanagari
 * on Hindi screens. Every run shares size, weight, colour, tracking and line height.
 */
export function FigText({ text, size = 14, weight = 400, color, tracking, lineHeight, script, ...rest }: FigTextProps) {
  const runs = splitFigRuns(text);
  const lh = lineHeight ?? figLineHeight(runs, size);
  const shared = { size, weight, color, tracking, lineHeight: lh } as const;
  if (!runs.some((r) => r.ui)) {
    return (
      <Txt {...rest} {...shared} font="fig">
        {text}
      </Txt>
    );
  }
  return (
    <Txt {...rest} {...shared} font="fig">
      {runs.map((r, i) =>
        r.ui ? (
          // Runs are rebuilt from `text` each render and never reorder, so the index is a stable key.
          <Txt key={i} {...shared} script={script}>
            {r.text}
          </Txt>
        ) : (
          r.text
        ),
      )}
    </Txt>
  );
}
