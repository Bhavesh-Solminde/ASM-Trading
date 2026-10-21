import { Pressable } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon, type IconName } from "./Icon";

/**
 * One Account-style row: an 18pt icon, the title (`flex: 1`), an optional value that never shrinks, a chevron and a
 * bottom rule. At least 56pt tall.
 */
export function SettingsRow({ icon, title, value, onPress, testID }: { icon: IconName; title: string; value?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: color.rule, opacity: pressed ? 0.85 : 1 })}
    >
      <Icon name={icon} size={18} color={color.ink2} />
      <Txt style={{ flex: 1 }}>{title}</Txt>
      {value ? <Txt size={12} color={color.ink2} style={{ flexShrink: 0 }}>{value}</Txt> : null}
      <Icon name="chevron" size={16} color={color.ink3} />
    </Pressable>
  );
}
