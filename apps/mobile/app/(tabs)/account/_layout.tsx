import { Stack } from "expo-router";
import { useBootstrap } from "@/api/queries";
import { useSessionLive } from "@/auth/use-session-live";
import { color } from "@/theme/tokens";

/** Deep links and tab-to-flow navigations land on a stack that starts at the tab's own screen, so Back returns to it. */
export const unstable_settings = { initialRouteName: "index" };

/** Index screen = the tab; every other screen in this folder is a pushed flow screen (the tab bar hides, see `tabBarHidden`). The verification screens close while the admin has KYC switched off. */
export default function Layout() {
  const kycRequired = useBootstrap(useSessionLive()).data?.kycRequired ?? true;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground }, animation: "slide_from_right" }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={kycRequired}>
        <Stack.Screen name="verify" />
        <Stack.Screen name="kyc-details" />
        <Stack.Screen name="kyc-camera" />
      </Stack.Protected>
    </Stack>
  );
}
