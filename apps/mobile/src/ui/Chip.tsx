import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import type { Script } from "@/theme/font-families";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { chipA11yState, chipHitSlop } from "./chip-metrics";
import { FigText } from "./FigText";

/**
 * Pill choice used for expiry, quick amounts, categories, segments and the language switch. Selected = white
 * fill with ground text (blue is kept for actions that move money). A pill shorter than 44pt gets hitSlop.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  height = 40,
  figures = false,
  size = 14,
  count,
  testID,
  accessibilityLabel,
  style,
  script,
  role = "button",
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  height?: number;
  /** Figure label (amounts): digits in Martian Mono, ₹ and Hindi in Anek (via FigText). */
  figures?: boolean;
  size?: number;
  /** Small trailing count ("Open 0"). */
  count?: number;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  script?: Script;
  role?: "button" | "tab" | "radio";
  disabled?: boolean;
}) {
  const slop = chipHitSlop(height);
  const ink = selected ? color.ground : color.ink2;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? (count !== undefined ? `${label}, ${count}` : label)}
      accessibilityState={chipA11yState(role, selected, disabled)}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop }}
      style={({ pressed }) => [
        {
          height,
          paddingHorizontal: 12,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: selected ? color.ink : color.rule,
          backgroundColor: selected ? color.ink : pressed ? color.raised : "transparent",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {figures ? (
        <FigText text={label} weight={selected ? 600 : 500} size={size} tracking={-0.03} color={ink} script={script} numberOfLines={1} adjustsFontSizeToFit />
      ) : (
        <Txt weight={selected ? 600 : 500} size={size} color={ink} script={script} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </Txt>
      )}
      {count !== undefined ? (
        <Txt font="fig" size={12} color={ink}>
          {count}
        </Txt>
      ) : null}
    </Pressable>
  );
}
