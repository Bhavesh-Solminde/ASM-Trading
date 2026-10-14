import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { space } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";

/** Shared layout for the full-screen gates (maintenance, VPN block, forced update). */
export function GateScreen({
  title,
  body,
  children,
  testID,
}: {
  title: string;
  body: string;
  children?: ReactNode;
  /** Stable handle for end-to-end tests, on the title. */
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Screen style={{ padding: space(6), paddingBottom: space(6) + insets.bottom, justifyContent: "center", gap: space(3) }}>
      <Txt variant="title" accessibilityRole="header" testID={testID}>
        {title}
      </Txt>
      <Txt>{body}</Txt>
      {children}
    </Screen>
  );
}
