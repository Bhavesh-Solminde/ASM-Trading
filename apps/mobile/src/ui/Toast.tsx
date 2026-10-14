import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { color, radius, space } from "@/theme/tokens";
import { OFFLINE_BANNER_HEIGHT, useOfflineVisible } from "./OfflineBanner";

type ToastItem = { id: number; message: string; tone: "neutral" | "up" | "down" };

let nextId = 0;

const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, "id">) => void; drop: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (t) => set((s) => ({ items: [...s.items.slice(-2), { ...t, id: ++nextId }] })),
    drop: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  }),
);

export function toast(message: string, tone: ToastItem["tone"] = "neutral") {
  useToasts.getState().push({ message, tone });
}

/** Drops every queued toast: one user's results must not show on the next screen after sign-out. */
export function clearToasts() {
  useToasts.setState({ items: [] });
}

function ToastRow({ item }: { item: ToastItem }) {
  const drop = useToasts((s) => s.drop);
  useEffect(() => {
    const timer = setTimeout(() => drop(item.id), 3500);
    return () => clearTimeout(timer);
  }, [drop, item.id]);
  const border = item.tone === "up" ? color.up : item.tone === "down" ? color.down : color.rule;
  return (
    <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={[styles.toast, { borderColor: border }]}>
      <Text testID="toast" style={styles.text}>
        {item.message}
      </Text>
    </Animated.View>
  );
}

export function ToastHost() {
  const items = useToasts((s) => s.items);
  const insets = useSafeAreaInsets();
  // Below the status bar, and below the offline strip when it shows.
  const top = insets.top + space(2) + (useOfflineVisible() ? OFFLINE_BANNER_HEIGHT : 0);
  return (
    <View pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.host, { top }]}>
      {items.map((i) => (
        <ToastRow key={i.id} item={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: space(4), right: space(4), gap: space(2) },
  toast: { backgroundColor: color.panel, borderWidth: 1, borderRadius: radius.md, padding: space(3) },
  text: { color: color.ink, fontSize: 14 },
});
