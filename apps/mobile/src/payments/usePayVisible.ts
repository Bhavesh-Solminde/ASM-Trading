import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useSessionLive } from "@/auth/use-session-live";
import { useAppStatus } from "@/lock/app-state";

/**
 * Whether the pay screen is being looked at: focused (not covered by the claim screen or another tab), the app in
 * front, and the session live (a relock makes it false until unlock). Everything that polls for the pay screen is
 * gated on this, so the clocks stop together and start together.
 */
export function usePayVisible(): boolean {
  const sessionLive = useSessionLive();
  const appActive = useAppStatus((s) => s.appState === "active");
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused && appActive && sessionLive;
}
