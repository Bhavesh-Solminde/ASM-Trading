/** Bundled weights. Canvas weights 620/650 render as 600 (see nearestWeight). */
export type Weight = 400 | 500 | 600;
export type Script = "latin" | "devanagari";

const LATIN: Record<Weight, string> = { 400: "AnekLatin_400Regular", 500: "AnekLatin_500Medium", 600: "AnekLatin_600SemiBold" };
/** Each Devanagari weight is ~414 KB, so only Regular and SemiBold ship; Medium falls back to Regular. */
const DEVANAGARI: Record<Weight, string> = {
  400: "AnekDevanagari_400Regular",
  500: "AnekDevanagari_400Regular",
  600: "AnekDevanagari_600SemiBold",
};
const FIGURES: Record<Weight, string> = { 400: "MartianMono_400Regular", 500: "MartianMono_500Medium", 600: "MartianMono_600SemiBold" };

export function scriptFor(language: string | undefined): Script {
  return language?.toLowerCase().startsWith("hi") ? "devanagari" : "latin";
}

/** Family for UI text. Anek Devanagari also carries Latin letters and ₹, so Hindi screens use it for everything. */
export function uiFamily(weight: Weight, script: Script): string {
  return (script === "devanagari" ? DEVANAGARI : LATIN)[weight];
}

/**
 * Family for a TextInput. Latin is the system sans (undefined), like `Txt`; Devanagari stays bundled Anek.
 * Pair with `inputWeight`: without a family the weight is what picks the face.
 */
export function inputFamily(weight: Weight, script: Script): string | undefined {
  return script === "devanagari" ? uiFamily(weight, script) : undefined;
}

/** `fontWeight` for a TextInput whose `inputFamily` is undefined; undefined when a bundled family carries the weight. */
export function inputWeight(family: string | undefined, weight: Weight): "400" | "500" | "600" | undefined {
  return family === undefined ? (String(weight) as "400" | "500" | "600") : undefined;
}

/** Family for figures (money, prices, times). Martian Mono has no ₹: <Money> sets the symbol in Anek. */
export function figFamily(weight: Weight): string {
  return FIGURES[weight];
}

export function nearestWeight(css: number): Weight {
  return css >= 590 ? 600 : css >= 490 ? 500 : 400;
}

export const FONT_FAMILIES: readonly string[] = [...new Set([...Object.values(LATIN), ...Object.values(DEVANAGARI), ...Object.values(FIGURES)])];
