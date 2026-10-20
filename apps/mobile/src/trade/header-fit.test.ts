import { describe, expect, it } from "vitest";
import en from "@/i18n/en.json";
import hi from "@/i18n/hi.json";
import { fontPath, readFont } from "@/theme/ttf-reader";
import { headerMetrics } from "@/ui/header-metrics";
import {
  COMPACT_WIDTH,
  DEVANAGARI_ADVANCE_EM,
  FIGURE,
  FIT_MARGIN,
  LABEL_ADVANCE_EM,
  MARTIAN_ADVANCE_EM,
  RUPEE_ADVANCE_EM,
  TODAY,
  fitHeader,
  fitSize,
  FILL_RIGHT,
  isCompactWidth,
  pillWidth,
  textEm,
} from "./header-fit";

const font = (pkg: string, family: string) => readFont(fontPath(pkg, family));
const martian = [400, 500, 600].map((w) => font("martian-mono", `MartianMono_${w}${{ 400: "Regular", 500: "Medium", 600: "SemiBold" }[w as 400 | 500 | 600]}`));
const anekLatin = [
  font("anek-latin", "AnekLatin_400Regular"),
  font("anek-latin", "AnekLatin_500Medium"),
  font("anek-latin", "AnekLatin_600SemiBold"),
];
const anekDeva = [font("anek-devanagari", "AnekDevanagari_400Regular"), font("anek-devanagari", "AnekDevanagari_600SemiBold")];

describe("font metrics behind the fit constants (a font swap must fail here)", () => {
  it("Martian Mono advances every printable ASCII glyph by MARTIAN_ADVANCE_EM", () => {
    for (const f of martian) {
      for (let c = 0x20; c < 0x7f; c++) {
        expect(f.advanceEm(String.fromCharCode(c))).toBeCloseTo(MARTIAN_ADVANCE_EM, 6);
      }
    }
  });

  it("the Anek rupee sign and true minus are never wider than RUPEE_ADVANCE_EM, and the constant is close", () => {
    for (const f of [...anekLatin, ...anekDeva]) {
      for (const ch of ["₹", "−"]) {
        const adv = f.advanceEm(ch);
        expect(adv).not.toBeNull();
        expect(adv as number).toBeLessThanOrEqual(RUPEE_ADVANCE_EM);
        expect(adv as number).toBeGreaterThan(RUPEE_ADVANCE_EM - 0.04);
      }
    }
    for (const f of martian) expect(f.advanceEm("₹")).toBeNull();
  });

  it("no Devanagari glyph is wider than DEVANAGARI_ADVANCE_EM, and the constant is close", () => {
    let widest = 0;
    for (const f of anekDeva) {
      for (const cp of f.codePoints().filter((c) => c >= 0x900 && c <= 0x97f)) {
        widest = Math.max(widest, f.advanceEm(String.fromCodePoint(cp)) ?? 0);
      }
    }
    expect(widest).toBeLessThanOrEqual(DEVANAGARI_ADVANCE_EM);
    expect(widest).toBeGreaterThan(DEVANAGARI_ADVANCE_EM - 0.03);
  });

  it("the Demo / Live labels fit LABEL_ADVANCE_EM per character, in both languages", () => {
    for (const [strings, fonts] of [
      [en.trade, anekLatin],
      [hi.trade, anekDeva],
    ] as const) {
      for (const label of [strings.demo, strings.live]) {
        const real = Math.max(...fonts.map((f) => [...label].reduce((s, ch) => s + (f.advanceEm(ch) ?? 9), 0)));
        expect(real).toBeLessThanOrEqual([...label].length * LABEL_ADVANCE_EM);
      }
    }
  });

  it("keeps a safety margin of about 3%", () => {
    expect(FIT_MARGIN).toBeGreaterThanOrEqual(1.03);
    expect(FIT_MARGIN).toBeLessThan(1.06);
  });
});

describe("isCompactWidth", () => {
  it("treats 320dp and 360dp phones as compact, 411dp as regular", () => {
    expect(isCompactWidth(320)).toBe(true);
    expect(isCompactWidth(COMPACT_WIDTH - 1)).toBe(true);
    expect(isCompactWidth(COMPACT_WIDTH)).toBe(false);
    expect(isCompactWidth(411)).toBe(false);
  });
});

