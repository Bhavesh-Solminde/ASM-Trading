import { compareVersions } from "@asm/client-core";
import { router, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useAppConfig } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { appConfig } from "@/config";
import { useLock } from "@/lock/lock-store";
import { useGate } from "./gate-store";
import { redirectFor, routeFor } from "./route-for";
import { useNavReady } from "./use-nav-ready";

/** Longest the native splash may cover a stuck boot before the app shows whatever it has. */
const SPLASH_FAILSAFE_MS = 4_000;

const hideSplash = () => void SplashScreen.hideAsync().catch(() => {});

/**
 * Renders nothing. Boots the session and lock stores, relocks on foreground, and keeps the
 * current route consistent with the session / lock / gate state.
 */
export function Gatekeeper() {
  const ready = useSession((s) => s.ready);
  const token = useSession((s) => s.token);
  const locked = useLock((s) => s.locked);
  const method = useLock((s) => s.method);
  const skipped = useLock((s) => s.skippedThisSession);
  const gate = useGate((s) => s.gate);
  const minVersion = useAppConfig().data?.minVersion;
  const pathname = usePathname();
  const navReady = useNavReady();
  const [booted, setBooted] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void Promise.allSettled([useSession.getState().hydrate(), useLock.getState().load()]).then(([session]) => {
      // A rejected hydrate would leave the splash route forever; treat it as signed out.
      if (session.status === "rejected") useSession.setState({ ready: true });
      setBooted(true);
    });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") useLock.getState().onBackground(Date.now());
      if (state === "active") useLock.getState().onForeground(Date.now());
    });
    return () => sub.remove();
  }, []);

  const belowMin = minVersion !== undefined && compareVersions(appConfig().version, minVersion) < 0;
  const target = routeFor({ ready, token, locked, lockChosen: method !== null || skipped, gate, belowMin });
  const redirect = redirectFor(target, pathname);

  useEffect(() => {
    if (navReady && redirect) router.replace(redirect);
  }, [navReady, redirect]);

  // Hide the splash only once the user is on the right screen, so a signed-out user never sees the tabs.
  const settled = booted && navReady && ready && redirect === null;
  useEffect(() => {
    if (settled) hideSplash();
  }, [settled]);

  useEffect(() => {
    if (!booted) return;
    const id = setTimeout(hideSplash, SPLASH_FAILSAFE_MS);
    return () => clearTimeout(id);
  }, [booted]);

  return null;
}
