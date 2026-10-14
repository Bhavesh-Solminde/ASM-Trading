import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { getLocales } from "expo-localization";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { queryClient } from "@/api/queries";
import { configureGoogle } from "@/auth/google";
import { appConfig } from "@/config";
import { Gatekeeper } from "@/gate/Gatekeeper";
import { initI18n, localeFromDevice } from "@/i18n";
import { color } from "@/theme/tokens";
import { OfflineBanner } from "@/ui/OfflineBanner";
import { ToastHost } from "@/ui/Toast";

void SplashScreen.preventAutoHideAsync();
initI18n(localeFromDevice(getLocales().map((l) => l.languageTag ?? "")));
const googleWebClientId = appConfig().googleWebClientId;
if (googleWebClientId !== "") configureGoogle(googleWebClientId);

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.ground }}>
      <QueryClientProvider client={queryClient}>
        <BottomSheetModalProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground }, animation: "fade" }} />
          <Gatekeeper />
          <OfflineBanner />
          <ToastHost />
        </BottomSheetModalProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
