import { Link, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { Txt } from "@/theme/ui";
import { color, radius, space } from "@/theme/tokens";

/** Labelled text input (the label is the placeholder, mirrored for screen readers). */
export function Field({ label, ...rest }: TextInputProps & { label: string }) {
  return (
    <TextInput
      {...rest}
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={color.ink2}
      style={styles.input}
    />
  );
}

/**
 * Height of the soft keyboard (0 when hidden). Android 15 edge-to-edge ignores `adjustResize`, so
 * the window no longer shrinks; screens that hold inputs must make room themselves.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** Centered, keyboard-friendly column for the auth screens; shrinks above the keyboard so every control stays reachable. */
export function FormScroll({ children }: { children: ReactNode }) {
  const keyboard = useKeyboardHeight();
  return (
    <View style={{ flex: 1, paddingBottom: keyboard }}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** Text link with a 44pt+ touch target. */
export function TextLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} style={styles.link}>
        <Txt variant="small">{label}</Txt>
      </Pressable>
    </Link>
  );
}

export const formStyles = StyleSheet.create({
  error: { color: color.down },
  /** Room for two lines of message so the layout below does not move when one appears. */
  messageSlot: { minHeight: 40 },
  links: { marginTop: space(2) },
});

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, padding: space(5), gap: space(3), justifyContent: "center" },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: color.tile,
    color: color.ink,
    paddingHorizontal: space(4),
    fontSize: 16,
  },
  link: { minHeight: 44, justifyContent: "center", paddingVertical: space(1) },
});
