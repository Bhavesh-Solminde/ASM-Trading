import { usePathname } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useSession } from "@/auth/session-store";
import { useGate } from "@/gate/gate-store";
import { routeFor } from "@/gate/route-for";
import { useBelowMin } from "@/gate/use-below-min";
import { useAppStatus } from "@/lock/app-state";
import { useLock } from "@/lock/lock-store";
import { lockRouteReached, shouldCover } from "@/lock/privacy-cover";
import { color } from "@/theme/tokens";
import splash from "../../assets/splash.png";

/**
 * How long the cover outlives the arrival on /lock. `DismissSheetsOnLock` closes every open sheet the moment
 * the app relocks, but a sheet's close animation (about 250ms) can still be running when /lock mounts, and the
 * sheets live in a portal above the Stack. This keeps the cover over them until they are gone.
 */
export const SHEET_DISMISS_MS = 400;

/**
 * Whether the privacy cover is showing. Reads the same state the Gatekeeper routes from, so "relocked but
 * /lock not reached yet" is derived in the same render the lock flips in: there is no frame in between.
 */
export function usePrivacyCovered(): boolean {
  const appState = useAppStatus((s) => s.appState);
  const lockEnabled = useLock((s) => s.enabled);
  const locked = useLock((s) => s.locked);
  const ready = useSession((s) => s.ready);
  const token = useSession((s) => s.token);
  const gate = useGate((s) => s.gate);
  const belowMin = useBelowMin();
  const pathname = usePathname();

  // `lockChosen` only matters once `locked` is false, and then the answer is not /lock either way.
  const target = routeFor({ ready, token, locked, lockChosen: true, gate, belowMin });
  const wanted = shouldCover({ appState, lockEnabled, locked, onLockRoute: lockRouteReached(target, pathname) });
  const relocking = wanted && appState !== "background" && appState !== "inactive";

  // Leaving "relocking" because /lock was reached: hold on for the sheets' close animation. State set during
  // render is applied before the frame is committed, so the cover does not blink in between.
  const [wasRelocking, setWasRelocking] = useState(false);
  const [lingering, setLingering] = useState(false);
  if (wasRelocking !== relocking) {
    setWasRelocking(relocking);
    if (wasRelocking && !wanted) setLingering(true);
  }
  useEffect(() => {
    if (!lingering) return;
    const id = setTimeout(() => setLingering(false), SHEET_DISMISS_MS);
    return () => clearTimeout(id);
  }, [lingering]);

  return wanted || lingering;
}

/**
 * Wraps the whole app and draws the privacy cover as its LAST sibling, so it sits above the Stack, the bottom
 * sheets (they render in the sheet provider's portal, inside `children`) and the toasts. While it is up the
 * content beneath is hidden from accessibility services, so a screen reader cannot read the account out.
 */
export function PrivacyShield({ children }: { children: ReactNode }) {
  const covered = usePrivacyCovered();
  return (
    <View style={styles.fill}>
      <View
        style={styles.fill}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {/*
        Always mounted (just transparent when idle) so the logo is already decoded when the cover has to appear
        in the single frame before the OS snapshots the window. Decorative and not interactive; hidden from
        accessibility either way.
      */}
      <View
        testID="privacy-cover"
        pointerEvents={covered ? "auto" : "none"}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.cover, { opacity: covered ? 1 : 0 }]}
      >
        <Image source={splash} resizeMode="contain" accessibilityIgnoresInvertColors style={styles.logo} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.ground },
  cover: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: color.ground,
    alignItems: "center",
    justifyContent: "center",
  },
  // Same artwork and width as the native splash (app.config.ts imageWidth 200; the file is 175x120).
  logo: { width: 200, height: (200 * 120) / 175 },
});
