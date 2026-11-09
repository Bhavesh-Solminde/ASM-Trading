# Mobile P2 — App Shell + Trade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Android app in `apps/mobile` — login, app lock, English/Hindi, four-tab shell, and the full Trade screen on a native Skia chart — matching the current mobile web layout.

**Architecture:** Expo SDK 57 + expo-router. Pure logic (API error mapping, lock rules, PIN hashing, socket state machine, chart scale and path building, resume cache codec) lives in framework-free TypeScript modules under `src/` and is unit-tested with vitest in Node. React Native screens are thin and consume those modules plus `@asm/client-core` and `@asm/contracts`. One engine socket (zustand store) feeds every screen.

**Tech Stack:** Expo 57, React Native 0.86, expo-router, TypeScript strict, `@shopify/react-native-skia`, `react-native-reanimated`, `react-native-gesture-handler`, `@gorhom/bottom-sheet`, `@tanstack/react-query`, `zustand`, `react-native-mmkv`, `i18next` + `react-i18next`, `expo-secure-store`, `expo-local-authentication`, `expo-crypto`, `expo-haptics`, `expo-keep-awake`, `expo-device`, `expo-web-browser`, `@react-native-community/netinfo`, `@react-native-google-signin/google-signin`, `react-native-svg`, vitest (pure modules), Maestro (E2E).

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-p2-shell-trade-design.md` · **Needs:** P1 merged (bearer sessions, `/api/v1/*`, `@asm/client-core`).

## Global Constraints

- Package `@asm/mobile` at `apps/mobile`; Expo SDK **57** (`expo@57.0.22`, `react@19.2.3`, `react-native@0.86.3` — same as `apps/relay`). Native libraries are added with `pnpm exec expo install <pkg>` so versions match the SDK.
- Android only for this sub-project: `minSdkVersion 26`, `targetSdkVersion 36`, `compileSdkVersion 36`, portrait, dark UI, `usesCleartextTraffic` **false** in release.
- Variants via `APP_VARIANT=play|direct`: package `com.indianxtrade.app` (play) / `com.indianxtrade.app.direct` (direct). Display name "IndianxTrade".
- Every request sends `Authorization: Bearer <token>`, `X-Client: app/<version>`, `X-Device-Name: <model>`.
- Error codes handled: `unauthenticated` → login; `maintenance` → maintenance screen; `vpn_blocked` → blocked screen; `upgrade_required` → update screen; `rate_limited` → toast.
- Session token only in `expo-secure-store`. Never in MMKV, logs or crash reports.
- App lock: on by default after first login; biometric if enrolled, else 4-digit PIN; re-lock on cold start or after **≥ 5 minutes** in background; **5** wrong PINs → logout.
- Socket: closed on background, reconnected on foreground; backoff 0.5s, 1s, 2s, 4s, 8s then 15s cap, ±20% jitter; offline banner after the second consecutive failure.
- Chart v1 types: `candles`, `line`, `area`, `bars`. Zoom 15–300 visible candles. Load older when the left edge is within 20 candles (200 per request). Target ≥ 45fps on the low-end test phone.
- Expiry chips: 30s, 1m, 5m, 15m + More (all `TRADE_DURATIONS_SEC`). Min stake from `@asm/client-core` `minStakeMinor` (₹100 / $1).
- Haptics: keypad keys `Light`, Buy/Sell `Medium`, win `Success`, loss `Warning`. Keep screen awake while ≥ 1 trade is open.
- Strings: every UI string in `src/i18n/en.json` and `src/i18n/hi.json`; money/number formatting from `@asm/client-core` (Latin digits in both languages).
- Touch targets ≥ 44pt; safe-area insets on every screen.
- The web deploy workflow must not install or build `@asm/mobile`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

```
apps/mobile/
  package.json  app.config.ts  metro.config.js  babel.config.js  tsconfig.json  vitest.config.ts
  app/
    _layout.tsx                 providers, fonts, splash, gate routing
    (auth)/_layout.tsx  login.tsx  register.tsx  forgot.tsx
    (tabs)/_layout.tsx  trade.tsx  payments.tsx  history.tsx  account.tsx
    lock.tsx  lock-setup.tsx  update-required.tsx  maintenance.tsx  blocked.tsx
  src/
    config.ts                   apiUrl / wsUrl / version from expo-constants
    theme/tokens.ts  theme/ui.tsx
    i18n/en.json  i18n/hi.json  i18n/index.ts  i18n/parity.test.ts
    api/errors.ts (+test)  api/client.ts  api/queries.ts
    auth/session-store.ts  auth/google.ts
    lock/rules.ts (+test)  lock/pin.ts (+test)  lock/lock-store.ts
    gate/gate-store.ts
    socket/engine-socket.ts (+test)  socket/socket-store.ts
    cache/resume-cache.ts (+test)
    chart/scale.ts (+test)  chart/paths.ts (+test)  chart/Chart.tsx  chart/useChartGestures.ts
    trade/StatusRow.tsx  TopBar.tsx  MarketPill.tsx  MarketSheet.tsx  ChartTools.tsx
          Dock.tsx  KeypadSheet.tsx  ExpirySheet.tsx  PositionStrip.tsx  TradesSheet.tsx
          BonusSheet.tsx  ResultToast.tsx  useTradeSubmit.ts  useKeepAwakeWhileOpen.ts
    ui/Sheet.tsx  ui/Toast.tsx  ui/OfflineBanner.tsx  ui/Icon.tsx
  e2e/*.yaml                    Maestro flows
```

---

### Task 1: Scaffold `apps/mobile` and ship a signed skeleton

**Files:**
- Create: `apps/mobile/package.json`, `app.config.ts`, `metro.config.js`, `babel.config.js`, `tsconfig.json`, `vitest.config.ts`, `app/_layout.tsx`, `app/index.tsx`, `src/config.ts`, `src/config.test.ts`
- Modify: `.github/workflows/deploy.yml` (exclude mobile), root `package.json` (scripts)

**Interfaces:**
- Produces: `appConfig(): { apiUrl: string; wsUrl: string; version: string; variant: "play" | "direct" }` from `src/config.ts`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@asm/mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start --dev-client",
    "android": "expo run:android",
    "prebuild": "expo prebuild --platform android --clean",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@asm/client-core": "workspace:*",
    "@asm/contracts": "workspace:*",
    "expo": "57.0.22",
    "expo-router": "57.0.21",
    "expo-constants": "57.0.18",
    "expo-linking": "57.0.10",
    "expo-status-bar": "57.0.1",
    "expo-dev-client": "57.0.19",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-safe-area-context": "5.7.0",
    "react-native-screens": "4.26.2"
  },
  "devDependencies": {
    "@types/react": "19.2.18",
    "babel-preset-expo": "~57.0.11",
    "expo-build-properties": "57.0.17",
    "typescript": "6.0.3",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 2: Create config files**

`metro.config.js` — copy `apps/relay/metro.config.js` verbatim.
`babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"], plugins: ["react-native-reanimated/plugin"] };
};
```

(The reanimated plugin line is added now; the package arrives in Task 2. Until then remove it if `expo start` complains.)

`tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true, "paths": { "@/*": ["./src/*"] } },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

`vitest.config.ts` (pure modules only — files that import `react-native` are never unit-tested here):

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

`app.config.ts`:

```ts
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
  newArchEnabled: true,
  icon: "./assets/icon.png",
  splash: { image: "./assets/splash.png", resizeMode: "contain", backgroundColor: "#0d1117" },
  android: {
    package: variant === "direct" ? "com.indianxtrade.app.direct" : "com.indianxtrade.app",
    versionCode: 1,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0d1117" },
    permissions: ["android.permission.INTERNET", "android.permission.USE_BIOMETRIC", "android.permission.VIBRATE"],
  },
  plugins: [
    "expo-router",
    [
      "expo-build-properties",
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
```

Copy `apps/web/src/app/icon.png` to `apps/mobile/assets/icon.png` and `assets/adaptive-icon.png`; copy `apps/web/public/brand/indianxtrade-mark.png` to `assets/splash.png`. Confirm the production host and WebSocket path with `apps/web/src/lib/site.ts` (`SITE_URL`) and `NEXT_PUBLIC_ENGINE_WS_URL` in the VPS env; use those values as the defaults above.

For local development, set `APP_API_URL=http://10.0.2.2:3000` and `APP_WS_URL=ws://10.0.2.2:4001` and add a `development` override: when `APP_API_URL` starts with `http://`, set `usesCleartextTraffic: true` in the build-properties plugin (dev builds only).

- [ ] **Step 3: Failing test for `src/config.ts`**

`src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { configFrom } from "./config";

describe("configFrom", () => {
  it("reads api/ws urls, version and variant from the expo extra", () => {
    expect(
      configFrom({ version: "1.2.3", extra: { variant: "direct", apiUrl: "https://x.test", wsUrl: "wss://x.test/ws" } }),
    ).toEqual({ apiUrl: "https://x.test", wsUrl: "wss://x.test/ws", version: "1.2.3", variant: "direct" });
  });
  it("strips a trailing slash from the api url", () => {
    expect(configFrom({ version: "1.0.0", extra: { apiUrl: "https://x.test/", wsUrl: "wss://x" } }).apiUrl).toBe(
      "https://x.test",
    );
  });
  it("defaults the variant to play", () => {
    expect(configFrom({ version: "1.0.0", extra: { apiUrl: "a", wsUrl: "b" } }).variant).toBe("play");
  });
});
```

Run: `pnpm --filter @asm/mobile test` → FAIL.

- [ ] **Step 4: Implement `src/config.ts`**

```ts
export interface AppConfig {
  apiUrl: string;
  wsUrl: string;
  version: string;
  variant: "play" | "direct";
}

interface ExpoLike {
  version?: string;
  extra?: { apiUrl?: string; wsUrl?: string; variant?: string } | null;
}

export function configFrom(expo: ExpoLike): AppConfig {
  const extra = expo.extra ?? {};
  return {
    apiUrl: (extra.apiUrl ?? "").replace(/\/+$/, ""),
    wsUrl: extra.wsUrl ?? "",
    version: expo.version ?? "0.0.0",
    variant: extra.variant === "direct" ? "direct" : "play",
  };
}

let cached: AppConfig | null = null;

/** Runtime config. Imports expo-constants lazily so this module stays testable in Node. */
export function appConfig(): AppConfig {
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default as { expoConfig: ExpoLike | null };
    cached = configFrom(Constants.expoConfig ?? {});
  }
  return cached;
}
```

Run: `pnpm --filter @asm/mobile test` → PASS.

- [ ] **Step 5: Minimal routes**

`app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0d1117" } }} />
    </>
  );
}
```

`app/index.tsx`:

```tsx
import { Text, View } from "react-native";

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0d1117" }}>
      <Text style={{ color: "#e6edf3", fontSize: 20 }}>IndianxTrade</Text>
    </View>
  );
}
```

- [ ] **Step 6: Keep mobile out of the web deploy**

In `.github/workflows/deploy.yml`, change `--filter '!@asm/relay...'` to `--filter '!@asm/relay...' --filter '!@asm/mobile...'`, and add `--exclude apps/mobile` next to `--exclude apps/relay` in the rsync step (the VPS never needs the app source). In the root `package.json` add scripts `"mobile:start": "pnpm --filter @asm/mobile start"`, `"mobile:android": "pnpm --filter @asm/mobile android"`, `"mobile:test": "pnpm --filter @asm/mobile test"`.

- [ ] **Step 7: Build and run on the emulator**

Run:
```bash
pnpm install && cd apps/mobile && pnpm prebuild && pnpm android
```
Expected: the app opens on the emulator showing "IndianxTrade".

- [ ] **Step 8: Produce the signed skeleton AAB for Play Internal testing**

Create the Play upload keystore once (owner keeps it, backed up offline):
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore ~/.indianxtrade/keys/play-upload.p12 -alias upload -keyalg RSA -keysize 4096 -validity 10000
```
Build: `cd apps/mobile && APP_VARIANT=play pnpm prebuild && cd android && ./gradlew bundleRelease` with signing configured through `android/gradle.properties` entries `MYAPP_UPLOAD_STORE_FILE`, `MYAPP_UPLOAD_KEY_ALIAS`, `MYAPP_UPLOAD_STORE_PASSWORD`, `MYAPP_UPLOAD_KEY_PASSWORD` (local file only — `android/` is generated and git-ignored). The release pipeline in P5 automates this.
Expected: `android/app/build/outputs/bundle/release/app-release.aab`. Hand it to the owner for P1 Task 16.

- [ ] **Step 9: Commit**

Ensure `apps/mobile/.gitignore` contains `android/`, `ios/`, `.expo/`, `node_modules/`.

```bash
git add apps/mobile .github/workflows/deploy.yml package.json pnpm-lock.yaml
git commit -m "feat(mobile): scaffold Expo app with play/direct variants"
```

---

### Task 2: Native dependencies, theme tokens and UI primitives

**Files:**
- Modify: `apps/mobile/package.json` (via `expo install`)
- Create: `apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/theme/ui.tsx`, `apps/mobile/src/ui/Icon.tsx`

**Interfaces:**
- Produces: `tokens` object (`color.*`, `space(n)`, `radius.*`, `font.*`); components `Screen`, `Txt`, `Button`, `Card`, `Row`, `Skeleton`; `Icon({ name: IconName; size?: number; color?: string })` with names `trade | wallet | history | user | chevron | close | more | briefcase | star | search | lock | bolt`.

- [ ] **Step 1: Install native modules**

```bash
cd apps/mobile && pnpm exec expo install @shopify/react-native-skia react-native-reanimated react-native-gesture-handler @gorhom/bottom-sheet react-native-mmkv expo-secure-store expo-local-authentication expo-crypto expo-haptics expo-keep-awake expo-device expo-web-browser @react-native-community/netinfo react-native-svg @react-native-google-signin/google-signin
pnpm add @tanstack/react-query zustand i18next react-i18next
```
Expected: dependencies added with SDK-57-compatible versions. Re-run `pnpm prebuild && pnpm android` once; the app still opens.

- [ ] **Step 2: Copy the web tokens**

Read every `--color-*` custom property in `apps/web/src/app/globals.css` (the dark theme block) and create `src/theme/tokens.ts`:

```ts
/** Mirrors apps/web/src/app/globals.css (dark theme). Keep names identical. */
export const color = {
  bg: "#0d1117",
  panel: "#161b22",
  tile: "#1c2128",
  rule: "#30363d",
  ink: "#e6edf3",
  ink2: "#8b949e",
  brand: "#2f81f7",
  brandInk: "#ffffff",
  brandFill: "#1f6feb",
  brandDim: "#10233f",
  up: "#2ea043",
  down: "#f85149",
  gold: "#d4a72c",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const space = (n: number) => n * 4;
export const font = {
  regular: { fontSize: 14, color: color.ink },
  small: { fontSize: 12, color: color.ink2 },
  title: { fontSize: 18, fontWeight: "700" as const, color: color.ink },
  number: { fontVariant: ["tabular-nums" as const] },
};
export const tokens = { color, radius, space, font };
```

