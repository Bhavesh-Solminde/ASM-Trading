import type { ExpoConfig } from "expo/config";

const variant = process.env.APP_VARIANT === "direct" ? "direct" : "play";
const version = "0.1.0";

const config: ExpoConfig = {
  name: "IndianxTrade",
  slug: "indianxtrade",
  version,
  orientation: "portrait",
  scheme: "indianxtrade",
  userInterfaceStyle: "dark",
  icon: "./assets/icon.png",
  android: {
    package: variant === "direct" ? "com.indianxtrade.app.direct" : "com.indianxtrade.app",
    versionCode: 1,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0d1117" },
    permissions: ["android.permission.INTERNET", "android.permission.USE_BIOMETRIC", "android.permission.VIBRATE"],
  },
  plugins: [
    "expo-router",
    // SDK 57 dropped the top-level `splash` key; the splash is configured via this plugin.
    ["expo-splash-screen", { image: "./assets/splash.png", imageWidth: 200, resizeMode: "contain", backgroundColor: "#0d1117" }],
    [
      "expo-build-properties",
      // Release stays cleartext-free; Expo's debug manifest already allows cleartext for the dev server.
      { android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 26, usesCleartextTraffic: false } },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant,
    apiUrl: process.env.APP_API_URL ?? "https://indianxtrade.com",
    wsUrl: process.env.APP_WS_URL ?? "wss://indianxtrade.com/ws",
  },
};

export default config;
