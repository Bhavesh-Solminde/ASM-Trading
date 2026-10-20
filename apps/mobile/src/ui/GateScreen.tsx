import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, radius } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";
import { BrandMark } from "./Brand";
import { FigText } from "./FigText";

/**
 * Shared layout for the full-screen gates (maintenance, VPN block, forced update): what happened, an optional
 * facts card, and one action at the bottom.
 */
export function GateScreen({
  title,
  body,
  info,
  children,
  testID,
}: {
  title: string;
  body: string;
  info?: { label: string; value: string; strong?: boolean }[];
  children?: ReactNode;
  /** Stable handle for end-to-end tests, on the title. */
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Screen style={{ paddingHorizontal: 20, paddingBottom: 28 + insets.bottom }}>
      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        <BrandMark width={76} />
        <Txt weight={600} size={28} lineHeight={32} accessibilityRole="header" testID={testID}>
          {title}
        </Txt>
        <Txt size={16} color={color.ink2}>
          {body}
        </Txt>
        {info && info.length > 0 ? (
          <View
            style={{
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: color.ruleSoft,
              backgroundColor: color.surface,
              gap: 8,
            }}
          >
            {info.map((row) => (
              <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 24 }}>
                <Txt size={15} color={color.ink3} style={{ flex: 1 }}>
                  {row.label}
                </Txt>
                <FigText text={row.value} size={15} weight={row.strong ? 600 : 400} style={{ flexShrink: 0 }} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}