Replace each hex above with the exact value from `globals.css` for the same name (`--color-bg`, `--color-panel`, `--color-tile`, `--color-rule`, `--color-ink`, `--color-ink-2`, `--color-brand`, `--color-brand-ink`, `--color-brand-fill`, `--color-brand-dim`, `--color-up`, `--color-down`; gold from the logo asset's README in `public/brand/README.md`). If a name is missing in CSS, keep the value above and note it in the PR.

- [ ] **Step 3: Primitives**

`src/theme/ui.tsx`:

```tsx
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { color, font, radius, space } from "./tokens";

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <SafeAreaView style={[styles.screen, style]} edges={["top", "left", "right"]}>{children}</SafeAreaView>;
}

export function Txt({ variant = "regular", style, ...rest }: TextProps & { variant?: "regular" | "small" | "title" }) {
  return <Text {...rest} style={[font[variant], style]} />;
}

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "up" | "down";
  disabled?: boolean;
  busy?: boolean;
}) {
  const bg = { primary: color.brandFill, secondary: color.tile, up: color.up, down: color.down }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {busy ? <ActivityIndicator color={color.brandInk} /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | `${number}%` }) {
  return <View style={{ height, width, borderRadius: radius.sm, backgroundColor: color.tile }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space(4) },
  buttonText: { color: color.brandInk, fontSize: 16, fontWeight: "700" },
  card: { backgroundColor: color.panel, borderRadius: radius.lg, padding: space(4) },
});
```

`src/ui/Icon.tsx`: port the `PATHS` entries for `trade`, `wallet`, `history`, `user` from `apps/web/src/components/shell/Icon.tsx` (copy their `<path d=…>` strings exactly), and add the rest as simple 24×24 stroke paths:

```tsx
import { Path, Svg, Circle } from "react-native-svg";
import { color as palette } from "@/theme/tokens";

export type IconName =
  | "trade" | "wallet" | "history" | "user" | "chevron" | "close" | "more" | "briefcase" | "star" | "search" | "lock" | "bolt";

const D: Record<IconName, string[]> = {
  trade: ["M4 19V5M4 19h16", "M8 15v-4M12 15V8M16 15v-6"],
  wallet: ["M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z", "M4 7l11-3v3", "M16 13.5h.5"],
  history: ["M4 12a8 8 0 1 0 2.3-5.6", "M4 4v3h3", "M12 8v4l3 2"],
  user: ["M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"],
  chevron: ["M9 6l6 6-6 6"],
  close: ["M6 6l12 12M18 6L6 18"],
  more: ["M5 12h.01M12 12h.01M19 12h.01"],
  briefcase: ["M4 8h16v11H4z", "M9 8V5h6v3"],
  star: ["M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2 8 13.7 4 9.8 9.5 9z"],
  search: ["M15.5 15.5L20 20", "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z"],
  lock: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  bolt: ["M13 3L5 14h6l-1 7 8-11h-6z"],
};

export function Icon({ name, size = 22, color = palette.ink }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {name === "user" ? <Circle cx={12} cy={8.5} r={3.5} /> : null}
      {D[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @asm/mobile typecheck` → no errors.

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): native deps, theme tokens and primitives"
```

---

### Task 3: i18n (English + Hindi) with a parity check

**Files:**
- Create: `apps/mobile/src/i18n/en.json`, `hi.json`, `index.ts`, `parity.test.ts`, `keys.ts`

**Interfaces:**
- Produces: `initI18n(locale: "en" | "hi"): void`, `setLocale(locale): Promise<void>`, `localeFromDevice(tags: string[]): "en" | "hi"` (pure, in `keys.ts`), and `useTranslation()` from `react-i18next`.

- [ ] **Step 1: Failing tests**

`src/i18n/parity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import en from "./en.json";
import hi from "./hi.json";
import { flattenKeys, localeFromDevice } from "./keys";

describe("translations", () => {
  it("define exactly the same keys in English and Hindi", () => {
    expect(flattenKeys(hi).sort()).toEqual(flattenKeys(en).sort());
  });
  it("leave no Hindi string empty", () => {
    const empty = flattenKeys(hi).filter((k) => String(k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], hi)).trim() === "");
    expect(empty).toEqual([]);
  });
});

describe("localeFromDevice", () => {
  it("picks Hindi for a Hindi phone", () => {
    expect(localeFromDevice(["hi-IN", "en-IN"])).toBe("hi");
  });
  it("falls back to English otherwise", () => {
    expect(localeFromDevice(["en-IN"])).toBe("en");
    expect(localeFromDevice([])).toBe("en");
  });
});
```

- [ ] **Step 2: Implement `keys.ts`**

```ts
export type Locale = "en" | "hi";

export function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? flattenKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

export function localeFromDevice(tags: string[]): Locale {
  return tags[0]?.toLowerCase().startsWith("hi") ? "hi" : "en";
}
```

- [ ] **Step 3: Seed the string files**

`en.json` (add keys as screens are built in later tasks — every later task that adds UI text adds both languages):

```json
{
  "common": { "retry": "Retry", "cancel": "Cancel", "done": "Done", "continue": "Continue", "offline": "No connection — reconnecting…" },
  "tabs": { "trade": "Trade", "payments": "Payments", "history": "History", "account": "Account" },
  "auth": {
    "login": "Log in", "register": "Create account", "email": "Email", "password": "Password",
    "forgot": "Forgot password?", "google": "Continue with Google", "noAccount": "New here? Create an account",
    "haveAccount": "Already have an account? Log in", "resetSent": "If that email is registered, a reset link is on its way."
  },
  "lock": {
    "title": "Unlock IndianxTrade", "setupTitle": "Protect your account", "useBiometric": "Use fingerprint or face",
    "setPin": "Set a 4-digit PIN", "confirmPin": "Enter the PIN again", "wrongPin": "Wrong PIN. {{left}} tries left.",
    "mismatch": "PINs didn't match. Try again.", "skip": "Not now", "forgotPin": "Forgot PIN? Log in again"
  },
  "gate": {
    "maintenanceTitle": "We'll be right back", "maintenanceBody": "IndianxTrade is under maintenance. We'll reconnect automatically.",
    "blockedTitle": "VPN or proxy detected", "blockedBody": "Turn off your VPN, proxy or Tor and try again.",
    "updateTitle": "Update required", "updateBody": "This version is no longer supported. Update to keep trading.", "update": "Update now"
  },
  "trade": {
    "buy": "Buy", "sell": "Sell", "stake": "Stake", "expiry": "Time", "more": "More", "payout": "{{pct}}%",
    "demo": "Demo", "live": "Live", "won": "Won {{amount}}", "lost": "Lost {{amount}}", "draw": "Refunded {{amount}}",
    "open": "Open", "closed": "Closed", "noTrades": "No trades yet", "markets": "Markets", "search": "Search markets",
    "favourites": "Favourites", "bonus": "+{{pct}}% bonus", "minStake": "Minimum stake is {{amount}}",
    "insufficient": "Not enough balance", "backToLive": "Live", "chartType": "Chart type", "timeframe": "Timeframe",
    "candles": "Candles", "line": "Line", "area": "Area", "bars": "Bars"
  }
}
```

`hi.json` — same keys, Hindi text (have a native speaker review before release; the PR lists this as a release blocker):

```json
{
  "common": { "retry": "फिर कोशिश करें", "cancel": "रद्द करें", "done": "हो गया", "continue": "आगे बढ़ें", "offline": "कनेक्शन नहीं है — दोबारा जोड़ रहे हैं…" },
  "tabs": { "trade": "ट्रेड", "payments": "भुगतान", "history": "इतिहास", "account": "खाता" },
  "auth": {
    "login": "लॉग इन", "register": "खाता बनाएँ", "email": "ईमेल", "password": "पासवर्ड",
    "forgot": "पासवर्ड भूल गए?", "google": "Google से जारी रखें", "noAccount": "नए हैं? खाता बनाएँ",
    "haveAccount": "पहले से खाता है? लॉग इन करें", "resetSent": "अगर यह ईमेल रजिस्टर्ड है, तो रीसेट लिंक भेज दिया गया है।"
  },
  "lock": {
    "title": "IndianxTrade अनलॉक करें", "setupTitle": "अपने खाते को सुरक्षित करें", "useBiometric": "फ़िंगरप्रिंट या फ़ेस का इस्तेमाल करें",
    "setPin": "4 अंकों का PIN सेट करें", "confirmPin": "PIN फिर से डालें", "wrongPin": "गलत PIN। {{left}} कोशिशें बाकी।",
    "mismatch": "PIN मेल नहीं खाए। फिर कोशिश करें।", "skip": "अभी नहीं", "forgotPin": "PIN भूल गए? फिर से लॉग इन करें"
  },
  "gate": {
    "maintenanceTitle": "हम जल्द लौटेंगे", "maintenanceBody": "IndianxTrade पर रखरखाव चल रहा है। हम अपने आप दोबारा जुड़ जाएँगे।",
    "blockedTitle": "VPN या प्रॉक्सी मिला", "blockedBody": "अपना VPN, प्रॉक्सी या Tor बंद करके फिर कोशिश करें।",
    "updateTitle": "अपडेट ज़रूरी है", "updateBody": "यह वर्ज़न अब काम नहीं करता। ट्रेडिंग जारी रखने के लिए अपडेट करें।", "update": "अभी अपडेट करें"
  },
  "trade": {
    "buy": "खरीदें", "sell": "बेचें", "stake": "राशि", "expiry": "समय", "more": "और", "payout": "{{pct}}%",
    "demo": "डेमो", "live": "लाइव", "won": "{{amount}} जीते", "lost": "{{amount}} हारे", "draw": "{{amount}} वापस",
    "open": "खुले", "closed": "बंद", "noTrades": "अभी कोई ट्रेड नहीं", "markets": "मार्केट", "search": "मार्केट खोजें",
    "favourites": "पसंदीदा", "bonus": "+{{pct}}% बोनस", "minStake": "न्यूनतम राशि {{amount}} है",
    "insufficient": "बैलेंस कम है", "backToLive": "लाइव", "chartType": "चार्ट प्रकार", "timeframe": "टाइमफ़्रेम",
    "candles": "कैंडल", "line": "लाइन", "area": "एरिया", "bars": "बार"
  }
}
```

- [ ] **Step 4: `index.ts`**

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import hi from "./hi.json";
import type { Locale } from "./keys";

export function initI18n(locale: Locale): void {
  if (i18n.isInitialized) return;
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, hi: { translation: hi } },
    lng: locale,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
}

export { localeFromDevice, type Locale } from "./keys";
```

Add `"resolveJsonModule": true` to `tsconfig.json` `compilerOptions` if the JSON imports fail typecheck.

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @asm/mobile test` → PASS. Add a CI note: the P5 release workflow runs `pnpm --filter @asm/mobile test`, which includes this parity check.

```bash
git add apps/mobile/src/i18n apps/mobile/tsconfig.json
git commit -m "feat(mobile): English/Hindi strings with parity check"
```

---

### Task 4: API client and error-code mapping

**Files:**
- Create: `apps/mobile/src/api/errors.ts`, `errors.test.ts`, `client.ts`, `queries.ts`
- Create: `apps/mobile/src/gate/gate-store.ts`

**Interfaces:**
- Produces:
  - `type GateState = "ok" | "maintenance" | "blocked" | "upgrade" | "offline"`
  - `classifyResponse(status: number, body: unknown): { kind: "ok" } | { kind: "gate"; gate: Exclude<GateState, "ok" | "offline"> } | { kind: "logout" } | { kind: "toast"; message: string } | { kind: "error"; status: number; code: string | null; message: string }` (pure)
  - `class ApiError extends Error { status: number; code: string | null }`
  - `api<T>(path: string, opts: { method?: string; body?: unknown; schema?: ZodType<T>; form?: FormData }): Promise<T>`
  - `useGate` zustand store: `{ gate: GateState; setGate(g): void }`
  - `queryClient` and hooks `useBootstrap()`, `useAppConfig()`.

- [ ] **Step 1: Failing tests for `classifyResponse`**

```ts
import { describe, expect, it } from "vitest";
import { classifyResponse } from "./errors";

describe("classifyResponse", () => {
  it("passes successful responses through", () => {
    expect(classifyResponse(200, {})).toEqual({ kind: "ok" });
  });
  it("sends an expired session to login", () => {
    expect(classifyResponse(401, { code: "unauthenticated" })).toEqual({ kind: "logout" });
  });
  it("maps maintenance, VPN and outdated-app codes to gate screens", () => {
    expect(classifyResponse(503, { code: "maintenance" })).toEqual({ kind: "gate", gate: "maintenance" });
    expect(classifyResponse(403, { code: "vpn_blocked" })).toEqual({ kind: "gate", gate: "blocked" });
    expect(classifyResponse(426, { code: "upgrade_required" })).toEqual({ kind: "gate", gate: "upgrade" });
  });
  it("turns rate limits into a toast", () => {
    expect(classifyResponse(429, { error: "Too many requests.", code: "rate_limited" })).toEqual({
      kind: "toast",
      message: "Too many requests.",
    });
  });
  it("keeps other errors with their message and code for the screen to show", () => {
    expect(classifyResponse(409, { error: "KYC is locked." })).toEqual({
      kind: "error",
      status: 409,
      code: null,
      message: "KYC is locked.",
    });
  });
  it("survives a non-JSON error body", () => {
    expect(classifyResponse(500, null)).toMatchObject({ kind: "error", status: 500, message: "Something went wrong." });
  });
});
```

- [ ] **Step 2: Implement `errors.ts`**

```ts
export type GateState = "ok" | "maintenance" | "blocked" | "upgrade" | "offline";

export type Classified =
  | { kind: "ok" }
  | { kind: "gate"; gate: "maintenance" | "blocked" | "upgrade" }
  | { kind: "logout" }
  | { kind: "toast"; message: string }
  | { kind: "error"; status: number; code: string | null; message: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function field(body: unknown, key: string): string | null {
  if (body && typeof body === "object" && typeof (body as Record<string, unknown>)[key] === "string") {
    return (body as Record<string, string>)[key] ?? null;
  }
  return null;
}

export function classifyResponse(status: number, body: unknown): Classified {
  if (status >= 200 && status < 300) return { kind: "ok" };
  const code = field(body, "code");
  if (status === 401 || code === "unauthenticated") return { kind: "logout" };
  if (code === "maintenance") return { kind: "gate", gate: "maintenance" };
  if (code === "vpn_blocked") return { kind: "gate", gate: "blocked" };
  if (code === "upgrade_required" || status === 426) return { kind: "gate", gate: "upgrade" };
  const message = field(body, "error") ?? field(body, "message") ?? "Something went wrong.";
  if (status === 429 || code === "rate_limited") return { kind: "toast", message };
  return { kind: "error", status, code, message };
}
```

Run: `pnpm --filter @asm/mobile test` → PASS.

- [ ] **Step 3: Gate store**

`src/gate/gate-store.ts`:

```ts
import { create } from "zustand";
import type { GateState } from "@/api/errors";

export const useGate = create<{ gate: GateState; setGate: (g: GateState) => void }>((set) => ({
  gate: "ok",
  setGate: (gate) => set({ gate }),
}));
```

- [ ] **Step 4: `client.ts`**

```ts
import * as Device from "expo-device";
import type { ZodType } from "zod";
import { appConfig } from "@/config";
import { useGate } from "@/gate/gate-store";
import { ApiError, classifyResponse } from "./errors";

let tokenProvider: () => string | null = () => null;
let onLogout: () => void = () => {};
let onToast: (message: string) => void = () => {};

/** Wired once by the session store and toast host at startup. */
export function configureApi(opts: { token: () => string | null; logout: () => void; toast: (m: string) => void }) {
  tokenProvider = opts.token;
  onLogout = opts.logout;
  onToast = opts.toast;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData; schema?: ZodType<T>; auth?: boolean } = {},
): Promise<T> {
  const { apiUrl, version } = appConfig();
  const headers: Record<string, string> = {
    "X-Client": `app/${version}`,
    "X-Device-Name": Device.modelName ?? "Android",
    Accept: "application/json",
  };
  const token = opts.auth === false ? null : tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError("No connection.", 0, "offline");
  }

  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  const verdict = classifyResponse(res.status, json);
  switch (verdict.kind) {
    case "ok":
      if (useGate.getState().gate !== "ok") useGate.getState().setGate("ok");
      return opts.schema ? opts.schema.parse(json) : (json as T);
    case "logout":
      onLogout();
      throw new ApiError("Not signed in.", 401, "unauthenticated");
    case "gate":
      useGate.getState().setGate(verdict.gate);
      throw new ApiError(verdict.gate, res.status, verdict.gate);
    case "toast":
      onToast(verdict.message);
      throw new ApiError(verdict.message, res.status, "rate_limited");
    case "error":
      throw new ApiError(verdict.message, verdict.status, verdict.code);
  }
}
```

Add `zod` to `apps/mobile` dependencies (`pnpm add zod@4.6.1`, matching `@asm/contracts`).

- [ ] **Step 5: `queries.ts`**

```ts
import { QueryClient, useQuery } from "@tanstack/react-query";
import { AppConfigSchema, BootstrapSchema } from "@asm/contracts";
import { api } from "./client";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
});

export const useBootstrap = (enabled: boolean) =>
  useQuery({ queryKey: ["bootstrap"], queryFn: () => api("/api/v1/bootstrap", { schema: BootstrapSchema }), enabled });

