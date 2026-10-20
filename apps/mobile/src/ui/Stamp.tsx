import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { scriptFor } from "@/theme/font-families";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

/** 2pt gap + the 1pt outline line itself. */
const OUTLINE_OFFSET = 3;

const TONE = { up: color.up, down: color.downText, gold: color.gold, accent: color.accentText, muted: color.ink3 } as const;

/**
 * Rubber stamp (Won, Lost, Next, Bonus): a 1.5pt border with a 1pt outline 2pt outside it, uppercase Martian Mono.
 * As on the canvas (CSS `outline`) the outline takes no layout space: the stamp's footprint is the inner box,
 * so it sits flush with its column edge and the outline hangs 3pt past it. Keep 3pt of room beside a stamp
 * that must not be clipped. Results are stamped, never only coloured. Hindi has no case and Martian has no
 * Devanagari, so Hindi labels use the UI family as-is.
 */
export function Stamp({ label, tone, size = "sm" }: { label: string; tone: keyof typeof TONE; size?: "sm" | "md" }) {
  const { i18n } = useTranslation();
  const hindi = scriptFor(i18n.language) === "devanagari";
  const c = TONE[tone];
  const md = size === "md";
  return (
    <View accessible accessibilityLabel={label}>
      <View style={{ borderWidth: 1.5, borderColor: c, borderRadius: 3, paddingHorizontal: md ? 7 : 6, paddingVertical: md ? 2 : 1 }}>
        {/* One line that shrinks rather than wraps: a stamp is a single word-group, and a wrapped second line is cut off. */}
        <Txt
          font={hindi ? "ui" : "fig"}
          weight={600}
          size={md ? 11 : 10}
          tracking={md ? 0.06 : 0.08}
          lineHeight={md ? 14 : 13}
          color={c}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {label.toUpperCase()}
        </Txt>
      </View>
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: -OUTLINE_OFFSET, left: -OUTLINE_OFFSET, right: -OUTLINE_OFFSET, bottom: -OUTLINE_OFFSET, borderWidth: 1, borderColor: c, borderRadius: 6 }}
      />
    </View>
  );
}