describe("textEm", () => {
  it("adds the tracking to every character, drawing digits in Martian and the rupee sign in Anek", () => {
    expect(textEm("12", -0.04)).toBeCloseTo(2 * (MARTIAN_ADVANCE_EM - 0.04), 9);
    expect(textEm("₹1", -0.04)).toBeCloseTo(RUPEE_ADVANCE_EM - 0.04 + MARTIAN_ADVANCE_EM - 0.04, 9);
    expect(textEm("आ", 0)).toBe(DEVANAGARI_ADVANCE_EM);
    expect(textEm("", -0.04)).toBe(0);
  });
});

describe("fitSize", () => {
  const base = { text: "₹9,99,900.00", tracking: -0.04, base: 16, floor: 11, fontScale: 1 };

  it("keeps the base size when the figure fits", () => {
    expect(fitSize({ ...base, room: 300 })).toEqual({ size: 16, fits: true });
  });

  it("shrinks until the figure fits its room, in whole or half points", () => {
    const { size, fits } = fitSize({ ...base, room: 100 });
    expect(fits).toBe(true);
    expect(size).toBeLessThan(16);
    expect(size * 2).toBe(Math.round(size * 2));
    expect(size * textEm(base.text, base.tracking) * FIT_MARGIN).toBeLessThanOrEqual(100);
  });

  it("reports that it does not fit once the size would be under the floor", () => {
    const r = fitSize({ ...base, text: "₹99,99,99,999.00", fontScale: 1.3, room: 100 });
    expect(r.fits).toBe(false);
    expect(r.size * 1.3).toBeLessThan(11);
  });

  it("measures the floor in drawn size: a larger font scale lowers the style size, not the legibility", () => {
    const r = fitSize({ ...base, fontScale: 1.3, room: 110 });
    expect(r.fits).toBe(true);
    expect(r.size * 1.3).toBeGreaterThanOrEqual(11);
  });
});

/** The drawn width of `text` in the real fonts: Martian for ASCII, Anek for the rest, tracking included. */
function realWidth(text: string, size: number, fontScale: number, tracking: number, weight: 500 | 600, hindi: boolean): number {
  const mono = martian[weight === 600 ? 2 : 1] as (typeof martian)[number];
  const latin = anekLatin[weight === 600 ? 2 : 1] as (typeof anekLatin)[number];
  const deva = anekDeva[weight === 600 ? 1 : 0] as (typeof anekDeva)[number];
  const ui = hindi ? deva : latin;
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const adv = code < 0x80 ? mono.advanceEm(ch) : ui.advanceEm(ch);
    if (adv === null) throw new Error(`no glyph for ${ch}`);
    em += adv + tracking;
  }
  return em * size * fontScale;
}

function realRoom(windowWidth: number, fontScale: number, hasDeposit: boolean, hindi: boolean): number {
  const compact = isCompactWidth(windowWidth);
  const m = headerMetrics(compact);
  const labels = hindi ? [hi.trade.demo, hi.trade.live] : [en.trade.demo, en.trade.live];
  const fonts = hindi ? anekDeva[1] : anekLatin[2];
  const pills = hasDeposit ? labels : [labels[0] as string];
  const pillsWidth = pills.reduce((sum, label) => {
    const text = [...label].reduce((s, ch) => s + (fonts?.advanceEm(ch) ?? 9), 0) * 13 * fontScale;
    return sum + Math.max(hasDeposit ? 44 : 0, text + 2 * m.pillPad);
  }, 0);
  const items = hasDeposit ? 4 : 3;
  return windowWidth - 2 * m.padX - (items - 1) * m.gap - m.mark - (hasDeposit ? m.deposit : 0) - 6 - pillsWidth;
}