export const useAppConfig = () =>
  useQuery({
    queryKey: ["app-config"],
    queryFn: () => api("/api/v1/app/config", { schema: AppConfigSchema, auth: false }),
    staleTime: 5 * 60_000,
  });
```

- [ ] **Step 6: Typecheck, test, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck` → PASS.

```bash
git add apps/mobile/src/api apps/mobile/src/gate apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): API client with error-code gates"
```

---

### Task 5: Session store and auth screens (email + Google)

**Files:**
- Create: `apps/mobile/src/auth/session-store.ts`, `apps/mobile/src/auth/google.ts`
- Create: `apps/mobile/app/(auth)/_layout.tsx`, `login.tsx`, `register.tsx`, `forgot.tsx`
- Create: `apps/mobile/src/ui/Toast.tsx`

**Interfaces:**
- Consumes: `api`, `configureApi` (Task 4); `LoginSchema`, `RegisterSchema` (`@asm/contracts`).
- Produces: `useSession` store `{ token: string | null; ready: boolean; hydrate(): Promise<void>; signIn(token: string): Promise<void>; signOut(opts?: { remote?: boolean }): Promise<void> }`; `signInWithGoogle(): Promise<string>` (returns session token); `toast(message: string)`.

- [ ] **Step 1: Session store**

```ts
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { api, configureApi } from "@/api/client";
import { queryClient } from "@/api/queries";
import { toast } from "@/ui/Toast";

const KEY = "ixt.session";

interface SessionState {
  token: string | null;
  ready: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: (opts?: { remote?: boolean }) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  token: null,
  ready: false,
  hydrate: async () => {
    const token = await SecureStore.getItemAsync(KEY);
    set({ token, ready: true });
  },
  signIn: async (token) => {
    await SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    set({ token });
  },
  signOut: async ({ remote = true } = {}) => {
    if (remote && get().token) await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await SecureStore.deleteItemAsync(KEY);
    queryClient.clear();
    set({ token: null });
  },
}));

configureApi({
  token: () => useSession.getState().token,
  logout: () => void useSession.getState().signOut({ remote: false }),
  toast,
});
```

- [ ] **Step 2: Toast host**

`src/ui/Toast.tsx`:

```tsx
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { create } from "zustand";
import { color, radius, space } from "@/theme/tokens";

type ToastItem = { id: number; message: string; tone: "neutral" | "up" | "down" };
const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, "id">) => void; drop: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (t) => set((s) => ({ items: [...s.items.slice(-2), { ...t, id: Date.now() + Math.random() }] })),
    drop: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  }),
);

export function toast(message: string, tone: ToastItem["tone"] = "neutral") {
  useToasts.getState().push({ message, tone });
}

function ToastRow({ item }: { item: ToastItem }) {
  const drop = useToasts((s) => s.drop);
  useEffect(() => {
    const t = setTimeout(() => drop(item.id), 3500);
    return () => clearTimeout(t);
  }, [drop, item.id]);
  const border = item.tone === "up" ? color.up : item.tone === "down" ? color.down : color.rule;
  return (
    <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={[styles.toast, { borderColor: border }]}>
      <Text style={styles.text}>{item.message}</Text>
    </Animated.View>
  );
}

export function ToastHost() {
  const items = useToasts((s) => s.items);
  return (
    <View pointerEvents="none" style={styles.host}>
      {items.map((i) => (
        <ToastRow key={i.id} item={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", top: 56, left: space(4), right: space(4), gap: space(2) },
  toast: { backgroundColor: color.panel, borderWidth: 1, borderRadius: radius.md, padding: space(3) },
  text: { color: color.ink, fontSize: 14 },
});
```

- [ ] **Step 3: Google sign-in helper**

`src/auth/google.ts`:

```ts
import { GoogleSignin, isSuccessResponse } from "@react-native-google-signin/google-signin";
import { z } from "zod";
import { api } from "@/api/client";

const GoogleResult = z.object({ token: z.string(), userId: z.string(), created: z.boolean() });

/** The web OAuth client id; Google issues the ID token for it (server accepts it as an audience). */
export function configureGoogle(webClientId: string) {
  GoogleSignin.configure({ webClientId, offlineAccess: false });
}

export async function signInWithGoogle(): Promise<string | null> {
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (!isSuccessResponse(res) || !res.data.idToken) return null;
  const out = await api("/api/v1/auth/google/native", {
    method: "POST",
    body: { idToken: res.data.idToken },
    schema: GoogleResult,
    auth: false,
  });
  return out.token;
}
```

Add `googleWebClientId: process.env.APP_GOOGLE_WEB_CLIENT_ID ?? ""` to `extra` in `app.config.ts`, extend `configFrom` (and its test) with `googleWebClientId: string`, and add the `@react-native-google-signin/google-signin` config plugin to `plugins`.

- [ ] **Step 4: Screens**

`app/(auth)/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`app/(auth)/login.tsx`:

```tsx
import { Link, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { LoginSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { useSession } from "@/auth/session-store";
import { signInWithGoogle } from "@/auth/google";
import { Button, Screen, Txt } from "@/theme/ui";
import { color, radius, space } from "@/theme/tokens";

const TokenResult = z.object({ token: z.string(), userId: z.string() });

export default function Login() {
  const { t } = useTranslation();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const parsed = LoginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your details.");
    setBusy(true);
    setError(null);
    try {
      const out = await api("/api/auth/login", { method: "POST", body: parsed.data, schema: TokenResult, auth: false });
      await signIn(out.token);
      router.replace("/lock-setup");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      const token = await signInWithGoogle();
      if (token) {
        await signIn(token);
        router.replace("/lock-setup");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.wrap}>
      <Txt variant="title">{t("auth.login")}</Txt>
      <TextInput style={styles.input} placeholder={t("auth.email")} placeholderTextColor={color.ink2} autoCapitalize="none"
        autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder={t("auth.password")} placeholderTextColor={color.ink2} secureTextEntry
        autoComplete="password" value={password} onChangeText={setPassword} onSubmitEditing={submit} />
      {error ? <Txt style={{ color: color.down }}>{error}</Txt> : null}
      <Button label={t("auth.login")} onPress={submit} busy={busy} />
      <Button label={t("auth.google")} kind="secondary" onPress={google} disabled={busy} />
      <View style={styles.links}>
        <Link href="/forgot"><Txt variant="small">{t("auth.forgot")}</Txt></Link>
        <Link href="/register"><Txt variant="small">{t("auth.noAccount")}</Txt></Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space(5), gap: space(3), justifyContent: "center" },
  input: { minHeight: 48, borderRadius: radius.md, backgroundColor: color.tile, color: color.ink, paddingHorizontal: space(4), fontSize: 16 },
  links: { flexDirection: "row", justifyContent: "space-between", marginTop: space(2) },
});
```

`app/(auth)/register.tsx`: same structure as login, validating with `RegisterSchema` (read its fields in `packages/contracts/src/auth.ts` and render one `TextInput` per required field), posting to `/api/auth/register`, then `signIn` + `router.replace("/lock-setup")`. Link back with `t("auth.haveAccount")`.

`app/(auth)/forgot.tsx`: one email `TextInput`, `Button` that posts `{ email }` (validated by `PasswordResetRequestSchema`) to `/api/auth/password-reset/request` with `auth: false`, then shows `t("auth.resetSent")` regardless of the outcome (same privacy behaviour as the web). The emailed link opens the website's reset page in the browser.

- [ ] **Step 5: Manual check and commit**

Run the app against a local web server (`APP_API_URL=http://10.0.2.2:3000`): log in with a seeded user from `packages/db/prisma/seed.ts` → lands on `/lock-setup` (a blank route until Task 6 — create `app/lock-setup.tsx` returning `null` for now). Wrong password shows "Email or password is incorrect."

```bash
git add apps/mobile
git commit -m "feat(mobile): session store, email and Google sign-in"
```

---

### Task 6: App lock (biometric / PIN)

**Files:**
- Create: `apps/mobile/src/lock/rules.ts`, `rules.test.ts`, `pin.ts`, `pin.test.ts`, `lock-store.ts`
- Create: `apps/mobile/app/lock.tsx`, `apps/mobile/app/lock-setup.tsx`, `apps/mobile/src/lock/PinPad.tsx`

**Interfaces:**
- Produces:
  - `LOCK_AFTER_MS = 300_000`, `MAX_PIN_ATTEMPTS = 5`
  - `shouldLock(input: { enabled: boolean; coldStart: boolean; backgroundedAt: number | null; now: number }): boolean`
  - `hashPin(pin: string, salt: string, sha256: (s: string) => Promise<string>): Promise<string>`, `isValidPin(pin: string): boolean`
  - `useLock` store: `{ enabled, method: "biometric" | "pin" | null, locked, attempts, load(), enableBiometric(), setPin(pin), verifyPin(pin): Promise<"ok" | "wrong" | "logout">, unlockWithBiometric(): Promise<boolean>, onBackground(now), onForeground(now), disable() }`

- [ ] **Step 1: Failing tests**

`src/lock/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOCK_AFTER_MS, shouldLock } from "./rules";

const now = 1_000_000_000;

describe("shouldLock", () => {
  it("locks on a cold start when the lock is on", () => {
    expect(shouldLock({ enabled: true, coldStart: true, backgroundedAt: null, now })).toBe(true);
  });
  it("locks after five minutes in the background", () => {
    expect(shouldLock({ enabled: true, coldStart: false, backgroundedAt: now - LOCK_AFTER_MS, now })).toBe(true);
  });
  it("stays unlocked after a short trip to another app", () => {
    expect(shouldLock({ enabled: true, coldStart: false, backgroundedAt: now - 60_000, now })).toBe(false);
  });
  it("never locks when the user turned the lock off", () => {
    expect(shouldLock({ enabled: false, coldStart: true, backgroundedAt: null, now })).toBe(false);
  });
});
```

`src/lock/pin.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPin, isValidPin } from "./pin";

const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");

describe("pin", () => {
  it("accepts exactly four digits", () => {
    expect(isValidPin("0420")).toBe(true);
    expect(isValidPin("042")).toBe(false);
    expect(isValidPin("04a0")).toBe(false);
  });
  it("hashes with the install salt so equal PINs on two phones differ", async () => {
    const a = await hashPin("1234", "salt-a", sha256);
    const b = await hashPin("1234", "salt-b", sha256);
    expect(a).not.toBe(b);
    expect(a).toBe(await hashPin("1234", "salt-a", sha256));
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `rules.ts` and `pin.ts`**

```ts
// rules.ts
export const LOCK_AFTER_MS = 5 * 60 * 1000;
export const MAX_PIN_ATTEMPTS = 5;

export function shouldLock(input: { enabled: boolean; coldStart: boolean; backgroundedAt: number | null; now: number }): boolean {
  if (!input.enabled) return false;
  if (input.coldStart) return true;
  return input.backgroundedAt !== null && input.now - input.backgroundedAt >= LOCK_AFTER_MS;
}
```

```ts
// pin.ts
export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function hashPin(pin: string, salt: string, sha256: (s: string) => Promise<string>): Promise<string> {
  return sha256(`${salt}:${pin}`);
}
```

Run → PASS.

- [ ] **Step 3: Lock store**

```ts
import * as Crypto from "expo-crypto";
import * as LocalAuth from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { useSession } from "@/auth/session-store";
import { hashPin } from "./pin";
import { MAX_PIN_ATTEMPTS, shouldLock } from "./rules";

const K = { method: "ixt.lock.method", pin: "ixt.lock.pin", salt: "ixt.lock.salt", off: "ixt.lock.off" };
const sha256 = (s: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);

interface LockState {
  enabled: boolean;
  method: "biometric" | "pin" | null;
  locked: boolean;
  attempts: number;
  backgroundedAt: number | null;
  load: () => Promise<void>;
  enableBiometric: () => Promise<boolean>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<"ok" | "wrong" | "logout">;
  unlockWithBiometric: () => Promise<boolean>;
  onBackground: (now: number) => void;
  onForeground: (now: number) => void;
  disable: () => Promise<void>;
  reset: () => Promise<void>;
}

export const useLock = create<LockState>((set, get) => ({
  enabled: false,
  method: null,
  locked: false,
  attempts: 0,
  backgroundedAt: null,
  load: async () => {
    const [method, off] = await Promise.all([SecureStore.getItemAsync(K.method), SecureStore.getItemAsync(K.off)]);
    const m = method === "biometric" || method === "pin" ? method : null;
    const enabled = m !== null && off !== "1";
    set({ method: m, enabled, locked: shouldLock({ enabled, coldStart: true, backgroundedAt: null, now: Date.now() }) });
  },
  enableBiometric: async () => {
    const ok = (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
    if (!ok) return false;
    const res = await LocalAuth.authenticateAsync({ promptMessage: "IndianxTrade" });
    if (!res.success) return false;
    await SecureStore.setItemAsync(K.method, "biometric");
    await SecureStore.deleteItemAsync(K.off);
    set({ method: "biometric", enabled: true, locked: false });
    return true;
  },
  setPin: async (pin) => {
    let salt = await SecureStore.getItemAsync(K.salt);
    if (!salt) {
      salt = Crypto.randomUUID();
      await SecureStore.setItemAsync(K.salt, salt);
    }
    await SecureStore.setItemAsync(K.pin, await hashPin(pin, salt, sha256));
    await SecureStore.setItemAsync(K.method, "pin");
    await SecureStore.deleteItemAsync(K.off);
    set({ method: "pin", enabled: true, locked: false, attempts: 0 });
  },
  verifyPin: async (pin) => {
    const [salt, stored] = await Promise.all([SecureStore.getItemAsync(K.salt), SecureStore.getItemAsync(K.pin)]);
    if (salt && stored && (await hashPin(pin, salt, sha256)) === stored) {
      set({ locked: false, attempts: 0 });
      return "ok";
    }
    const attempts = get().attempts + 1;
    if (attempts >= MAX_PIN_ATTEMPTS) {
      await get().reset();
      await useSession.getState().signOut();
      return "logout";
    }
    set({ attempts });
    return "wrong";
  },
  unlockWithBiometric: async () => {
    const res = await LocalAuth.authenticateAsync({ promptMessage: "IndianxTrade", fallbackLabel: "" });
    if (res.success) set({ locked: false, attempts: 0 });
    return res.success;
  },
  onBackground: (now) => set({ backgroundedAt: now }),
  onForeground: (now) => {
    const { enabled, backgroundedAt } = get();
    if (shouldLock({ enabled, coldStart: false, backgroundedAt, now })) set({ locked: true });
    set({ backgroundedAt: null });
  },
  disable: async () => {
    await SecureStore.setItemAsync(K.off, "1");
    set({ enabled: false, locked: false });
  },
  reset: async () => {
    await Promise.all(Object.values(K).map((k) => SecureStore.deleteItemAsync(k)));
    set({ enabled: false, method: null, locked: false, attempts: 0 });
  },
}));
```

Note for the reviewer: "biometric" users get no PIN fallback by design; if biometrics later fail repeatedly the system prompt itself offers the device credential, and "Forgot? Log in again" is always available.

- [ ] **Step 4: PIN pad and screens**

`src/lock/PinPad.tsx`:

```tsx
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space } from "@/theme/tokens";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

export function PinPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  function press(k: string) {
    if (!k) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (k === "⌫") onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  }
  return (
    <View style={{ gap: space(6) }}>
      <View style={styles.dots}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < value.length && { backgroundColor: color.brand }]} />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((k, i) => (
          <Pressable key={i} accessibilityLabel={k === "⌫" ? "Delete" : k} onPress={() => press(k)} style={styles.key}>
            <Text style={styles.keyText}>{k}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", justifyContent: "center", gap: space(4) },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: color.ink2 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space(3) },
  key: { width: 76, height: 64, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color.tile },
  keyText: { color: color.ink, fontSize: 24, fontWeight: "600" },
});
```

`app/lock-setup.tsx`:

```tsx
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLock } from "@/lock/lock-store";
import { PinPad } from "@/lock/PinPad";
import { Button, Screen, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

export default function LockSetup() {
  const { t } = useTranslation();
  const { enableBiometric, setPin } = useLock();
  const [step, setStep] = useState<"choose" | "pin" | "confirm">("choose");
  const [first, setFirst] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value.length !== 4) return;
    if (step === "pin") {
      setFirst(value);
      setValue("");
      setStep("confirm");
    } else if (step === "confirm") {
      if (value === first) void setPin(value).then(() => router.replace("/trade"));
      else {
        setError(t("lock.mismatch"));
        setValue("");
        setStep("pin");
      }
    }
  }, [value, step, first, setPin, t]);

  return (
    <Screen style={{ padding: space(5), gap: space(4), justifyContent: "center" }}>
      <Txt variant="title">{t("lock.setupTitle")}</Txt>
      {step === "choose" ? (
        <>
          <Button label={t("lock.useBiometric")} onPress={async () => ((await enableBiometric()) ? router.replace("/trade") : setStep("pin"))} />
          <Button label={t("lock.setPin")} kind="secondary" onPress={() => setStep("pin")} />
          <Button label={t("lock.skip")} kind="secondary" onPress={() => router.replace("/trade")} />
        </>
      ) : (
        <>
          <Txt>{step === "pin" ? t("lock.setPin") : t("lock.confirmPin")}</Txt>
          {error ? <Txt variant="small">{error}</Txt> : null}
          <PinPad value={value} onChange={setValue} />
        </>
      )}
    </Screen>
  );
}
```

Skip behaviour per spec: skipping leaves the lock off for this session; on the next cold start, if `method` is null and a session exists, the root layout routes to `/lock-setup` again (Task 7).

`app/lock.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@/auth/session-store";
import { MAX_PIN_ATTEMPTS } from "@/lock/rules";
import { useLock } from "@/lock/lock-store";
import { PinPad } from "@/lock/PinPad";
import { Button, Screen, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

export default function Lock() {
  const { t } = useTranslation();
  const { method, attempts, verifyPin, unlockWithBiometric, reset } = useLock();
  const signOut = useSession((s) => s.signOut);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (method === "biometric") void unlockWithBiometric();
  }, [method, unlockWithBiometric]);

  useEffect(() => {
    if (value.length === 4) void verifyPin(value).then(() => setValue(""));
  }, [value, verifyPin]);

  return (
    <Screen style={{ padding: space(5), gap: space(5), justifyContent: "center" }}>
      <Txt variant="title">{t("lock.title")}</Txt>
      {method === "pin" ? (
        <>
          {attempts > 0 ? <Txt variant="small">{t("lock.wrongPin", { left: MAX_PIN_ATTEMPTS - attempts })}</Txt> : null}
          <PinPad value={value} onChange={setValue} />
        </>
      ) : (
        <Button label={t("lock.useBiometric")} onPress={() => void unlockWithBiometric()} />
      )}
      <Button label={t("lock.forgotPin")} kind="secondary" onPress={async () => { await reset(); await signOut(); }} />
    </Screen>
  );
}
```

- [ ] **Step 5: Run tests, manual check, commit**

Run: `pnpm --filter @asm/mobile test` → PASS. Manually: set a PIN, kill and reopen the app → lock screen; 5 wrong PINs → back to login.

```bash
git add apps/mobile
git commit -m "feat(mobile): biometric/PIN app lock with 5-minute relock"
```

---

### Task 7: Root layout, gate screens and tab shell

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`; delete `apps/mobile/app/index.tsx`
- Create: `apps/mobile/app/(tabs)/_layout.tsx`, `trade.tsx` (placeholder until Task 12), `payments.tsx`, `history.tsx`, `account.tsx`
- Create: `apps/mobile/app/maintenance.tsx`, `blocked.tsx`, `update-required.tsx`, `apps/mobile/src/ui/OfflineBanner.tsx`, `apps/mobile/src/gate/route-for.ts`, `route-for.test.ts`

