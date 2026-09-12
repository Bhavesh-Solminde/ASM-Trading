import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0e1621" },
          headerTintColor: "#e8edf3",
          contentStyle: { backgroundColor: "#0e1621" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "ASM Relay" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
      </Stack>
    </>
  );
}
