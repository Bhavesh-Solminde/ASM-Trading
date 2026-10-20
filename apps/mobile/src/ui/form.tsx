import { Link, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, radius } from "@/theme/tokens";
import { Txt, useUiFamily } from "@/theme/ui";
import { Icon } from "./Icon";

/** Text input with its label above (visible while typing). Focus: blue border + 3pt ring. */
// A caller's `style` is overridden by ours (set after the spread): every field looks the same.
export function Field({ label, trailing, onFocus, onBlur, ...rest }: TextInputProps & { label: string; trailing?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const family = useUiFamily(400);
  return (
    <View style={{ gap: 6 }}>
      {/* The input carries the label for screen readers; the visible copy must not be a second stop. */}
      <Txt size={14} weight={500} color={color.ink2} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Txt>
      <View style={{ margin: -3, borderWidth: 3, borderRadius: radius.md + 3, borderColor: focused ? color.accentDim : "transparent" }}>
        <TextInput
          {...rest}
          accessibilityLabel={label}
          placeholderTextColor={color.ink3}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={{
            minHeight: 52,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: focused ? color.accent : color.rule,
            backgroundColor: color.surface,
            color: color.ink,
            paddingLeft: 14,
            paddingRight: trailing ? 48 : 14,
            fontSize: 16,
            fontFamily: family,
          }}
        />
        {trailing ? <View style={{ position: "absolute", right: 4, top: 4 }}>{trailing}</View> : null}
      </View>
    </View>
  );
}

/** Password field with a show/hide eye. */
export function PasswordField(props: Omit<TextInputProps, "secureTextEntry"> & { label: string }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <Field
      {...props}
      secureTextEntry={!shown}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shown ? t("auth.hidePassword") : t("auth.showPassword")}
          onPress={() => setShown((v) => !v)}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name={shown ? "eyeOff" : "eye"} size={20} color={color.ink3} />
        </Pressable>
      }
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

/** Keyboard-friendly column for the auth screens; shrinks above the keyboard. `top`: brand-first layout (login). */
export function FormScroll({ children, top = false }: { children: ReactNode; top?: boolean }) {
  const keyboard = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  // Edge-to-edge (SDK 36): with the keyboard hidden, keep the last control (the language pills, the last link)
  // above the system navigation bar. The keyboard, when up, already covers that bar.
  return (
    <View style={{ flex: 1, paddingBottom: keyboard > 0 ? keyboard : insets.bottom }}>
      <ScrollView contentContainerStyle={top ? styles.top : styles.wrap} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
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
        <Txt size={14} color={color.accentText}>
          {label}
        </Txt>
      </Pressable>
    </Link>
  );
}

export const formStyles = StyleSheet.create({
  /** Error text colour. `downText` (7:1 on surface); `down` is fill/stroke only. */
  error: { color: color.downText },
  /** Room for two lines of message so the layout below does not move when one appears. */
  messageSlot: { minHeight: 40 },
  links: { marginTop: 8 },
});

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, padding: 20, gap: 14, justifyContent: "center" },
  top: { flexGrow: 1, paddingTop: 12 },
  link: { minHeight: 44, justifyContent: "center" },
});