**Interfaces:**
- Produces: `routeFor(state: { ready: boolean; token: string | null; locked: boolean; lockChosen: boolean; gate: GateState; belowMin: boolean }): "/splash" | "/login" | "/lock" | "/lock-setup" | "/maintenance" | "/blocked" | "/update-required" | null` (null = stay where you are). Pure.

- [ ] **Step 1: Failing test for `routeFor`**

```ts
import { describe, expect, it } from "vitest";
import { routeFor } from "./route-for";

const base = { ready: true, token: "t", locked: false, lockChosen: true, gate: "ok" as const, belowMin: false };

describe("routeFor", () => {
  it("waits on the splash until storage is read", () => {
    expect(routeFor({ ...base, ready: false })).toBe("/splash");
  });
  it("forces an update before anything else", () => {
    expect(routeFor({ ...base, token: null, belowMin: true })).toBe("/update-required");
  });
  it("shows maintenance and VPN screens over everything but the update screen", () => {
    expect(routeFor({ ...base, gate: "maintenance" })).toBe("/maintenance");
    expect(routeFor({ ...base, gate: "blocked" })).toBe("/blocked");
  });
  it("sends a signed-out user to login", () => {
    expect(routeFor({ ...base, token: null })).toBe("/login");
  });
  it("asks a signed-in user to unlock before trading", () => {
    expect(routeFor({ ...base, locked: true })).toBe("/lock");
  });
  it("offers lock setup when no lock was chosen yet", () => {
    expect(routeFor({ ...base, lockChosen: false })).toBe("/lock-setup");
  });
  it("lets an unlocked user stay where they are", () => {
    expect(routeFor(base)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `route-for.ts`**

```ts
import type { GateState } from "@/api/errors";

export type GateRoute =
  | "/splash" | "/login" | "/lock" | "/lock-setup" | "/maintenance" | "/blocked" | "/update-required";

export function routeFor(s: {
  ready: boolean;
  token: string | null;
  locked: boolean;
  lockChosen: boolean;
  gate: GateState;
  belowMin: boolean;
}): GateRoute | null {
  if (!s.ready) return "/splash";
  if (s.belowMin || s.gate === "upgrade") return "/update-required";
  if (s.gate === "maintenance") return "/maintenance";
  if (s.gate === "blocked") return "/blocked";
  if (!s.token) return "/login";
  if (s.locked) return "/lock";
  if (!s.lockChosen) return "/lock-setup";
  return null;
}
```

Run → PASS.

- [ ] **Step 3: Root layout**

`app/_layout.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { compareVersions } from "@asm/client-core";
import { Stack, router, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { getLocales } from "expo-localization";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { queryClient, useAppConfig } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { appConfig } from "@/config";
import { useGate } from "@/gate/gate-store";
import { routeFor } from "@/gate/route-for";
import { initI18n, localeFromDevice } from "@/i18n";
import { useLock } from "@/lock/lock-store";
import { OfflineBanner } from "@/ui/OfflineBanner";
import { ToastHost } from "@/ui/Toast";
import { color } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync();
initI18n(localeFromDevice(getLocales().map((l) => l.languageTag)));

function Gatekeeper() {
  const { ready, token, hydrate } = useSession();
  const { locked, method, load, onBackground, onForeground } = useLock();
  const gate = useGate((s) => s.gate);
  const cfg = useAppConfig();
  const pathname = usePathname();
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void Promise.all([hydrate(), load()]).then(() => SplashScreen.hideAsync());
  }, [hydrate, load]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") onBackground(Date.now());
      if (s === "active") onForeground(Date.now());
    });
    return () => sub.remove();
  }, [onBackground, onForeground]);

  const belowMin = cfg.data ? compareVersions(appConfig().version, cfg.data.minVersion) < 0 : false;
  const target = routeFor({ ready, token, locked, lockChosen: method !== null, gate, belowMin });

  useEffect(() => {
    if (target === "/splash") return;
    if (target && pathname !== target) router.replace(target);
    else if (!target && ["/login", "/lock", "/lock-setup", "/maintenance", "/blocked", "/update-required", "/"].includes(pathname)) {
      router.replace("/trade");
    }
  }, [target, pathname]);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <BottomSheetModalProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg }, animation: "fade" }} />
          <Gatekeeper />
          <OfflineBanner />
          <ToastHost />
        </BottomSheetModalProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
```

Install `expo-splash-screen` and `expo-localization` with `pnpm exec expo install expo-splash-screen expo-localization`. If `compareVersions` stayed in `apps/web` (not moved in P1 Task 15 because it lives in `app-client.ts`), copy the 10-line function into `apps/mobile/src/version.ts` with its test from P1 Task 3.

Note: the "lock-setup on skip" rule: `lockChosen` is `method !== null`; skipping does not set a method, so the user sees lock setup again on the next cold start — but within the same session, `lock-setup.tsx` "Not now" sets a session-only flag. Add to the lock store: `skippedThisSession: boolean` (default false), set true by "Not now", and pass `lockChosen: method !== null || skippedThisSession`.

- [ ] **Step 4: Gate screens**

`app/maintenance.tsx`:

```tsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useGate } from "@/gate/gate-store";
import { Screen, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

export default function Maintenance() {
  const { t } = useTranslation();
  useEffect(() => {
    const id = setInterval(() => {
      // Any successful call clears the gate (api() resets it on "ok").
      void api("/api/v1/app/config", { auth: false }).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, []);
  useGate();
  return (
    <Screen style={{ padding: space(6), justifyContent: "center", gap: space(3) }}>
      <Txt variant="title">{t("gate.maintenanceTitle")}</Txt>
      <Txt>{t("gate.maintenanceBody")}</Txt>
    </Screen>
  );
}
```

`app/blocked.tsx`: same layout with `gate.blockedTitle` / `gate.blockedBody` and a `Button` `common.retry` that calls `useGate.getState().setGate("ok")` then `api("/api/v1/bootstrap").catch(() => {})`.

`app/update-required.tsx`:

```tsx
import * as Linking from "expo-linking";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "@/api/queries";
import { appConfig } from "@/config";
import { Button, Screen, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

export default function UpdateRequired() {
  const { t } = useTranslation();
  const cfg = useAppConfig().data;
  const target =
    appConfig().variant === "play" && cfg?.playLive && cfg.playUrl
      ? cfg.playUrl
      : `${appConfig().apiUrl}${cfg?.apkUrl ?? "/download/app"}`;
  return (
    <Screen style={{ padding: space(6), justifyContent: "center", gap: space(3) }}>
      <Txt variant="title">{t("gate.updateTitle")}</Txt>
      <Txt>{t("gate.updateBody")}</Txt>
      <Button label={t("gate.update")} onPress={() => void Linking.openURL(target)} />
    </Screen>
  );
}
```

`src/ui/OfflineBanner.tsx`:

```tsx
import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSocket } from "@/socket/socket-store";
import { color, space } from "@/theme/tokens";

export function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(true);
  const failures = useSocket((s) => s.consecutiveFailures);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false)), []);
  if (online && failures < 2) return null;
  return (
    <View style={{ position: "absolute", bottom: 72, left: space(4), right: space(4), backgroundColor: color.panel, borderRadius: 10, padding: space(2) }}>
      <Text style={{ color: color.ink, textAlign: "center" }}>{t("common.offline")}</Text>
    </View>
  );
}
```

(`useSocket` arrives in Task 8 — build Task 8 before running this screen, or stub `failures = 0` until then.)

- [ ] **Step 5: Tabs**

`app/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/ui/Icon";
import { color } from "@/theme/tokens";

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: color.panel, borderTopColor: color.rule, height: 60 },
        tabBarActiveTintColor: color.brand,
        tabBarInactiveTintColor: color.ink2,
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen name="trade" options={{ title: t("tabs.trade"), tabBarIcon: ({ color: c }) => <Icon name="trade" color={c} /> }} />
      <Tabs.Screen name="payments" options={{ title: t("tabs.payments"), tabBarIcon: ({ color: c }) => <Icon name="wallet" color={c} /> }} />
      <Tabs.Screen name="history" options={{ title: t("tabs.history"), tabBarIcon: ({ color: c }) => <Icon name="history" color={c} /> }} />
      <Tabs.Screen name="account" options={{ title: t("tabs.account"), tabBarIcon: ({ color: c }) => <Icon name="user" color={c} /> }} />
    </Tabs>
  );
}
```

`payments.tsx`, `history.tsx`, `account.tsx` (placeholders until P3), each:

```tsx
import { useTranslation } from "react-i18next";
import { Screen, Txt } from "@/theme/ui";
export default function Payments() {
  const { t } = useTranslation();
  return <Screen style={{ padding: 16 }}><Txt variant="title">{t("tabs.payments")}</Txt></Screen>;
}
```

(change the component name and key per file). `account.tsx` additionally renders a `Button` "Log out" calling `useSession.getState().signOut()` so testers can sign out before P3.

- [ ] **Step 6: Android back for sheets**

Sheets are `BottomSheetModal`s (Task 11); `@gorhom/bottom-sheet` closes the top modal on hardware back when `enableDismissOnClose` and the provider are in place. Verify manually in Task 13 that back closes a sheet before leaving the screen.

- [ ] **Step 7: Run and commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual: signed-out → login; signed-in → tabs; set `MAINTENANCE_MODE=1` on the local web → maintenance screen within one request; unset → back after ≤ 30s.

```bash
git add apps/mobile
git commit -m "feat(mobile): gatekeeper routing, gate screens and tab shell"
```

---

### Task 8: Engine socket and socket store

**Files:**
- Create: `apps/mobile/src/socket/engine-socket.ts`, `engine-socket.test.ts`, `socket-store.ts`, `backoff.ts`, `backoff.test.ts`

**Interfaces:**
- Consumes: `applyChartMessage`, `initialChartState`, `canLoadOlder`, `applyTradeMessage`, `initialTradeState` (`@asm/client-core`); `ServerMessage`, `ClientMessage`, `Timeframe` (`@asm/contracts`).
- Produces:
  - `backoffDelay(attempt: number, random: () => number): number` — base `[500, 1000, 2000, 4000, 8000]` then 15000, × (0.8 + 0.4·random)
  - `class EngineSocket` constructor `(deps: { url: string; fetchTicket: () => Promise<string>; WebSocketImpl: typeof WebSocket; onMessage: (m: ServerMessage) => void; onStatus: (s: SocketStatus) => void; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; random?: () => number })`, methods `start()`, `stop()`, `subscribe(symbol, timeframe)`, `loadOlder(before: number)`; `type SocketStatus = { phase: "idle" | "connecting" | "authed" | "closed"; consecutiveFailures: number }`
  - `useSocket` store: `{ phase, consecutiveFailures, chart: ChartState, trades: TradeState, start(), stop(), subscribe(symbol, tf), loadOlder(), seed(boot: Bootstrap) }`

- [ ] **Step 1: Failing tests**

`src/socket/backoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { backoffDelay } from "./backoff";

describe("backoffDelay", () => {
  it("grows 0.5s, 1s, 2s, 4s, 8s then caps at 15s (no jitter at random=0.5)", () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => backoffDelay(a, mid))).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000]);
  });
  it("applies ±20% jitter", () => {
    expect(backoffDelay(0, () => 0)).toBe(400);
    expect(backoffDelay(0, () => 1)).toBe(600);
  });
});
```

`src/socket/engine-socket.test.ts` (fake WebSocket + fake timers):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngineSocket, type SocketStatus } from "./engine-socket";

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("EngineSocket", () => {
  let statuses: SocketStatus[];
  let messages: unknown[];
  let socket: EngineSocket;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    FakeWS.instances = [];
    statuses = [];
    messages = [];
    socket = new EngineSocket({
      url: "wss://test/ws",
      fetchTicket: async () => "ticket-1",
      WebSocketImpl: FakeWS as unknown as typeof WebSocket,
      onMessage: (m) => messages.push(m),
      onStatus: (s) => statuses.push(s),
      random: () => 0.5,
    });
  });

  it("authenticates with a fresh ticket, then subscribes", async () => {
    socket.subscribe("EURUSD", "1m");
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    const ws = FakeWS.instances[0]!;
    ws.open();
    expect(ws.sent[0]).toEqual({ type: "auth", token: "ticket-1" });
    ws.receive({ type: "authed" });
    expect(ws.sent[1]).toEqual({ type: "subscribe", symbol: "EURUSD", timeframe: "1m" });
    expect(statuses.at(-1)).toEqual({ phase: "authed", consecutiveFailures: 0 });
  });

  it("re-subscribes to the active market after reconnecting", async () => {
    socket.subscribe("EURUSD", "5m");
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.receive({ type: "authed" });
    FakeWS.instances[0]!.close();
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeWS.instances[1]!;
    second.open();
    second.receive({ type: "authed" });
    expect(second.sent).toContainEqual({ type: "subscribe", symbol: "EURUSD", timeframe: "5m" });
  });

  it("counts consecutive failures and backs off", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    FakeWS.instances[0]!.close();
    expect(statuses.at(-1)).toMatchObject({ phase: "closed", consecutiveFailures: 1 });
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeWS.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(FakeWS.instances).toHaveLength(2);
  });

  it("does not reconnect after stop()", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    socket.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it("forwards server messages", async () => {
    socket.start();
    await vi.runOnlyPendingTimersAsync();
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.receive({ type: "tick", symbol: "EURUSD", price: 1.1, ts: 1 });
    expect(messages).toContainEqual({ type: "tick", symbol: "EURUSD", price: 1.1, ts: 1 });
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `backoff.ts` and `engine-socket.ts`**

```ts
// backoff.ts
const STEPS = [500, 1000, 2000, 4000, 8000];
const CAP = 15_000;

