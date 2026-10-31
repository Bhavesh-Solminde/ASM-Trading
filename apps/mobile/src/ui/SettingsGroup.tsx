import type { ReactNode } from "react";
import { View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

/** A titled block of `SettingsRow`s on the Account hub: a 14/500 `ink3` heading, then the rows. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Txt accessibilityRole="header" size={14} weight={500} color={color.ink3} style={{ marginBottom: 4 }}>
        {title}
      </Txt>
      {children}
    </View>
  );
}
