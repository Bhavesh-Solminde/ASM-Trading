import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { scriptFor } from "@/theme/font-families";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

const TONE = { up: color.up, down: color.downText, gold: color.gold, accent: color.accentText, muted: color.ink3 } as const;

/**
 * Rubber stamp (Won, Lost, Next, Bonus): a 1.5pt border inside a 1pt outline 2pt away, uppercase Martian Mono.
 * Results are stamped, never only coloured. Hindi has no case and Martian has no Devanagari, so Hindi labels use
 * the UI family as-is.
 */
export function Stamp({ label, tone, size = "sm" }: { label: string; tone: keyof typeof TONE; size?: "sm" | "md" }) {
  const { i18n } = useTranslation();
  const hindi = scriptFor(i18n.language) === "devanagari";
  const c = TONE[tone];
  const md = size === "md";
  return (
    <View accessible accessibilityLabel={label} style={{ borderWidth: 1, borderColor: c, borderRadius: 5, padding: 2 }}>
      <View style={{ borderWidth: 1.5, borderColor: c, borderRadius: 3, paddingHorizontal: md ? 7 : 6, paddingVertical: md ? 2 : 1 }}>
        <Txt font={hindi ? "ui" : "fig"} weight={600} size={md ? 11 : 10} tracking={md ? 0.06 : 0.08} lineHeight={md ? 14 : 13} color={c}>
          {label.toUpperCase()}
        </Txt>
      </View>
    </View>
  );
}
