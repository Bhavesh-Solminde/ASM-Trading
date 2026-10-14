import { Link, type Href } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, type TextInputProps } from "react-native";
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

/** Centered, keyboard-friendly column for the auth screens. */
export function FormScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {children}
    </ScrollView>
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
