import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "react-native-safe-area-context";
import { OFFLINE_BANNER_HEIGHT, useOfflineVisible } from "@/ui/OfflineBanner";
import { screenTopPadding } from "./screen-padding";
import { Icon, type IconName } from "@/ui/Icon";
import { BUTTON_SKIN, type ButtonKind } from "./button-skin";
import { figFamily, scriptFor, uiFamily, type Script, type Weight } from "./font-families";
import { color, radius, space } from "./tokens";

/**
 * Makes room for the "No connection" strip while it shows. `bleedTop`: the screen draws its own header under
 * the status bar (the Trade tab's AppHeader handles the inset and the strip itself).
 */
export function Screen({ children, style, bleedTop = false }: { children: ReactNode; style?: ViewStyle; bleedTop?: boolean }) {
  const offline = useOfflineVisible();
  const own = StyleSheet.flatten(style);
  const paddingTop = bleedTop ? screenTopPadding(own, false, 0) : screenTopPadding(own, offline, OFFLINE_BANNER_HEIGHT);
  return (
    <SafeAreaView style={[styles.screen, style, { paddingTop }]} edges={bleedTop ? ["left", "right"] : ["top", "left", "right"]}>
      {children}
    </SafeAreaView>
  );
}

const VARIANT = {
  regular: { size: 14, weight: 400, color: color.ink },
  small: { size: 12, weight: 400, color: color.ink2 },
  title: { size: 20, weight: 600, color: color.ink },
} as const satisfies Record<string, { size: number; weight: Weight; color: string }>;

export type TxtProps = TextProps & {
  /** Legacy presets; prefer size/weight/color. */
  variant?: keyof typeof VARIANT;
  /** "ui" = Anek (Latin or Devanagari by language), "fig" = Martian Mono. */
  font?: "ui" | "fig";
  weight?: Weight;
  size?: number;
  color?: string;
  /** Letter-spacing in em, as on the canvas (-0.02 = -0.02em). */
  tracking?: number;
  lineHeight?: number;
  /** Force a script (the language switch shows हिन्दी in Devanagari on an English screen). */
  script?: Script;
};

/** The one text primitive: picks the bundled family by weight and the current language. Never sets fontWeight. */
export function Txt({ variant, font: kind = "ui", weight, size, color: ink, tracking, lineHeight, script, style, ...rest }: TxtProps) {
  const { i18n } = useTranslation();
  const base = variant ? VARIANT[variant] : undefined;
  const w = weight ?? base?.weight ?? 400;
  const s = size ?? base?.size ?? 14;
  const sc = script ?? scriptFor(i18n.language);
  const family = kind === "fig" ? figFamily(w) : uiFamily(w, sc);
  const lh = lineHeight ?? Math.round(s * (kind === "ui" && sc === "devanagari" ? 1.5 : 1.3));
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: family, fontSize: s, lineHeight: lh, color: ink ?? base?.color ?? color.ink },
        tracking !== undefined ? { letterSpacing: tracking * s } : null,
        style,
      ]}
    />
  );
}

/** Font family for a TextInput (inputs cannot use <Txt>). */
export function useUiFamily(weight: Weight): string {
  const { i18n } = useTranslation();
  return uiFamily(weight, scriptFor(i18n.language));
}

export type { ButtonKind };

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  busy,
  testID,
  icon,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  /** Stable handle for end-to-end tests. */
  testID?: string;
  icon?: IconName;
}) {
  const s = BUTTON_SKIN[kind];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { minHeight: s.height, backgroundColor: s.bg, borderColor: s.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={s.ink} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={s.ink} strokeWidth={2} /> : null}
          <Txt weight={s.weight} size={s.size} color={s.ink} numberOfLines={1}>
            {label}
          </Txt>
        </>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | `${number}%` }) {
  return <View style={{ height, width, borderRadius: radius.sm, backgroundColor: color.raised }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space(2),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(4),
  },
  card: { backgroundColor: color.panel, borderRadius: radius.lg, padding: space(4) },
  row: { flexDirection: "row", alignItems: "center" },
});