export function backoffDelay(attempt: number, random: () => number): number {
  const base = attempt < STEPS.length ? STEPS[attempt]! : CAP;
  return Math.round(base * (0.8 + 0.4 * random()));
}
```

```ts
// engine-socket.ts
import type { ClientMessage, ServerMessage, Timeframe } from "@asm/contracts";
import { backoffDelay } from "./backoff";

export type SocketStatus = { phase: "idle" | "connecting" | "authed" | "closed"; consecutiveFailures: number };

interface Deps {
  url: string;
  fetchTicket: () => Promise<string>;
  WebSocketImpl: typeof WebSocket;
  onMessage: (m: ServerMessage) => void;
  onStatus: (s: SocketStatus) => void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  random?: () => number;
}

/**
 * One engine connection: ticket → auth → subscribe, with backoff reconnects.
 * Framework-free so it can be unit-tested with a fake WebSocket.
 */
export class EngineSocket {
  private ws: WebSocket | null = null;
  private wanted = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sub: { symbol: string; timeframe: Timeframe } | null = null;
  private authed = false;

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.schedule(0);
  }

  stop(): void {
    this.wanted = false;
    if (this.timer) (this.deps.clearTimer ?? clearTimeout)(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    this.authed = false;
    ws?.close();
    this.status("idle");
  }

  subscribe(symbol: string, timeframe: Timeframe): void {
    const prev = this.sub;
    this.sub = { symbol, timeframe };
    if (!this.authed) return;
    if (prev && prev.symbol !== symbol) this.send({ type: "unsubscribe", symbol: prev.symbol });
    this.send({ type: "subscribe", symbol, timeframe });
  }

  loadOlder(before: number, limit = 200): void {
    if (!this.authed || !this.sub) return;
    this.send({ type: "candles:loadOlder", symbol: this.sub.symbol, timeframe: this.sub.timeframe, before, limit });
  }

  private schedule(delay: number): void {
    this.timer = (this.deps.setTimer ?? setTimeout)(() => void this.connect(), delay);
  }

  private async connect(): Promise<void> {
    if (!this.wanted) return;
    this.status("connecting");
    let ticket: string;
    try {
      ticket = await this.deps.fetchTicket();
    } catch {
      return this.fail();
    }
    if (!this.wanted) return;
    const ws = new this.deps.WebSocketImpl(this.deps.url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: ticket } satisfies ClientMessage));
    ws.onmessage = (e: MessageEvent | { data: string }) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "authed") {
        this.authed = true;
        this.failures = 0;
        this.status("authed");
        if (this.sub) this.send({ type: "subscribe", ...this.sub });
      }
      this.deps.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.authed = false;
      this.fail();
    };
    ws.onerror = () => ws.close();
  }

  private fail(): void {
    this.failures += 1;
    this.status("closed");
    if (this.wanted) this.schedule(backoffDelay(this.failures - 1, this.deps.random ?? Math.random));
  }

  private send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  private status(phase: SocketStatus["phase"]): void {
    this.deps.onStatus({ phase, consecutiveFailures: this.failures });
  }
}
```

Run: `pnpm --filter @asm/mobile test` → PASS.

- [ ] **Step 3: Socket store**

`src/socket/socket-store.ts`:

```ts
import { z } from "zod";
import { create } from "zustand";
import {
  applyChartMessage,
  applyTradeMessage,
  canLoadOlder,
  initialChartState,
  initialTradeState,
  withOpenResult,
  type ChartState,
  type TradeState,
} from "@asm/client-core";
import type { Bootstrap, OpenTradeResult, ServerMessage, Timeframe, TradeView } from "@asm/contracts";
import { api } from "@/api/client";
import { appConfig } from "@/config";
import { EngineSocket } from "./engine-socket";

const Ticket = z.object({ ticket: z.string() });

interface SocketStore {
  phase: "idle" | "connecting" | "authed" | "closed";
  consecutiveFailures: number;
  chart: ChartState;
  trades: TradeState;
  lastSettled: TradeView | null;
  seed: (boot: Bootstrap) => void;
  start: () => void;
  stop: () => void;
  subscribe: (symbol: string, timeframe: Timeframe) => void;
  loadOlder: () => void;
  applyOpenResult: (r: OpenTradeResult) => void;
}

let engine: EngineSocket | null = null;

export const useSocket = create<SocketStore>((set, get) => {
  const onMessage = (m: ServerMessage) =>
    set((s) => {
      const next: Partial<SocketStore> = {
        chart: applyChartMessage(s.chart, m),
        trades: applyTradeMessage(s.trades, m),
      };
      if (m.type === "trade:settled") next.lastSettled = m.trade;
      return next;
    });

  const ensure = () =>
    (engine ??= new EngineSocket({
      url: appConfig().wsUrl,
      fetchTicket: async () => (await api("/api/auth/ws-ticket", { method: "POST", schema: Ticket })).ticket,
      WebSocketImpl: WebSocket,
      onMessage,
      onStatus: (st) => set({ phase: st.phase, consecutiveFailures: st.consecutiveFailures }),
    }));

  return {
    phase: "idle",
    consecutiveFailures: 0,
    chart: initialChartState("", "1m"),
    trades: initialTradeState([], {}),
    lastSettled: null,
    seed: (boot) =>
      set({
        trades: initialTradeState(
          boot.recentTrades as unknown as TradeView[],
          Object.fromEntries(boot.accounts.map((a) => [a.id, { realBalance: a.realBalance, bonusBalance: a.bonusBalance }])),
        ),
      }),
    start: () => ensure().start(),
    stop: () => {
      engine?.stop();
    },
    subscribe: (symbol, timeframe) => {
      set({ chart: initialChartState(symbol, timeframe) });
      ensure().subscribe(symbol, timeframe);
    },
    loadOlder: () => {
      const { chart } = get();
      const first = chart.candles[0];
      if (!first || !canLoadOlder(chart)) return;
      set({ chart: { ...chart, loadingOlder: true } });
      ensure().loadOlder(first.openTs);
    },
    applyOpenResult: (r) => set((s) => ({ trades: withOpenResult(s.trades, r, s.phase === "authed") })),
  };
});
```

Start/stop with app state: in `app/(tabs)/_layout.tsx` add an effect — on mount `useSocket.getState().start()`; `AppState` `background` → `stop()`; `active` → `start()`; unmount → `stop()`.

Before writing this, check `applyChartMessage` in `@asm/client-core` ignores messages for other symbols/timeframes and sets `loadingOlder: false` on `candles:older` (read `chart/engine-state.ts`); if not, the store must filter by `chart.symbol` before applying.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck` → PASS.

```bash
git add apps/mobile/src/socket "apps/mobile/app/(tabs)/_layout.tsx"
git commit -m "feat(mobile): engine socket with backoff and shared store"
```

---

### Task 9: Resume cache

**Files:**
- Create: `apps/mobile/src/cache/resume-cache.ts`, `codec.ts`, `codec.test.ts`

**Interfaces:**
- Produces:
  - `encodeResume(s: ResumeSnapshot): string`, `decodeResume(raw: string | undefined, now: number): ResumeSnapshot | null` (pure; returns null for corrupt data or snapshots older than 24h)
  - `type ResumeSnapshot = { v: 1; savedAt: number; userId: string; symbol: string; timeframe: Timeframe; candles: CandleDto[]; balances: Record<string, BalancesDto>; openTrades: TradeView[]; accountId: string }`
  - `saveResume(s)`, `loadResume(userId: string): ResumeSnapshot | null` (MMKV-backed, in `resume-cache.ts`)

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { decodeResume, encodeResume, type ResumeSnapshot } from "./codec";

const snap: ResumeSnapshot = {
  v: 1,
  savedAt: 1_000,
  userId: "u1",
  symbol: "EURUSD",
  timeframe: "1m",
  candles: Array.from({ length: 300 }, (_, i) => ({ openTs: i * 60, o: 1, h: 2, l: 0.5, c: 1.5 })),
  balances: { a1: { realBalance: 100, bonusBalance: 0 } },
  openTrades: [],
  accountId: "a1",
};

