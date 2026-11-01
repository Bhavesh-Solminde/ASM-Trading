import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon } from "./Icon";

/** Back one screen, or to Payments when this screen was opened cold (a deep link has nothing to go back to). */
function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/payments");
}

/**
 * The flow screens' header: a 44pt rounded `raised` button and a 21/600 title. The title takes the room the button
 * and `aside` leave (`flex: 1`, up to two lines) so a long Hindi title wraps rather than pushing `aside` off.
 */
export function BackHeader({
  title,
  onBack = goBack,
  icon = "arrowLeft",
  aside,
  testID,
}: {
  title: string;
  onBack?: () => void;
  icon?: "arrowLeft" | "close";
  aside?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 44 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t(icon === "close" ? "common.close" : "common.back")}
        onPress={onBack}
        style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 12, backgroundColor: color.raised, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1 })}
      >
        <Icon name={icon} size={21} color={color.ink} />
      </Pressable>
      <Txt accessibilityRole="header" size={21} weight={600} numberOfLines={2} style={{ flex: 1 }}>
        {title}
      </Txt>
      {aside ? <View style={{ flexShrink: 0 }}>{aside}</View> : null}
    </View>
  );
}
