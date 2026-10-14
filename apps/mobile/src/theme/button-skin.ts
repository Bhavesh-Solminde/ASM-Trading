import type { Weight } from "./font-families";
import { color } from "./tokens";

export type ButtonKind = "primary" | "light" | "secondary" | "text";

/** primary = money-moving action (accent); light = neutral confirm ("Done"); secondary = outlined; text = quiet link. */
export const BUTTON_SKIN: Record<ButtonKind, { bg: string; ink: string; border: string; height: number; weight: Weight; size: number }> = {
  primary: { bg: color.accent, ink: color.onAccent, border: color.accent, height: 54, weight: 600, size: 17 },
  light: { bg: color.ink, ink: color.ground, border: color.ink, height: 54, weight: 600, size: 17 },
  secondary: { bg: "transparent", ink: color.ink, border: color.rule, height: 54, weight: 600, size: 17 },
  text: { bg: "transparent", ink: color.accentText, border: "transparent", height: 48, weight: 500, size: 16 },
};
