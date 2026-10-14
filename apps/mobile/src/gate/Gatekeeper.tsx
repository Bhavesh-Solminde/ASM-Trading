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
  const cfg = useAppConfig();
  const minVersion = cfg.data?.minVersion;
  // Success or failure: either way the min-version / maintenance answer is in.
  const cfgSettled = cfg.isSuccess || cfg.isError;
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
  // Until the lock store has loaded too, `method` is unknown: route nowhere rather than briefly to /lock-setup.
  const target = routeFor({ ready: ready && booted, token, locked, lockChosen: method !== null || skipped, gate, belowMin });
  const redirect = redirectFor(target, pathname);

  // `pathname` too: if the route moves to another wrong one while `redirect` keeps its value, correct it again.
  useEffect(() => {
    if (navReady && redirect) router.replace(redirect);
  }, [navReady, redirect, pathname]);

  // Hide the splash only once the user is on the right screen and the app-config answer is in, so a
  // signed-out, locked, below-min or maintenance user never sees the tabs.
  const settled = booted && navReady && ready && cfgSettled && redirect === null;
  useEffect(() => {
    if (settled) hideSplash();
  }, [settled]);

  // Armed on mount, so a keystore call that never settles cannot hold the native splash up forever.
  useEffect(() => {
    const id = setTimeout(hideSplash, SPLASH_FAILSAFE_MS);
    return () => clearTimeout(id);
  }, []);

  return null;
}
