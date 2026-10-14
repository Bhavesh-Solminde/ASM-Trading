// Minimal wiring for Task 5. Task 7 replaces this with the full provider, gate and tab layout.
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { queryClient } from "@/api/queries";
import { configureGoogle } from "@/auth/google";
import { useSession } from "@/auth/session-store";
import { appConfig } from "@/config";
import { initI18n } from "@/i18n";
import { color } from "@/theme/tokens";
import { ToastHost } from "@/ui/Toast";

// expo-localization is not installed yet, so the locale is fixed to English until Task 7.
initI18n("en");
const googleWebClientId = appConfig().googleWebClientId;
if (googleWebClientId !== "") configureGoogle(googleWebClientId);

export default function RootLayout() {
  useEffect(() => {
    void useSession.getState().hydrate();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground } }} />
      <ToastHost />
    </QueryClientProvider>
  );
}
