import { Stack } from "expo-router";
import { color } from "@/theme/tokens";

/** Deep links and tab-to-flow navigations land on a stack that starts at the tab's own screen, so Back returns to it. */
export const unstable_settings = { initialRouteName: "index" };

/** Index screen = the tab; every other screen in this folder is a pushed flow screen (the tab bar hides, see `tabBarHidden`). */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground }, animation: "slide_from_right" }} />;
}