describe("resume codec", () => {
  it("round-trips and keeps only the last 200 candles", () => {
    const out = decodeResume(encodeResume(snap), 2_000)!;
    expect(out.candles).toHaveLength(200);
    expect(out.candles[0]!.openTs).toBe(100 * 60);
    expect(out.symbol).toBe("EURUSD");
  });
  it("drops snapshots older than a day", () => {
    expect(decodeResume(encodeResume(snap), 1_000 + 24 * 3600 * 1000 + 1)).toBeNull();
  });
  it("ignores corrupt or foreign data", () => {
    expect(decodeResume("{nope", 2_000)).toBeNull();
    expect(decodeResume(JSON.stringify({ v: 9 }), 2_000)).toBeNull();
    expect(decodeResume(undefined, 2_000)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// codec.ts
import type { BalancesDto, CandleDto, Timeframe, TradeView } from "@asm/contracts";

export interface ResumeSnapshot {
  v: 1;
  savedAt: number;
  userId: string;
  symbol: string;
  timeframe: Timeframe;
  candles: CandleDto[];
  balances: Record<string, BalancesDto>;
  openTrades: TradeView[];
  accountId: string;
}

const MAX_AGE_MS = 24 * 3600 * 1000;
const KEEP_CANDLES = 200;

export function encodeResume(s: ResumeSnapshot): string {
  return JSON.stringify({ ...s, candles: s.candles.slice(-KEEP_CANDLES) });
}

export function decodeResume(raw: string | undefined, now: number): ResumeSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as ResumeSnapshot;
    if (s?.v !== 1 || typeof s.savedAt !== "number" || now - s.savedAt > MAX_AGE_MS) return null;
    if (!Array.isArray(s.candles) || typeof s.symbol !== "string") return null;
    return { ...s, candles: s.candles.slice(-KEEP_CANDLES) };
  } catch {
    return null;
  }
}
```

```ts
// resume-cache.ts
import { MMKV } from "react-native-mmkv";
import { decodeResume, encodeResume, type ResumeSnapshot } from "./codec";

const store = new MMKV({ id: "ixt-resume" });
const key = (userId: string) => `resume:${userId}`;

export function saveResume(s: ResumeSnapshot): void {
  store.set(key(s.userId), encodeResume(s));
}

export function loadResume(userId: string): ResumeSnapshot | null {
  return decodeResume(store.getString(key(userId)), Date.now());
}

export function clearResume(): void {
  store.clearAll();
}
```

Call `clearResume()` from `useSession.signOut`. Wire save/load in Task 12 (Trade screen).

- [ ] **Step 3: Test and commit**

Run: `pnpm --filter @asm/mobile test` → PASS.

```bash
git add apps/mobile/src/cache apps/mobile/src/auth/session-store.ts
git commit -m "feat(mobile): resume cache for instant trade screen"
```

---

### Task 10: Chart maths — scale and series paths

**Files:**
- Create: `apps/mobile/src/chart/scale.ts`, `scale.test.ts`, `paths.ts`, `paths.test.ts`, `types.ts`

**Interfaces:**
- Produces:
  - `type ChartType = "candles" | "line" | "area" | "bars"`
  - `interface Viewport { width: number; height: number; rightIndex: number; visibleCount: number }` (`rightIndex` = fractional index of the right edge; live edge = `candles.length`)
  - `clampVisible(n: number): number` (15–300)
  - `visibleRange(vp, total): { from: number; to: number }` (integer indices, inclusive from, exclusive to)
  - `priceRange(candles: CandleDto[], from, to, extra?: number[]): { min: number; max: number }` (8% padding; `extra` lets the live price and trade entries widen the range)
  - `xForIndex(i, vp): number`, `indexForX(x, vp): number`, `yForPrice(p, range, height): number`, `priceForY(y, range, height): number`
  - `zoomAround(vp, focusX, factor, total): Viewport`, `panBy(vp, dx, total): Viewport`
  - `nearLeftEdge(vp, total, threshold = 20): boolean`
  - `buildSeries(type, candles, from, to, vp, range): { up: string; down: string; line?: string; area?: string }` — SVG path strings (Skia accepts SVG path strings via `Skia.Path.MakeFromSVGString`).

- [ ] **Step 1: Failing tests for scale**

```ts
import { describe, expect, it } from "vitest";
import { clampVisible, indexForX, nearLeftEdge, panBy, priceRange, visibleRange, xForIndex, yForPrice, zoomAround } from "./scale";

const vp = { width: 300, height: 200, rightIndex: 100, visibleCount: 50 };
const candle = (i: number, l: number, h: number) => ({ openTs: i * 60, o: l, h, l, c: h });

describe("scale", () => {
  it("clamps zoom between 15 and 300 candles", () => {
    expect(clampVisible(5)).toBe(15);
    expect(clampVisible(1000)).toBe(300);
  });
  it("maps the right edge to the right side of the canvas", () => {
    expect(xForIndex(100, vp)).toBe(300);
    expect(xForIndex(50, vp)).toBe(0);
    expect(indexForX(150, vp)).toBe(75);
  });
  it("returns the integer window of visible candles", () => {
    expect(visibleRange(vp, 100)).toEqual({ from: 50, to: 100 });
    expect(visibleRange({ ...vp, rightIndex: 30 }, 100)).toEqual({ from: 0, to: 30 });
  });
  it("pads the visible high/low by 8% and includes extra prices", () => {
    const r = priceRange([candle(0, 10, 20)], 0, 1);
    expect(r.min).toBeCloseTo(9.2);
    expect(r.max).toBeCloseTo(20.8);
    expect(priceRange([candle(0, 10, 20)], 0, 1, [30]).max).toBeGreaterThan(30);
  });
  it("puts higher prices nearer the top", () => {
    const r = { min: 0, max: 100 };
    expect(yForPrice(100, r, 200)).toBe(0);
    expect(yForPrice(0, r, 200)).toBe(200);
  });
  it("zooms around the finger, keeping the price under it in place", () => {
    const z = zoomAround(vp, 150, 2, 100);
    expect(z.visibleCount).toBe(25);
    expect(indexForX(150, z)).toBeCloseTo(indexForX(150, vp));
  });
  it("pans back in time and never past the live edge", () => {
    expect(panBy(vp, 60, 100).rightIndex).toBeCloseTo(90);
    expect(panBy(vp, -600, 100).rightIndex).toBe(100);
  });
  it("detects when the user is near the oldest loaded candle", () => {
    expect(nearLeftEdge({ ...vp, rightIndex: 60 }, 100)).toBe(true);
    expect(nearLeftEdge(vp, 100)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `types.ts` + `scale.ts`**

```ts
// types.ts
export type ChartType = "candles" | "line" | "area" | "bars";
export interface Viewport {
  width: number;
  height: number;
  rightIndex: number;
  visibleCount: number;
}
export interface PriceRangeT {
  min: number;
  max: number;
}
```

```ts
// scale.ts
import type { CandleDto } from "@asm/contracts";
import type { PriceRangeT, Viewport } from "./types";

export const MIN_VISIBLE = 15;
export const MAX_VISIBLE = 300;
const PAD = 0.08;

export const clampVisible = (n: number) => Math.min(MAX_VISIBLE, Math.max(MIN_VISIBLE, n));

const step = (vp: Viewport) => vp.width / vp.visibleCount;
export const xForIndex = (i: number, vp: Viewport) => vp.width - (vp.rightIndex - i) * step(vp);
export const indexForX = (x: number, vp: Viewport) => vp.rightIndex - (vp.width - x) / step(vp);

export function visibleRange(vp: Viewport, total: number): { from: number; to: number } {
  const to = Math.min(total, Math.ceil(vp.rightIndex));
  const from = Math.max(0, Math.floor(vp.rightIndex - vp.visibleCount));
  return { from, to };
}

export function priceRange(candles: CandleDto[], from: number, to: number, extra: number[] = []): PriceRangeT {
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i < to; i++) {
    const c = candles[i];
    if (!c) continue;
    if (c.l < min) min = c.l;
    if (c.h > max) max = c.h;
  }
  for (const p of extra) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  const span = max - min || Math.abs(max) * 0.001 || 1;
  return { min: min - span * PAD, max: max + span * PAD };
}

export const yForPrice = (p: number, r: PriceRangeT, h: number) => ((r.max - p) / (r.max - r.min)) * h;
export const priceForY = (y: number, r: PriceRangeT, h: number) => r.max - (y / h) * (r.max - r.min);

export function zoomAround(vp: Viewport, focusX: number, factor: number, total: number): Viewport {
  const focusIndex = indexForX(focusX, vp);
  const visibleCount = clampVisible(vp.visibleCount / factor);
  const next = { ...vp, visibleCount };
  // keep focusIndex under focusX
  const rightIndex = focusIndex + (vp.width - focusX) / (vp.width / visibleCount);
  return { ...next, rightIndex: Math.min(total, rightIndex) };
}

export function panBy(vp: Viewport, dx: number, total: number): Viewport {
  const rightIndex = vp.rightIndex - dx / step(vp);
  return { ...vp, rightIndex: Math.max(Math.min(rightIndex, total), MIN_VISIBLE / 2) };
}

export const nearLeftEdge = (vp: Viewport, _total: number, threshold = 20) => vp.rightIndex - vp.visibleCount <= threshold;
```

Run the scale tests → PASS.

- [ ] **Step 3: Failing tests for paths**

```ts
import { describe, expect, it } from "vitest";
import { buildSeries } from "./paths";

const vp = { width: 100, height: 100, rightIndex: 2, visibleCount: 2 };
const range = { min: 0, max: 10 };
const candles = [
  { openTs: 0, o: 2, h: 8, l: 1, c: 6 }, // up
  { openTs: 60, o: 6, h: 7, l: 3, c: 4 }, // down
];

describe("buildSeries", () => {
  it("splits candles into up and down paths with wick and body", () => {
    const s = buildSeries("candles", candles, 0, 2, vp, range);
    expect(s.up).toContain("M");
    expect(s.down).toContain("M");
    expect(s.up).not.toBe(s.down);
  });
  it("draws a line through the closes", () => {
    const s = buildSeries("line", candles, 0, 2, vp, range);
    expect(s.line).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/);
  });
  it("closes the area path to the bottom of the chart", () => {
    const s = buildSeries("area", candles, 0, 2, vp, range);
    expect(s.area?.endsWith("Z")).toBe(true);
  });
  it("draws OHLC bars with open and close ticks", () => {
    const s = buildSeries("bars", candles, 0, 2, vp, range);
    expect((s.up.match(/M/g) ?? []).length).toBe(3);
  });
  it("returns empty paths for an empty window", () => {
    expect(buildSeries("candles", [], 0, 0, vp, range)).toEqual({ up: "", down: "" });
  });
});
```

- [ ] **Step 4: Implement `paths.ts`**

```ts
import type { CandleDto } from "@asm/contracts";
import { xForIndex, yForPrice } from "./scale";
import type { ChartType, PriceRangeT, Viewport } from "./types";

const r = (n: number) => Math.round(n * 10) / 10;

export interface SeriesPaths {
  up: string;
  down: string;
  line?: string;
  area?: string;
}

export function buildSeries(
  type: ChartType,
  candles: CandleDto[],
  from: number,
  to: number,
  vp: Viewport,
  range: PriceRangeT,
): SeriesPaths {
  if (to <= from) return { up: "", down: "" };
  const w = vp.width / vp.visibleCount;
  const half = Math.max(1, w * 0.35);
  const y = (p: number) => r(yForPrice(p, range, vp.height));
  const cx = (i: number) => r(xForIndex(i + 0.5, vp));

  if (type === "line" || type === "area") {
    const pts: string[] = [];
    for (let i = from; i < to; i++) {
      const c = candles[i];
      if (c) pts.push(`${cx(i)} ${y(c.c)}`);
    }
    const line = pts.length ? `M${pts.join(" L")}` : "";
    if (type === "line") return { up: "", down: "", line };
    const firstX = cx(from);
    const lastX = cx(to - 1);
    return { up: "", down: "", line, area: line ? `${line} L${lastX} ${vp.height} L${firstX} ${vp.height} Z` : "" };
  }

  const up: string[] = [];
  const down: string[] = [];
  for (let i = from; i < to; i++) {
    const c = candles[i];
    if (!c) continue;
    const x = cx(i);
    const target = c.c >= c.o ? up : down;
    if (type === "candles") {
      const top = y(Math.max(c.o, c.c));
      const bottom = Math.max(y(Math.min(c.o, c.c)), top + 1);
      target.push(`M${x} ${y(c.h)} L${x} ${y(c.l)}`);
      target.push(`M${r(x - half)} ${top} L${r(x + half)} ${top} L${r(x + half)} ${bottom} L${r(x - half)} ${bottom} Z`);
    } else {
      target.push(`M${x} ${y(c.h)} L${x} ${y(c.l)}`);
      target.push(`M${r(x - half)} ${y(c.o)} L${x} ${y(c.o)}`);
      target.push(`M${x} ${y(c.c)} L${r(x + half)} ${y(c.c)}`);
    }
  }
  return { up: up.join(" "), down: down.join(" ") };
}
```

Run: `pnpm --filter @asm/mobile test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/chart
git commit -m "feat(mobile): chart scale and series path builders"
```

---

### Task 11: Skia chart component with gestures

**Files:**
- Create: `apps/mobile/src/chart/Chart.tsx`, `apps/mobile/src/chart/useChartGestures.ts`, `apps/mobile/src/ui/Sheet.tsx`

**Interfaces:**
- Consumes: Task 10 functions; `useSocket` (Task 8).
- Produces:
  - `<Chart type={ChartType} candles={CandleDto[]} forming={CandleDto | null} lastPrice={number | null} precision={number} openTrades={TradeView[]} nowSec={number} onNearLeftEdge={() => void} />`
  - `<Sheet ref snapPoints title>` — wrapper over `BottomSheetModal` with drag-to-close, backdrop, dark styling; `SheetRef = { present(): void; dismiss(): void }`.

- [ ] **Step 1: Sheet wrapper**

```tsx
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { Text } from "react-native";
import { color, space } from "@/theme/tokens";

export interface SheetRef {
  present: () => void;
  dismiss: () => void;
}

export const Sheet = forwardRef<SheetRef, { title?: string; children: ReactNode; snapPoints?: (string | number)[] }>(
  function Sheet({ title, children, snapPoints }, ref) {
    const inner = useRef<BottomSheetModal>(null);
    useImperativeHandle(ref, () => ({ present: () => inner.current?.present(), dismiss: () => inner.current?.dismiss() }));
    return (
      <BottomSheetModal
        ref={inner}
        snapPoints={snapPoints}
        enableDynamicSizing={!snapPoints}
        enablePanDownToClose
        backgroundStyle={{ backgroundColor: color.panel }}
        handleIndicatorStyle={{ backgroundColor: color.ink2 }}
        backdropComponent={(p) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} />}
      >
        <BottomSheetView style={{ padding: space(4), paddingBottom: space(8), gap: space(3) }}>
          {title ? <Text style={{ color: color.ink, fontSize: 17, fontWeight: "700" }}>{title}</Text> : null}
          {children}
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);
```

- [ ] **Step 2: Gesture hook**

`src/chart/useChartGestures.ts`:

```ts
import { useMemo, useState } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { panBy, zoomAround } from "./scale";
import type { Viewport } from "./types";

export function useChartGestures(opts: {
  viewport: Viewport;
  total: number;
  setViewport: (vp: Viewport) => void;
  onCrosshair: (x: number | null) => void;
}) {
  const { viewport, total, setViewport, onCrosshair } = opts;
  const [start, setStart] = useState(viewport);

  return useMemo(() => {
    const begin = () => setStart(viewport);
    const pan = Gesture.Pan()
      .minDistance(4)
      .onStart(() => runOnJS(begin)())
      .onUpdate((e) => runOnJS(setViewport)(panBy(start, e.translationX, total)));
    const pinch = Gesture.Pinch()
      .onStart(() => runOnJS(begin)())
      .onUpdate((e) => runOnJS(setViewport)(zoomAround(start, e.focalX, e.scale, total)));
    const press = Gesture.LongPress()
      .minDuration(250)
      .onStart((e) => runOnJS(onCrosshair)(e.x))
      .onEnd(() => runOnJS(onCrosshair)(null));
    const hover = Gesture.Pan()
      .activateAfterLongPress(250)
      .onUpdate((e) => runOnJS(onCrosshair)(e.x))
      .onEnd(() => runOnJS(onCrosshair)(null));
    const reset = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => runOnJS(setViewport)({ ...viewport, rightIndex: total }));
    return Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(hover, press), reset);
  }, [viewport, total, setViewport, onCrosshair, start]);
}
```

(Gesture callbacks run on the UI thread; `runOnJS` hands updates to React state. If profiling in Step 5 shows frame drops from React re-renders during pan, move `viewport` into a reanimated `useSharedValue` and derive paths with `useDerivedValue` — record the decision in the PR.)

- [ ] **Step 3: Chart component**

`src/chart/Chart.tsx`:

```tsx
import { Canvas, Group, Line, Path, Skia, Text as SkText, matchFont, vec, LinearGradient, Rect } from "@shopify/react-native-skia";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import type { CandleDto, TradeView } from "@asm/contracts";
import { color } from "@/theme/tokens";
import { buildSeries } from "./paths";
import { indexForX, nearLeftEdge, priceRange, visibleRange, xForIndex, yForPrice } from "./scale";
import type { ChartType, Viewport } from "./types";
import { useChartGestures } from "./useChartGestures";

const font = matchFont({ fontFamily: "sans-serif", fontSize: 11 });
const PRICE_AXIS = 56;

export function Chart(props: {
  type: ChartType;
  candles: CandleDto[];
  forming: CandleDto | null;
  lastPrice: number | null;
  precision: number;
  openTrades: TradeView[];
  nowSec: number;
  onNearLeftEdge: () => void;
}) {
  const { type, candles, forming, lastPrice, precision, openTrades, nowSec, onNearLeftEdge } = props;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const all = useMemo(() => (forming ? [...candles, forming] : candles), [candles, forming]);
  const total = all.length;
  const [vp, setVp] = useState<Viewport>({ width: 0, height: 0, rightIndex: 0, visibleCount: 60 });
  const following = useRef(true);
  const [crossX, setCrossX] = useState<number | null>(null);

  const plotW = Math.max(0, size.width - PRICE_AXIS);
  const viewport: Viewport = { ...vp, width: plotW, height: size.height };

  // Follow the live edge unless the user scrolled away.
  useEffect(() => {
    setVp((v) => (following.current || v.rightIndex === 0 ? { ...v, rightIndex: total } : v));
  }, [total]);

  const setViewport = (next: Viewport) => {
    following.current = next.rightIndex >= total - 0.5;
    setVp(next);
    if (nearLeftEdge(next, total)) onNearLeftEdge();
  };

  // History layer: rebuilt when the window or closed candles change.
  const { from, to } = visibleRange(viewport, total);
  const extras = [lastPrice, ...openTrades.map((t) => t.entryPrice)].filter((p): p is number => p !== null);
  const range = priceRange(all, from, to, extras);
  const series = useMemo(
    () => (plotW > 0 ? buildSeries(type, all, from, to, viewport, range) : { up: "", down: "" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, all, from, to, plotW, size.height, viewport.rightIndex, viewport.visibleCount, range.min, range.max],
  );
  const toPath = (d: string | undefined) => (d ? Skia.Path.MakeFromSVGString(d) : null);

  const gesture = useChartGestures({ viewport, total, setViewport, onCrosshair: setCrossX });
  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  const priceY = lastPrice !== null ? yForPrice(lastPrice, range, size.height) : null;
  const crossIndex = crossX !== null ? Math.floor(indexForX(crossX, viewport)) : null;
  const crossCandle = crossIndex !== null ? all[crossIndex] : undefined;
  const fmt = (p: number) => p.toFixed(precision);

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={{ flex: 1 }}>
          {series.area ? (
            <Path path={toPath(series.area)!}>
              <LinearGradient start={vec(0, 0)} end={vec(0, size.height)} colors={[`${color.brand}66`, `${color.brand}00`]} />
            </Path>
          ) : null}
          {series.line ? <Path path={toPath(series.line)!} style="stroke" strokeWidth={1.5} color={color.brand} /> : null}
          {series.up ? <Path path={toPath(series.up)!} style={type === "bars" ? "stroke" : "fill"} strokeWidth={1} color={color.up} /> : null}
          {series.up && type === "candles" ? <Path path={toPath(series.up)!} style="stroke" strokeWidth={1} color={color.up} /> : null}
          {series.down ? <Path path={toPath(series.down)!} style={type === "bars" ? "stroke" : "fill"} strokeWidth={1} color={color.down} /> : null}
          {series.down && type === "candles" ? <Path path={toPath(series.down)!} style="stroke" strokeWidth={1} color={color.down} /> : null}

          {/* Live layer */}
          {priceY !== null ? (
            <Group>
              <Line p1={vec(0, priceY)} p2={vec(plotW, priceY)} color={color.brand} strokeWidth={1} />
              <Rect x={plotW} y={priceY - 9} width={PRICE_AXIS} height={18} color={color.brand} />
              <SkText x={plotW + 4} y={priceY + 4} text={fmt(lastPrice!)} font={font} color={color.brandInk} />
            </Group>
          ) : null}
          {openTrades.map((t) => {
            const y = yForPrice(t.entryPrice, range, size.height);
            const tone = t.direction === "UP" ? color.up : color.down;
            const left = Math.max(0, t.expiryTs - nowSec);
            const label = `${t.direction === "UP" ? "▲" : "▼"} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
            return (
              <Group key={t.id}>
                <Line p1={vec(0, y)} p2={vec(plotW, y)} color={tone} strokeWidth={1} />
                <SkText x={6} y={y - 4} text={label} font={font} color={tone} />
              </Group>
            );
          })}
          {crossX !== null ? <Line p1={vec(crossX, 0)} p2={vec(crossX, size.height)} color={color.ink2} strokeWidth={0.5} /> : null}
        </Canvas>
      </GestureDetector>

      {crossCandle ? (
        <View style={{ position: "absolute", top: 6, left: 6, backgroundColor: color.panel, borderRadius: 8, padding: 6 }}>
          <Text style={{ color: color.ink, fontSize: 11 }}>
            O {fmt(crossCandle.o)}  H {fmt(crossCandle.h)}  L {fmt(crossCandle.l)}  C {fmt(crossCandle.c)}
          </Text>
        </View>
      ) : null}
      {!following.current ? (
        <Pressable
          onPress={() => setViewport({ ...viewport, rightIndex: total })}
          style={{ position: "absolute", right: PRICE_AXIS + 8, bottom: 8, backgroundColor: color.brandFill, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}
        >
          <Text style={{ color: color.brandInk, fontWeight: "700" }}>Live ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
```

Replace the hard-coded `"Live ›"` with `t("trade.backToLive")` via `useTranslation`. `xForIndex` is imported for the time-axis follow-up; drop the import if unused to keep lint clean.

- [ ] **Step 4: Dev screen for the chart**

Temporarily render `<Chart>` on the Trade tab fed by `useSocket` (`chart.candles`, `chart.forming`, `chart.lastPrice`) after calling `useSocket.getState().subscribe(boot.defaultSymbol, "1m")`, with `onNearLeftEdge={() => useSocket.getState().loadOlder()}`.

- [ ] **Step 5: Performance check (record in the PR)**

On both test phones (Android 8+ 3 GB ₹8–10k phone, and a mid-range phone), run a release build (`./gradlew assembleRelease` with a debug-signed config or `expo run:android --variant release`), open the chart on a live market, enable "Profile HWUI rendering" in developer options, and for 30 seconds each: idle on the live edge, continuous pan, pinch zoom in/out. Record average fps. Pass: low-end ≥ 45fps, mid-range ≥ 58fps. If it fails, apply the shared-value refactor noted in Step 2 and re-measure.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/chart apps/mobile/src/ui/Sheet.tsx "apps/mobile/app/(tabs)/trade.tsx"
git commit -m "feat(mobile): native Skia chart with pan, pinch and crosshair"
```

---

### Task 12: Trade screen — top bar, status row, market picker, chart tools, resume

**Files:**
- Create: `apps/mobile/src/trade/StatusRow.tsx`, `TopBar.tsx`, `MarketPill.tsx`, `MarketSheet.tsx`, `ChartTools.tsx`, `BonusSheet.tsx`, `trade-prefs.ts`, `trade-prefs.test.ts`
- Modify: `apps/mobile/app/(tabs)/trade.tsx`

**Interfaces:**
- Produces:
  - `useTradePrefs` (zustand + MMKV persist): `{ accountId: string | null; symbol: string | null; timeframe: Timeframe; chartType: ChartType; favourites: string[]; stake: string; expirySec: number; set(partial) }`
  - pure `toggleFavourite(list: string[], symbol: string): string[]`, `filterMarkets(assets, query, favourites): { favourites: AppAsset[]; rest: AppAsset[] }`

- [ ] **Step 1: Failing tests for prefs helpers**

```ts
import { describe, expect, it } from "vitest";
import { filterMarkets, toggleFavourite } from "./trade-prefs";

const assets = [
  { symbol: "EURUSD", displayName: "EUR/USD", precision: 5, payoutPct: 85, assetClass: "FX" },
  { symbol: "NIFTY50", displayName: "Nifty 50", precision: 2, payoutPct: 80, assetClass: "INDEX" },
  { symbol: "BTCUSD", displayName: "Bitcoin", precision: 2, payoutPct: 82, assetClass: "CRYPTO" },
];

describe("market list", () => {
  it("adds and removes favourites", () => {
    expect(toggleFavourite([], "EURUSD")).toEqual(["EURUSD"]);
    expect(toggleFavourite(["EURUSD"], "EURUSD")).toEqual([]);
  });
  it("puts favourites first and searches name or symbol, case-insensitively", () => {
    const out = filterMarkets(assets, "bit", ["NIFTY50"]);
    expect(out.favourites).toEqual([]);
    expect(out.rest.map((a) => a.symbol)).toEqual(["BTCUSD"]);
    expect(filterMarkets(assets, "", ["NIFTY50"]).favourites.map((a) => a.symbol)).toEqual(["NIFTY50"]);
  });
});
```

- [ ] **Step 2: Implement `trade-prefs.ts`**

```ts
import { MMKV } from "react-native-mmkv";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { Timeframe } from "@asm/contracts";
import type { ChartType } from "@/chart/types";

export interface AppAsset {
  symbol: string;
  displayName: string;
  precision: number;
  payoutPct: number;
  assetClass: string;
}

export function toggleFavourite(list: string[], symbol: string): string[] {
  return list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol];
}

export function filterMarkets(assets: AppAsset[], query: string, favourites: string[]) {
  const q = query.trim().toLowerCase();
  const hit = (a: AppAsset) => !q || a.symbol.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q);
  const matched = assets.filter(hit);
  return {
    favourites: matched.filter((a) => favourites.includes(a.symbol)),
    rest: matched.filter((a) => !favourites.includes(a.symbol)),
  };
}

interface Prefs {
  accountId: string | null;
  symbol: string | null;
  timeframe: Timeframe;
  chartType: ChartType;
  favourites: string[];
  stake: string;
  expirySec: number;
  set: (p: Partial<Omit<Prefs, "set">>) => void;
}

function mmkvStorage(): StateStorage {
  const mmkv = new MMKV({ id: "ixt-prefs" });
  return {
    getItem: (k) => mmkv.getString(k) ?? null,
    setItem: (k, v) => mmkv.set(k, v),
    removeItem: (k) => mmkv.delete(k),
  };
}

export const useTradePrefs = create<Prefs>()(
  persist(
    (set) => ({
      accountId: null,
      symbol: null,
      timeframe: "1m",
      chartType: "candles",
      favourites: [],
      stake: "",
      expirySec: 60,
      set: (p) => set(p),
    }),
    { name: "trade-prefs", storage: createJSONStorage(mmkvStorage) },
  ),
);
```

Note: `react-native-mmkv` imported at module top makes `filterMarkets`/`toggleFavourite` untestable in Node. Put the two pure functions in `src/trade/markets.ts` (tested) and keep the store in `trade-prefs.ts`; update the test import to `./markets`.

- [ ] **Step 3: Components**

`StatusRow.tsx` — live dot (green when `phase === "authed"`, red otherwise), clock (`HH:MM:SS` updated every second via `useNow()` hook: `const [now, setNow] = useState(Date.now()); useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);`), and bonus chip `t("trade.bonus", { pct: nextBonusPercent })` which presents `BonusSheet`.

```tsx
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSocket } from "@/socket/socket-store";
import { color, space } from "@/theme/tokens";
import { useNow } from "./useNow";

export function StatusRow({ bonusPct, onBonus }: { bonusPct: number | null; onBonus: () => void }) {
  const { t } = useTranslation();
  const live = useSocket((s) => s.phase === "authed");
  const now = useNow();
  const clock = new Date(now).toLocaleTimeString("en-GB", { hour12: false });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), height: 28 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: live ? color.up : color.down }} />
      <Text style={{ color: color.ink2, fontSize: 12, fontVariant: ["tabular-nums"] }}>{clock}</Text>
      <View style={{ flex: 1 }} />
      {bonusPct ? (
        <Pressable onPress={onBonus} hitSlop={10} style={{ backgroundColor: color.brandDim, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
          <Text style={{ color: color.brand, fontSize: 12, fontWeight: "700" }}>{t("trade.bonus", { pct: bonusPct })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
```

`src/trade/useNow.ts`:

```ts
import { useEffect, useState } from "react";
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

`TopBar.tsx` — logo (`assets/icon.png`, 28px), Demo/Live segmented control (switching sets `useTradePrefs.accountId` to the account of that type; Live disabled with a tooltip toast when `liveAccess` is false and no LIVE account exists), the active account's balance (`formatMinor(realBalance + bonusBalance, currency)` from `@asm/client-core`), and a deposit "+" button (`router.push("/payments")` until P3 adds the deposit route).

```tsx
import { router } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { formatMinor } from "@asm/client-core";
import type { Bootstrap } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
import { useTradePrefs } from "./trade-prefs";

export function TopBar({ boot }: { boot: Bootstrap }) {
  const { t } = useTranslation();
  const { accountId, set } = useTradePrefs();
  const balances = useSocket((s) => s.trades.balances);
  const active = boot.accounts.find((a) => a.id === accountId) ?? boot.accounts.find((a) => a.type === "DEMO") ?? boot.accounts[0];
  const bal = active ? balances[active.id] ?? { realBalance: active.realBalance, bonusBalance: active.bonusBalance } : null;
  const pick = (type: "DEMO" | "LIVE") => {
    const acc = boot.accounts.find((a) => a.type === type);
    if (acc) set({ accountId: acc.id });
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingHorizontal: space(3), height: 50 }}>
      <Image source={require("../../assets/icon.png")} style={{ width: 28, height: 28, borderRadius: 6 }} />
      <View style={{ flexDirection: "row", backgroundColor: color.tile, borderRadius: radius.pill, padding: 2 }}>
        {(["DEMO", "LIVE"] as const).map((type) => (
          <Pressable key={type} onPress={() => pick(type)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: active?.type === type ? color.brandFill : "transparent" }}>
            <Text style={{ color: color.ink, fontWeight: "700", fontSize: 12 }}>{type === "DEMO" ? t("trade.demo") : t("trade.live")}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      {active && bal ? (
        <Text style={{ color: color.ink, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
          {formatMinor(bal.realBalance + bal.bonusBalance, active.currency)}
        </Text>
      ) : null}
      <Pressable accessibilityLabel="Deposit" onPress={() => router.push("/payments")} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color.up, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>+</Text>
      </Pressable>
    </View>
  );
}
```

Check `formatMinor`'s exact name/signature in `@asm/client-core` (`format-money.ts` exports `formatMinor(minor, currency)`); use it as is.

`MarketPill.tsx` — shows the active market's display name + payout %, opens `MarketSheet`.

`MarketSheet.tsx` — `Sheet` with a search `TextInput` (`t("trade.search")`), sections "Favourites" and "Markets" from `filterMarkets`, each row: name, payout %, star toggle (`toggleFavourite`). Tapping a row sets `useTradePrefs.symbol`, calls `useSocket.getState().subscribe(symbol, timeframe)`, dismisses.

`ChartTools.tsx` — the `⋯` button that expands two compact rows: chart type chips (`candles`, `line`, `area`, `bars` with `t("trade.<type>")`) and timeframe chips (`TIMEFRAMES` from `@asm/contracts`). Changing timeframe re-subscribes.

`BonusSheet.tsx` — `Sheet` listing `bonusTiers` as "1st deposit +100%", "2nd deposit +100%", … with the user's next tier highlighted (from `completedDeposits`), plus a "Deposit" button → payments. Copy must match the deposit modal wording on the web ("Bonus", not other terms).

- [ ] **Step 4: Compose the screen and wire resume**

`app/(tabs)/trade.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { AppState, View } from "react-native";
import { useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { loadResume, saveResume } from "@/cache/resume-cache";
import { Chart } from "@/chart/Chart";
import { useSocket } from "@/socket/socket-store";
import { Screen, Skeleton } from "@/theme/ui";
import { BonusSheet, type BonusSheetRef } from "@/trade/BonusSheet";
import { ChartTools } from "@/trade/ChartTools";
import { Dock } from "@/trade/Dock";
import { MarketPill } from "@/trade/MarketPill";
import { PositionStrip } from "@/trade/PositionStrip";
import { StatusRow } from "@/trade/StatusRow";
import { TopBar } from "@/trade/TopBar";
import { useTradePrefs } from "@/trade/trade-prefs";
import { useNow } from "@/trade/useNow";
import { useKeepAwakeWhileOpen } from "@/trade/useKeepAwakeWhileOpen";

export default function Trade() {
  const token = useSession((s) => s.token);
  const boot = useBootstrap(!!token).data;
  const prefs = useTradePrefs();
  const chart = useSocket((s) => s.chart);
  const tradesByAccount = useSocket((s) => s.trades.tradesByAccount);
  const bonusRef = useRef<BonusSheetRef>(null);
  const nowSec = Math.floor(useNow() / 1000);

  const accountId = prefs.accountId ?? boot?.accounts.find((a) => a.type === "DEMO")?.id ?? null;
  const symbol = prefs.symbol ?? boot?.defaultSymbol ?? null;
  const openTrades = (accountId ? tradesByAccount[accountId] ?? [] : []).filter((t) => t.status === "OPEN" && t.symbol === symbol);
  useKeepAwakeWhileOpen(openTrades.length > 0);

  useEffect(() => {
    if (!boot) return;
    useSocket.getState().seed(boot);
    if (symbol) useSocket.getState().subscribe(symbol, prefs.timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "background" || !boot || !symbol || !accountId) return;
      const st = useSocket.getState();
      saveResume({
        v: 1,
        savedAt: Date.now(),
        userId: boot.userId,
        symbol,
        timeframe: prefs.timeframe,
        candles: st.chart.candles,
        balances: st.trades.balances,
        openTrades: st.trades.tradesByAccount[accountId] ?? [],
        accountId,
      });
    });
    return () => sub.remove();
  }, [boot, symbol, accountId, prefs.timeframe]);

  const asset = boot?.assets.find((a) => a.symbol === symbol);
  const cached = !chart.candles.length && boot ? loadResume(boot.userId) : null;

  return (
    <Screen>
      {boot ? <TopBar boot={boot} /> : <Skeleton height={50} />}
      <StatusRow bonusPct={boot ? boot.completedDeposits < 4 ? [100, 100, 50, 50][boot.completedDeposits]! : null : null} onBonus={() => bonusRef.current?.present()} />
      <View style={{ flex: 1 }}>
        <Chart
          type={prefs.chartType}
          candles={chart.candles.length ? chart.candles : cached?.candles ?? []}
          forming={chart.forming}
          lastPrice={chart.lastPrice}
          precision={asset?.precision ?? 2}
          openTrades={openTrades}
          nowSec={nowSec}
          onNearLeftEdge={() => useSocket.getState().loadOlder()}
        />
        <View style={{ position: "absolute", top: 8, left: 8, flexDirection: "row", gap: 8 }}>
          {boot ? <MarketPill assets={boot.assets} /> : null}
          <ChartTools />
        </View>
      </View>
      {boot && accountId ? <PositionStrip accountId={accountId} /> : null}
      {boot && accountId && asset ? <Dock boot={boot} accountId={accountId} asset={asset} payoutPct={chart.payoutPct ?? asset.payoutPct} /> : null}
      {boot ? <BonusSheet ref={bonusRef} tiers={[100, 100, 50, 50]} completedDeposits={boot.completedDeposits} /> : null}
    </Screen>
  );
}
```

The cache is keyed by `boot.userId` (P1 Task 8 includes it in the bootstrap). Replace the inline bonus tier array with `bonusTiers` from `/api/v1/wallet` once P3 adds the wallet query (note left for P3 Task 1).

`Dock`, `PositionStrip`, `useKeepAwakeWhileOpen` come in Tasks 13–14; until then render `null` placeholders so this compiles.

- [ ] **Step 5: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual: switch market, timeframe, chart type; kill the app while on EURUSD, reopen → candles appear before the socket connects.

```bash
git add apps/mobile
git commit -m "feat(mobile): trade screen chrome, market picker and resume cache"
```

---

### Task 13: Trade dock — stake keypad, expiry, Buy/Sell

**Files:**
- Create: `apps/mobile/src/trade/Dock.tsx`, `KeypadSheet.tsx`, `ExpirySheet.tsx`, `useTradeSubmit.ts`, `stake-input.ts`, `stake-input.test.ts`

**Interfaces:**
- Consumes: `stakeToMinor`, `stakePresets`, `defaultStake`, `profitForStake`, `EXPIRY_CHIPS`, `formatDuration`, `minStakeMinor`, `formatMinor` (`@asm/client-core`); `TRADE_DURATIONS_SEC`, `OpenTradeSchema`, `OpenTradeResult` (`@asm/contracts`); `useSocket.applyOpenResult` (Task 8).
- Produces: `validateStake(input: string, currency: string, available: number): { ok: true; minor: number } | { ok: false; reason: "min" | "balance" | "empty" }` (pure); `useTradeSubmit(): { submit(direction: "UP" | "DOWN"): Promise<void>; busy: boolean }`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { validateStake } from "./stake-input";

describe("validateStake", () => {
  it("rejects an empty stake", () => {
    expect(validateStake("", "INR", 1_000_00)).toEqual({ ok: false, reason: "empty" });
  });
  it("enforces the ₹100 minimum on INR accounts", () => {
    expect(validateStake("99", "INR", 1_000_00)).toEqual({ ok: false, reason: "min" });
    expect(validateStake("100", "INR", 1_000_00)).toEqual({ ok: true, minor: 10_000 });
  });
  it("enforces the $1 minimum on USD accounts", () => {
    expect(validateStake("0.5", "USD", 10_000)).toEqual({ ok: false, reason: "min" });
  });
  it("refuses a stake above the available balance", () => {
    expect(validateStake("500", "INR", 10_000)).toEqual({ ok: false, reason: "balance" });
  });
});
```

- [ ] **Step 2: Implement `stake-input.ts`**

```ts
import { minStakeMinor, stakeToMinor } from "@asm/client-core";

export function validateStake(
  input: string,
  currency: string,
  available: number,
): { ok: true; minor: number } | { ok: false; reason: "min" | "balance" | "empty" } {
  if (!input.trim()) return { ok: false, reason: "empty" };
  const minor = stakeToMinor(input);
  if (!Number.isFinite(minor) || minor <= 0) return { ok: false, reason: "empty" };
  if (minor < minStakeMinor(currency)) return { ok: false, reason: "min" };
  if (minor > available) return { ok: false, reason: "balance" };
  return { ok: true, minor };
}
```

Run → PASS (if `stakeToMinor("99")` returns a different unit than paise, read `stake.ts` and adjust the expected minors in the test to match it — the test must describe the real conversion).

- [ ] **Step 3: Submit hook**

```ts
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { z } from "zod";
import type { OpenTradeResult } from "@asm/contracts";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";

const Result = z.object({ trade: z.record(z.string(), z.unknown()), balances: z.object({ realBalance: z.number(), bonusBalance: z.number() }) });

export function useTradeSubmit(input: { accountId: string; symbol: string; stakeMinor: number | null; durationSec: number }) {
  const [busy, setBusy] = useState(false);
  async function submit(direction: "UP" | "DOWN") {
    if (busy || input.stakeMinor === null) return;
    setBusy(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const out = (await api("/api/trades", {
        method: "POST",
        body: { symbol: input.symbol, direction, stake: input.stakeMinor, durationSec: input.durationSec, accountId: input.accountId },
        schema: Result,
      })) as unknown as OpenTradeResult;
      useSocket.getState().applyOpenResult(out);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Trade failed.", "down");
    } finally {
      setBusy(false);
    }
  }
  return { submit, busy };
}
```

Field names in `body` must match `OpenTradeSchema` exactly — read `packages/contracts/src/trade.ts` `tradeRequestShape` and use its keys (`symbol`, `direction`, the stake key, the duration key, `accountId`). Validate the body with `OpenTradeSchema.parse(body)` before sending.

- [ ] **Step 4: Keypad sheet, expiry sheet, dock**

`KeypadSheet.tsx` — `Sheet` with the current amount (large, `groupAmount`), quick chips from `stakePresets(currency)`, a 3×4 keypad (`1–9`, `.`, `0`, `⌫`) with `Haptics.impactAsync(Light)` per key, and "Done". Max two decimals for USD, none for INR.

`ExpirySheet.tsx` — `Sheet` listing every `TRADE_DURATIONS_SEC` as chips labelled with `formatDuration`.

`Dock.tsx`:

```tsx
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { EXPIRY_CHIPS, formatDuration, formatMinor, isChipExpiry, profitForStake } from "@asm/client-core";
import type { Bootstrap } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { color, radius, space } from "@/theme/tokens";
import type { AppAsset } from "./markets";
import { ExpirySheet, type ExpirySheetRef } from "./ExpirySheet";
import { KeypadSheet, type KeypadSheetRef } from "./KeypadSheet";
import { validateStake } from "./stake-input";
import { useTradePrefs } from "./trade-prefs";
import { useTradeSubmit } from "./useTradeSubmit";

export function Dock({ boot, accountId, asset, payoutPct }: { boot: Bootstrap; accountId: string; asset: AppAsset; payoutPct: number }) {
  const { t } = useTranslation();
  const { stake, expirySec, set } = useTradePrefs();
  const account = boot.accounts.find((a) => a.id === accountId)!;
  const bal = useSocket((s) => s.trades.balances[accountId]) ?? account;
  const check = validateStake(stake, account.currency, bal.realBalance + bal.bonusBalance);
  const { submit, busy } = useTradeSubmit({ accountId, symbol: asset.symbol, stakeMinor: check.ok ? check.minor : null, durationSec: expirySec });
  const keypad = useRef<KeypadSheetRef>(null);
  const expiry = useRef<ExpirySheetRef>(null);
  const profit = check.ok ? profitForStake(check.minor, payoutPct) : null;

  return (
    <View style={{ padding: space(3), gap: space(2), backgroundColor: color.panel, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Pressable onPress={() => keypad.current?.present()} style={{ flex: 1, backgroundColor: color.tile, borderRadius: radius.md, padding: space(3) }}>
          <Text style={{ color: color.ink2, fontSize: 11 }}>{t("trade.stake")}</Text>
          <Text style={{ color: color.ink, fontSize: 18, fontWeight: "700" }}>{stake ? formatMinor(check.ok ? check.minor : 0, account.currency) : "—"}</Text>
        </Pressable>
        <View style={{ flex: 1.4, flexDirection: "row", gap: 6, alignItems: "center" }}>
          {EXPIRY_CHIPS.map((c) => (
            <Pressable key={c.sec} onPress={() => set({ expirySec: c.sec })} style={{ flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: expirySec === c.sec ? color.brandFill : color.tile }}>
              <Text style={{ color: color.ink, fontWeight: "700", fontSize: 12 }}>{c.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => expiry.current?.present()} style={{ flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: !isChipExpiry(expirySec) ? color.brandFill : color.tile }}>
            <Text style={{ color: color.ink, fontWeight: "700", fontSize: 12 }}>{isChipExpiry(expirySec) ? t("trade.more") : formatDuration(expirySec)}</Text>
          </Pressable>
        </View>
      </View>
      {!check.ok && check.reason !== "empty" ? (
        <Text style={{ color: color.down, fontSize: 12 }}>
          {check.reason === "min" ? t("trade.minStake", { amount: formatMinor(/* min */ account.currency === "INR" ? 10_000 : 100, account.currency) }) : t("trade.insufficient")}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: space(2) }}>
        {(["UP", "DOWN"] as const).map((dir) => (
          <Pressable
            key={dir}
            disabled={!check.ok || busy}
            onPress={() => void submit(dir)}
            style={{ flex: 1, minHeight: 56, borderRadius: radius.md, backgroundColor: dir === "UP" ? color.up : color.down, opacity: !check.ok || busy ? 0.5 : 1, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>{dir === "UP" ? t("trade.buy") : t("trade.sell")}</Text>
            <Text style={{ color: "#ffffffcc", fontSize: 12 }}>
              {t("trade.payout", { pct: payoutPct })}{profit !== null ? ` · +${formatMinor(profit, account.currency)}` : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <KeypadSheet ref={keypad} currency={account.currency} value={stake} onChange={(v) => set({ stake: v })} />
      <ExpirySheet ref={expiry} value={expirySec} onPick={(sec) => set({ expirySec: sec })} />
    </View>
  );
}
```

Replace the inline minimum amount with `minStakeMinor(account.currency)` from `@asm/client-core`.

- [ ] **Step 5: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual on demo: stake ₹50 → min-stake message; ₹100 Buy 30s → trade line appears on the chart; Android back closes an open sheet before leaving the tab.

```bash
git add apps/mobile/src/trade
git commit -m "feat(mobile): trade dock with keypad, expiry and buy/sell"
```

---

### Task 14: Position strip, trades sheet, result feedback, keep-awake

**Files:**
- Create: `apps/mobile/src/trade/PositionStrip.tsx`, `TradesSheet.tsx`, `ResultToast.ts`, `useKeepAwakeWhileOpen.ts`, `result.ts`, `result.test.ts`

**Interfaces:**
- Consumes: `soonestOpen`, `shortCountdown`, `openSide`, `closedRowDisplay` (`@asm/client-core`); `useSocket.lastSettled`.
- Produces: `settledFeedback(trade: TradeView, currency: string): { tone: "up" | "down" | "neutral"; key: "trade.won" | "trade.lost" | "trade.draw"; amountMinor: number; haptic: "success" | "warning" | null }` (pure).

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { settledFeedback } from "./result";

const t = (over: Record<string, unknown>) =>
  ({ id: "1", accountId: "a", symbol: "EURUSD", direction: "UP", stake: 10_000, payoutPct: 80, entryPrice: 1, entryTs: 0, expiryTs: 30, exitPrice: 1.1, status: "WON", pnl: 8_000, ...over }) as never;

describe("settledFeedback", () => {
  it("celebrates a win with the profit and a success haptic", () => {
    expect(settledFeedback(t({}), "INR")).toEqual({ tone: "up", key: "trade.won", amountMinor: 8_000, haptic: "success" });
  });
  it("reports a loss with the stake and a warning haptic", () => {
    expect(settledFeedback(t({ status: "LOST", pnl: -10_000 }), "INR")).toEqual({ tone: "down", key: "trade.lost", amountMinor: 10_000, haptic: "warning" });
  });
  it("treats a draw as a refund without a haptic", () => {
    expect(settledFeedback(t({ status: "DRAW", pnl: 0 }), "INR")).toEqual({ tone: "neutral", key: "trade.draw", amountMinor: 10_000, haptic: null });
  });
});
```

Check `TradeStatusDto` values in `packages/contracts/src/trade.ts` (e.g. `WON`/`LOST`/`DRAW`/`REFUNDED`) and use the real names in both test and implementation.

- [ ] **Step 2: Implement `result.ts`**

```ts
import type { TradeView } from "@asm/contracts";

export function settledFeedback(trade: TradeView, _currency: string) {
  if (trade.pnl > 0) return { tone: "up" as const, key: "trade.won" as const, amountMinor: trade.pnl, haptic: "success" as const };
  if (trade.pnl < 0) return { tone: "down" as const, key: "trade.lost" as const, amountMinor: -trade.pnl, haptic: "warning" as const };
  return { tone: "neutral" as const, key: "trade.draw" as const, amountMinor: trade.stake, haptic: null };
}
```

- [ ] **Step 3: Result toast hook + keep-awake**

`ResultToast.ts`:

```ts
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { formatMinor } from "@asm/client-core";
import { useSocket } from "@/socket/socket-store";
import { toast } from "@/ui/Toast";
import { settledFeedback } from "./result";

export function useResultFeedback(currencyFor: (accountId: string) => string) {
  const { t } = useTranslation();
  const last = useSocket((s) => s.lastSettled);
  useEffect(() => {
    if (!last) return;
    const f = settledFeedback(last, currencyFor(last.accountId));
    toast(`${last.symbol} · ${t(f.key, { amount: formatMinor(f.amountMinor, currencyFor(last.accountId)) })}`, f.tone);
    if (f.haptic === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (f.haptic === "warning") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [last, t, currencyFor]);
}
```

Call it from `trade.tsx` with `(id) => boot.accounts.find((a) => a.id === id)?.currency ?? "INR"`.

`useKeepAwakeWhileOpen.ts`:

```ts
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect } from "react";

const TAG = "open-trades";
export function useKeepAwakeWhileOpen(active: boolean) {
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(TAG);
    return () => deactivateKeepAwake(TAG);
  }, [active]);
}
```

- [ ] **Step 4: Position strip and trades sheet**

`PositionStrip.tsx` — reads open trades for `accountId` from `useSocket`, shows `soonestOpen(trades)`: symbol, direction arrow, countdown `shortCountdown(expiryTs - nowSec)`, live P&L side from `openSide(trade, lastPrice)` coloured up/down, "+N more" when `more > 0`; tap presents `TradesSheet`. Hidden when no open trades.

`TradesSheet.tsx` — `Sheet` (snap `["60%", "90%"]`) with Open / Closed segmented tabs. Open rows: symbol, direction, stake, countdown. Closed rows: `closedRowDisplay(trade)` amount and colour, time. Empty: `t("trade.noTrades")`. Closed list source: `tradesByAccount[accountId]` filtered `status !== "OPEN"`, newest first (already seeded from bootstrap, extended by socket).

Use the exact `@asm/client-core` signatures (`openSide`'s parameters — read `pnl-display.ts`).

- [ ] **Step 5: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual: a 30s demo trade → strip counts down, screen stays on, result toast + vibration on settle, trade appears under Closed.

```bash
git add apps/mobile/src/trade "apps/mobile/app/(tabs)/trade.tsx"
git commit -m "feat(mobile): position strip, trades sheet and settle feedback"
```

---

### Task 15: End-to-end flows (Maestro) and release-readiness checks

**Files:**
- Create: `apps/mobile/e2e/login-trade.yaml`, `apps/mobile/e2e/lock.yaml`, `apps/mobile/e2e/maintenance.yaml`, `apps/mobile/e2e/README.md`
- Add `testID`s used below to the matching components.

- [ ] **Step 1: Add test IDs**

`login.tsx`: `testID="login-email"`, `"login-password"`, `"login-submit"`. `lock-setup.tsx`: `"lock-set-pin"`. `PinPad` keys: `testID={\`pin-${k}\`}`. `TopBar` Demo segment: `"account-demo"`. `Dock`: stake tile `"stake-tile"`, chip `"expiry-30"`, Buy `"buy"`. `KeypadSheet` keys `"key-<k>"`, Done `"keypad-done"`. Toast text: `testID="toast"`. Gate screens: `"gate-maintenance"`.

- [ ] **Step 2: Write the flows**

`e2e/login-trade.yaml`:

```yaml
appId: com.indianxtrade.app
---
- launchApp:
    clearState: true
- tapOn: { id: "login-email" }
- inputText: ${EMAIL}
- tapOn: { id: "login-password" }
- inputText: ${PASSWORD}
- tapOn: { id: "login-submit" }
- tapOn: { id: "lock-set-pin" }
- tapOn: { id: "pin-1" }
- tapOn: { id: "pin-2" }
- tapOn: { id: "pin-3" }
- tapOn: { id: "pin-4" }
- tapOn: { id: "pin-1" }
- tapOn: { id: "pin-2" }
- tapOn: { id: "pin-3" }
- tapOn: { id: "pin-4" }
- tapOn: { id: "account-demo" }
- tapOn: { id: "stake-tile" }
- tapOn: { id: "key-1" }
- tapOn: { id: "key-0" }
- tapOn: { id: "key-0" }
- tapOn: { id: "keypad-done" }
- tapOn: { id: "expiry-30" }
- tapOn: { id: "buy" }
- extendedWaitUntil:
    visible: { id: "toast" }
    timeout: 45000
```

`e2e/lock.yaml`: launch (already logged in from the previous flow, `clearState: false`), `stopApp`, `launchApp` → assert `pin-1` visible (cold start lock); enter wrong PIN 5 times → assert `login-email` visible.

`e2e/maintenance.yaml`: with the local web started with `MAINTENANCE_MODE=1`, `launchApp` → `assertVisible: { id: "gate-maintenance" }`.

`e2e/README.md`: how to run — `maestro test -e EMAIL=<seeded demo user> -e PASSWORD=<seed password> apps/mobile/e2e/login-trade.yaml` against an emulator running a debug build pointed at the local web/engine (credentials come from `packages/db/prisma/seed.ts`; never commit real ones).

- [ ] **Step 3: Run the flows**

Run: `maestro test apps/mobile/e2e/` (with the env vars). Expected: all three pass. Record the output in the PR.

- [ ] **Step 4: Hindi pass**

Switch the emulator language to Hindi, cold-start, and screenshot login, lock setup, trade screen, keypad sheet, market sheet, trades sheet. Attach to the PR; fix any clipped text (allow labels to wrap, never shrink below 11pt).

- [ ] **Step 5: Commit and open the PR**

```bash
git add apps/mobile
git commit -m "test(mobile): Maestro flows for login, trade, lock and maintenance"
```

PR description includes: fps results (Task 11), Maestro output, Hindi screenshots, and the open item "native-speaker review of hi.json" as a release blocker.

---

## Self-Review Notes

- Spec coverage: package/stack → T1–2; folder layout → File Map; API client + codes → T4; auth (email, Google, forgot) → T5; app lock → T6; i18n → T3; gate screens + tabs + back → T7 (+ T13 manual back check); socket lifecycle/backoff/offline banner → T7–8; chart (data, two layers, scale, 4 series, gestures, perf budget) → T10–11; trade screen (status row, top bar, market pill/sheet, tools, dock, strip, trades sheet, result feedback, haptics, keep-awake, resume cache) → T9, T12–14; testing (unit + Maestro + manual) → every task + T15.
- Names used across tasks: `useSocket` (`phase`, `consecutiveFailures`, `chart`, `trades`, `lastSettled`, `seed`, `start`, `stop`, `subscribe`, `loadOlder`, `applyOpenResult`), `useTradePrefs` (`accountId`, `symbol`, `timeframe`, `chartType`, `favourites`, `stake`, `expirySec`, `set`), `Sheet`/`SheetRef`, `api`/`ApiError`, `useGate`, `useSession`, `useLock` — consistent.
- Resume cache keyed by `boot.userId`, which P1 Task 8 returns.
