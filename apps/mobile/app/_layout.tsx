import { BottomSheetModalProvider, useBottomSheetModal } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { getLocales } from "expo-localization";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { queryClient } from "@/api/queries";
import { configureGoogle } from "@/auth/google";
import { appConfig } from "@/config";
import { Gatekeeper } from "@/gate/Gatekeeper";
import { initI18n, resolveLocale } from "@/i18n";
import { loadLocale } from "@/i18n/locale-pref";
import { useLock } from "@/lock/lock-store";
import { FONT_ASSETS } from "@/theme/font-assets";
import { color } from "@/theme/tokens";
import { OfflineBanner } from "@/ui/OfflineBanner";
import { PrivacyShield } from "@/ui/PrivacyCover";
import { ToastHost } from "@/ui/Toast";

void SplashScreen.preventAutoHideAsync();
initI18n(resolveLocale(loadLocale(), getLocales().map((l) => l.languageTag ?? "")));
const googleWebClientId = appConfig().googleWebClientId;
if (googleWebClientId !== "") configureGoogle(googleWebClientId);

/**
 * Sheets render through the provider's portal, above the Stack: a trades or keypad sheet left open would
 * be drawn over /lock. Close them the moment the app relocks.
 */
function DismissSheetsOnLock() {
  const locked = useLock((s) => s.locked);
  const { dismissAll } = useBottomSheetModal();
  useEffect(() => {
    if (locked) dismissAll();
  }, [locked, dismissAll]);
  return null;
}

/** Gate screens replace the app instantly: a fade would show the account (balance, positions) underneath. */
const INSTANT = { animation: "none" } as const;

export default function RootLayout() {
  // Bundled fonts (no network). An error still lets the app start, in the system font.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.ground }}>
      <QueryClientProvider client={queryClient}>
        {/* Outermost inside the data providers, so its cover is drawn over the sheet portal and the toasts too. */}
        <PrivacyShield>
          <BottomSheetModalProvider>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground }, animation: "fade" }}>
              <Stack.Screen name="lock" options={INSTANT} />
              <Stack.Screen name="maintenance" options={INSTANT} />
              <Stack.Screen name="blocked" options={INSTANT} />
              <Stack.Screen name="update-required" options={INSTANT} />
            </Stack>
            <DismissSheetsOnLock />
            <Gatekeeper fontsReady={fontsLoaded || fontError !== null} />
            <OfflineBanner />
            <ToastHost />
          </BottomSheetModalProvider>
        </PrivacyShield>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