describe("fitHeader: the balance is never clipped or ellipsised", () => {
  const widths = [320, 360, 412];
  const scales = [1, 1.3];
  const balances = [
    { name: "₹9,99,900.00", figure: "₹9,99,900.00", today: ["+₹1,00,000.00", "−₹1,00,000.00"] },
    { name: "₹99,99,99,999.00", figure: "₹99,99,99,999.00", today: ["−₹99,99,99,999.00"] },
    { name: "$1,234,567.89", figure: "$1,234,567.89", today: ["+$12,345.67"] },
  ];

  for (const hindi of [false, true]) {
    for (const width of widths) {
      for (const fontScale of scales) {
        for (const b of balances) {
          it(`${hindi ? "hi" : "en"} ${width}dp x${fontScale} ${b.name}`, () => {
            const labels = hindi ? [hi.trade.demo, hi.trade.live] : [en.trade.demo, en.trade.live];
            for (const today of b.today) {
              const todayLine = hindi ? `आज ${today}` : `${today} today`;
              const fit = fitHeader({ windowWidth: width, fontScale, pillLabels: labels, hasDeposit: true, figure: b.figure, today: todayLine });
              const room = fit.stacked ? width - 2 * headerMetrics(isCompactWidth(width)).padX : realRoom(width, fontScale, true, hindi);
              expect(realWidth(b.figure, fit.figureSize, fontScale, FIGURE.tracking, 600, hindi)).toBeLessThanOrEqual(room);
              expect(fit.todaySize).not.toBeNull();
              expect(realWidth(todayLine, fit.todaySize as number, fontScale, TODAY.tracking, 500, hindi)).toBeLessThanOrEqual(room);
            }
          });
        }
      }
    }
  }

  it("keeps one row at the common widths and font scale", () => {
    const labels = [en.trade.demo, en.trade.live];
    for (const width of [360, 412]) {
      const fit = fitHeader({ windowWidth: width, fontScale: 1, pillLabels: labels, hasDeposit: true, figure: "₹9,99,900.00", today: "+₹186.00 today" });
      expect(fit.stacked).toBe(false);
      expect(fit.figureSize).toBe(16);
    }
  });

  it("shrinks inside one row at 320dp for the ₹9,99,900.00 case", () => {
    const fit = fitHeader({ windowWidth: 320, fontScale: 1, pillLabels: [en.trade.demo, en.trade.live], hasDeposit: true, figure: "₹9,99,900.00", today: null });
    expect(fit.stacked).toBe(false);
    expect(fit.figureSize).toBeLessThan(16);
    expect(fit.figureSize).toBeGreaterThanOrEqual(11);
  });

  it("moves the balance to a second row when it cannot fit in the row at a legible size", () => {
    const fit = fitHeader({ windowWidth: 320, fontScale: 1.3, pillLabels: [en.trade.demo, en.trade.live], hasDeposit: true, figure: "₹99,99,99,999.00", today: null });
    expect(fit.stacked).toBe(true);
    expect(fit.figureSize * 1.3).toBeGreaterThanOrEqual(11);
  });

  it("stacks when only the today line cannot fit", () => {
    const fit = fitHeader({
      windowWidth: 320,
      fontScale: 1.3,
      pillLabels: [en.trade.demo, en.trade.live],
      hasDeposit: true,
      figure: "₹1.00",
      today: "−₹99,99,99,999.00 today",
    });
    expect(fit.stacked).toBe(true);
  });

  it("handles the stale header (one pill, no deposit button)", () => {
    const fit = fitHeader({ windowWidth: 320, fontScale: 1, pillLabels: [en.trade.live], hasDeposit: false, figure: "₹99,99,99,999.00", today: null });
    const room = fit.stacked ? 320 - 16 : realRoom(320, 1, false, false);
    expect(realWidth("₹99,99,99,999.00", fit.figureSize, 1, FIGURE.tracking, 600, false)).toBeLessThanOrEqual(room);
  });

  it("stays inside the second row even at an enormous font scale", () => {
    const fit = fitHeader({ windowWidth: 320, fontScale: 2, pillLabels: [en.trade.demo, en.trade.live], hasDeposit: true, figure: "₹99,99,99,999.00", today: "−₹99,99,99,999.00 today" });
    expect(fit.stacked).toBe(true);
    expect(realWidth("₹99,99,99,999.00", fit.figureSize, 2, FIGURE.tracking, 600, false)).toBeLessThanOrEqual(320 - 16);
  });
});

describe("estimates against widths measured on a device (Android emulator, 411dp, font scale 1)", () => {
  it("the Hindi today line \"आज +₹172.00\" at 10dp measured 73.5dp: the estimate counts the prefix and stays above it", () => {
    const estimate = textEm("आज +₹172.00", TODAY.tracking) * FIT_MARGIN * 10;
    expect(estimate).toBeGreaterThanOrEqual(73.5);
    // and the prefix really is counted: without it the estimate would sit under the measured width
    expect(textEm("+₹172.00", TODAY.tracking) * FIT_MARGIN * 10).toBeLessThan(73.5);
  });

  it("the Hindi Demo / Live pills measured 43.8 and 51.8dp wide: the estimate is never narrower", () => {
    expect(pillWidth(hi.trade.demo, 1, headerMetrics(false).pillPad, 44)).toBeGreaterThanOrEqual(43.8);
    expect(pillWidth(hi.trade.live, 1, headerMetrics(false).pillPad, 44)).toBeGreaterThanOrEqual(51.8);
  });
});

describe("FILL_RIGHT", () => {
  it("makes a header figure fill its column and right-align, so its width never rests on the platform's text measure", () => {
    expect(FILL_RIGHT).toEqual({ alignSelf: "stretch", textAlign: "right" });
  });
});
