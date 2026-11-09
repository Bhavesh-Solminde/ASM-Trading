import { View } from "react-native";
import type { Tone } from "@asm/client-core";
import { tagInkKey } from "@/payments/status-tone";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

/**
 * A small status chip: the label in its tone's colour on `raised`. Status is always a word, never only a colour.
 * One line that ellipsizes (a wrapped Hindi label would fatten every row). `gold` is not a tone: it is bonus-only.
 */
export function StatusTag({ tone, label, testID, align = "flex-start" }: { tone: Tone; label: string; testID?: string; align?: "flex-start" | "flex-end" | "center" }) {
  return (
    <View testID={testID} accessible accessibilityLabel={label} style={{ alignSelf: align, maxWidth: "100%", borderRadius: 6, backgroundColor: color.raised, paddingVertical: 3, paddingHorizontal: 8 }}>
      <Txt size={12} weight={600} lineHeight={16} color={color[tagInkKey(tone)]} numberOfLines={1}>{label}</Txt>
    </View>
  );
}
