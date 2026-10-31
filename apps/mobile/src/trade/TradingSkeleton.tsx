import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, AppState, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Skeleton, Txt } from "@/theme/ui";
import { color } from "@/theme/tokens";
/** One native opacity animation; no JS frame loop, no animation in background or reduced motion. */
export function TradingSkeleton() {
  const { t } = useTranslation();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let reduced = true;
    let alive = true;
    let loop: Animated.CompositeAnimation | undefined;
    const sync = () => {
      loop?.stop(); opacity.setValue(1);
      if (!alive || reduced || AppState.currentState !== "active") return;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true, isInteraction: false }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true, isInteraction: false }),
      ])); loop.start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) { reduced = value; sync(); } });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", value => { reduced = value; sync(); });
    const app = AppState.addEventListener("change", sync);
    return () => { alive = false; loop?.stop(); motion.remove(); app.remove(); };
  }, [opacity]);
  return <View accessibilityRole="progressbar" accessibilityLabel={t("redesign.loading")} style={{ flex: 1, padding: 20, justifyContent: "space-between" }}>
    <Animated.View style={{ opacity, gap: 16 }}><Skeleton width="42%" height={24} /><Skeleton width="25%" height={12} /></Animated.View>
    <Txt size={13} color={color.ink3} style={{ textAlign: "center" }}>{t("redesign.loading")}</Txt>
    <Animated.View style={{ opacity, gap: 12 }}><Skeleton height={64} /><Skeleton height={44} /></Animated.View>
  </View>;
}
