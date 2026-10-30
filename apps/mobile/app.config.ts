import type { ExpoConfig } from "expo/config";

const variant = process.env.APP_VARIANT === "direct" ? "direct" : "play";
const version = "0.1.0";
/**
 * A production build must talk https/wss only (cleartext traffic is off in the Android manifest, so a plain
 * http/ws URL would fail silently on every request). Development builds (Metro, the dev client) may point at a
 * local http server. Lives here because Expo only transpiles this file, not what it imports.
 */
export function assertSecureUrls(input: { apiUrl: string; wsUrl: string; production: boolean }): void {
  if (!input.production) return;
  const check = (name: string, value: string, scheme: string) => {
    if (!value.startsWith(`${scheme}://`) || value.length <= scheme.length + 3) throw new Error(`${name} must be a ${scheme}:// URL with a host in a production build (got "${value}").`);
  };
  check("APP_API_URL", input.apiUrl, "https");
  check("APP_WS_URL", input.wsUrl, "wss");
}

const apiUrl = process.env.APP_API_URL ?? "https://indianxtrade.com";
const wsUrl = process.env.APP_WS_URL ?? "wss://indianxtrade.com/ws";
// Metro and the dev client run with NODE_ENV=development and may use a local http server; a release build may not.
assertSecureUrls({ apiUrl, wsUrl, production: process.env.NODE_ENV === "production" });

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
    // The MMKV caches (resume snapshot with balances and trades, prefs) must not be copied into a cloud backup.
    allowBackup: false,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#06080b" },
    permissions: ["android.permission.INTERNET", "android.permission.USE_BIOMETRIC", "android.permission.VIBRATE", "android.permission.CAMERA"],
    // The Expo/RN templates merge in an overlay permission and legacy storage permissions this app never uses; a
    // real-money app should not ask Play (or the user) for them. `tools:node="remove"` strips them from the merge.
    blockedPermissions: [
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      // Photographing ID documents never records audio (expo-camera's plugin would otherwise add this permission).
      "android.permission.RECORD_AUDIO",
    ],
  },
  plugins: [
    // No `/_sitemap` page in the app: a deep link to it would list every route.
    ["expo-router", { sitemap: false }],
    "expo-secure-store",
    "expo-localization",
    "expo-web-browser",
    "@react-native-google-signin/google-signin",
    // Android 11+ package visibility: lets the pay screen ask which UPI apps can open (see the plugin).
    "./plugins/with-upi-queries",
    // KYC capture. The camera plugin's default adds RECORD_AUDIO, which a stills-only app must not ask for.
    ["expo-camera", { cameraPermission: "IndianxTrade uses the camera to photograph your ID documents and take a verification selfie.", recordAudioAndroid: false }],
    // The gallery option uses Android's photo picker, which needs no storage permission. `cameraPermission` must NOT be
    // `false` here: the picker plugin turns that into a blocked CAMERA (tools:node="remove"), which would strip the
    // permission expo-camera needs. A string only sets the (iOS-only) usage text. `microphonePermission: false` blocks RECORD_AUDIO.
    [
      "expo-image-picker",
      {
        photosPermission: "IndianxTrade reads a photo you choose from your gallery as your ID document or selfie.",
        cameraPermission: "IndianxTrade uses the camera to photograph your ID documents and take a verification selfie.",
        microphonePermission: false,
      },
    ],
    // SDK 57 dropped the top-level `splash` key; the splash is configured via this plugin.
    ["expo-splash-screen", { image: "./assets/splash.png", imageWidth: 200, resizeMode: "contain", backgroundColor: "#06080b" }],
    [
      "expo-build-properties",
      // Release stays cleartext-free; Expo's debug manifest already allows cleartext for the dev server.
      { android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 26, usesCleartextTraffic: false } },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    variant,
    apiUrl,
    wsUrl,
    googleWebClientId: process.env.APP_GOOGLE_WEB_CLIENT_ID ?? "",
  },
};

export default config;
