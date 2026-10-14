import { color } from "@/theme/tokens";
import { FigText, type FigTextProps } from "./FigText";

/**
 * A money figure. `text` comes from money() (any "+" / "−" prefix already applied, or a whole "today ₹93" line).
 * Digits are Martian Mono; ₹, Hindi words and the true minus are Anek (see FigText).
 */
export function Money({ size = 15, weight = 600, color: ink = color.ink, tracking = -0.02, ...rest }: FigTextProps) {
  return <FigText {...rest} size={size} weight={weight} color={ink} tracking={tracking} />;
}
