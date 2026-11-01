import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import type { FigTextProps } from "./FigText";
/** R5 balances use clean sans figures with stable digit widths and native currency glyphs. */
export function Money({ text, size = 15, weight = 600, color: ink = color.ink, tracking = -0.02, style, ...rest }: FigTextProps) {
  return <Txt {...rest} size={size} weight={weight} color={ink} tracking={tracking} style={[{ fontVariant: ["tabular-nums"] }, style]}>{text}</Txt>;
}
