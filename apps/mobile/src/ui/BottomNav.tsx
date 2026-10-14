import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon, type IconName } from "./Icon";

export type { BottomTabBarProps };

const ICONS: Record<string, IconName> = { trade: "trade", payments: "wallet", history: "history", account: "user" };

/** Height of the tab row above the bottom inset: 30pt pill + 2pt gap + 16pt label. */
export const BOTTOM_NAV_ROW = 48;

/** 48pt bottom nav (canvas): active tab = blue pill behind the icon + bold label. Adds the bottom safe-area inset. */
export function BottomNav({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        paddingBottom: Math.max(insets.bottom, 4),
        borderTopWidth: 1,
        borderTopColor: color.ruleSoft,
        backgroundColor: color.ground,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const title = descriptors[route.key]?.options.title;
        const label = typeof title === "string" ? title : route.name;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            style={{ flex: 1, height: BOTTOM_NAV_ROW, alignItems: "center", justifyContent: "center", gap: 2 }}
          >
            <View
              style={{
                width: 64,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: focused ? color.accentDim : "transparent",
              }}
            >
              <Icon name={ICONS[route.name] ?? "trade"} size={20} color={focused ? color.accentText : color.ink3} />
            </View>
            <Txt size={12} weight={focused ? 600 : 400} lineHeight={16} color={focused ? color.ink : color.ink3} numberOfLines={1}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
