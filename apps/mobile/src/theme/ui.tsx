import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, font, radius, space } from "./tokens";

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={["top", "left", "right"]}>
      {children}
    </SafeAreaView>
  );
}

export function Txt({ variant = "regular", style, ...rest }: TextProps & { variant?: "regular" | "small" | "title" }) {
  return <Text {...rest} style={[font[variant], style]} />;
}

type ButtonKind = "primary" | "secondary" | "up" | "down";

const FILL: Record<ButtonKind, string> = {
  primary: color.brandFill,
  secondary: color.tile,
  up: color.up,
  down: color.down,
};

/** Label colour per fill: white on green fails contrast, so `up` uses its dark ink. */
const INK: Record<ButtonKind, string> = {
  primary: color.brandInk,
  secondary: color.ink,
  up: color.upInk,
  down: color.downInk,
};

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  busy,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  /** Stable handle for end-to-end tests. */
  testID?: string;
}) {
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
        { backgroundColor: FILL[kind], opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={INK[kind]} /> : <Text style={[styles.buttonText, { color: INK[kind] }]}>{label}</Text>}
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
  return <View style={{ height, width, borderRadius: radius.sm, backgroundColor: color.tile }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(4),
  },
  buttonText: { fontSize: 16, fontWeight: "700" },
  card: { backgroundColor: color.panel, borderRadius: radius.lg, padding: space(4) },
  row: { flexDirection: "row", alignItems: "center" },
});
