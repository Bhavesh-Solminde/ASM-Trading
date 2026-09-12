# ASM Trade — Plan 06: Companion App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android app that reads the operator's *own* bank SMS, filters to configured senders, and forwards each one to the demo server's relay endpoint — so a live demonstration uses a real message travelling a real path instead of a hand-typed sample.

**Architecture:** A React Native app built with Expo SDK 57 and expo-router. Because no Expo SDK module can read SMS, the project leaves the managed runtime via `expo prebuild` and gains a **local Expo module** written in Kotlin that registers a `SMS_RECEIVED` broadcast receiver and emits each message to JavaScript. Messages land in a SQLite queue first and are forwarded with backoff, so nothing is lost when the phone is offline. Configuration lives in the secure store.

**Tech Stack:** Expo SDK 57.0.21 · React Native 0.87.1 · React 19.3.0 · expo-router 57 · Kotlin · expo-sqlite · expo-secure-store · Vitest 5

## Global Constraints

- **Everything from Plans 01–05 applies** — exact pinned versions, money as integer minor units, no real money anywhere.
- **This app reads the operator's own device only.** Their phone, their SIM, their bank alerts, their own server. It is never installed on anyone else's device, never distributed, and never pointed at an account they do not own. That is the line between a demonstration and the mule-account machinery it demonstrates.
- **Expo Go cannot run this.** There is no SDK module for a `SMS_RECEIVED` receiver and the managed workflow cannot register one. A custom development build via `expo prebuild` + `expo-dev-client` is required.
- **Android only.** This machine has Command Line Tools but no Xcode, so iOS cannot be built locally — and iOS has no SMS-reading API at any tier, so the platform is out of scope permanently.
- **Never published.** Google Play restricts `RECEIVE_SMS` to an app that is the device's default SMS handler. A sideloaded debug build is the only distribution, and the only one wanted.
- **The server parses authoritatively.** The app may pre-filter by sender to avoid sending irrelevant traffic, but `parseBankMessage` on the server decides what a credit is.
- **The relay secret is never committed.** It lives in the secure store, entered once on the config screen.
- **New exact versions:** `expo@57.0.21`, `expo-router@57.0.20`, `react-native@0.87.1`, `expo-dev-client@57.0.19`, `expo-sqlite@57.0.3`, `expo-secure-store@57.0.3`, `expo-build-properties@57.0.17`.

---

## File Structure

```
apps/relay/
├── package.json
├── app.json                        expo config incl. the android permission
├── tsconfig.json
├── metro.config.js                 monorepo-aware resolver
├── babel.config.js
├── app/
│   ├── _layout.tsx                 expo-router stack
│   ├── index.tsx                   status + start/stop + permission flow
│   └── settings.tsx                server URL, secret, sender allowlist
├── src/
│   ├── config.ts                   secure-store read/write
│   ├── queue.ts                    SQLite outbox with backoff
│   ├── forwarder.ts                drains the queue to the server
│   ├── senders.ts                  sender pre-filter — pure, tested
│   └── types.ts
└── modules/sms-reader/             local Expo module
    ├── expo-module.config.json
    ├── index.ts                    JS surface
    ├── src/SmsReader.types.ts
    └── android/
        ├── build.gradle
        └── src/main/
            ├── AndroidManifest.xml
            └── java/expo/modules/smsreader/
                ├── SmsReaderModule.kt
                └── SmsBroadcastReceiver.kt
```

The app deliberately holds no parsing logic beyond a sender pre-filter. Everything that decides what a message *means* stays on the server, where it is already tested.

---

## Task 1: Expo app scaffold and prebuild

**Files:**
- Create: `apps/relay/package.json`, `apps/relay/app.json`, `apps/relay/tsconfig.json`, `apps/relay/metro.config.js`, `apps/relay/babel.config.js`, `apps/relay/app/_layout.tsx`, `apps/relay/app/index.tsx`
- Modify: root `package.json`, `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: an Android debug build that launches and shows a placeholder screen

- [ ] **Step 1: Confirm the Android toolchain is present**

```bash
java -version 2>&1 | head -1
echo "ANDROID_HOME=${ANDROID_HOME:-unset}"
ls "$HOME/Library/Android/sdk" 2>/dev/null | head -3 || echo "Android SDK not found"
```

Expected: `openjdk version "17..."` and an SDK directory listing.

If the SDK is missing, install Android Studio and its SDK, then export the path:

```bash
echo 'export ANDROID_HOME="$HOME/Library/Android/sdk"' >> ~/.zshrc
echo 'export PATH="$ANDROID_HOME/platform-tools:$PATH"' >> ~/.zshrc
```

Open a new shell before continuing. Without the SDK, `expo run:android` cannot build and this plan cannot be completed — there is no managed-workflow fallback, because Expo Go cannot read SMS.

- [ ] **Step 2: Write `apps/relay/package.json`**

```json
{
  "name": "@asm/relay",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start --dev-client",
    "android": "expo run:android",
    "prebuild": "expo prebuild --platform android --clean",
    "test": "vitest run"
  },
  "dependencies": {
    "expo": "57.0.21",
    "expo-constants": "57.0.9",
    "expo-dev-client": "57.0.19",
    "expo-linking": "57.0.9",
    "expo-router": "57.0.20",
    "expo-secure-store": "57.0.3",
    "expo-sqlite": "57.0.3",
    "expo-status-bar": "57.0.9",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-native": "0.87.1",
    "react-native-safe-area-context": "5.8.0",
    "react-native-screens": "4.20.0"
  },
  "devDependencies": {
    "@types/react": "19.3.0",
    "expo-build-properties": "57.0.17",
    "typescript": "5.9.3"
  }
}
```

- [ ] **Step 3: Write `apps/relay/app.json`**

`RECEIVE_SMS` is declared here so `expo prebuild` writes it into the generated manifest. The local module adds it too, but declaring it at the app level keeps it visible where a reader will look.

```json
{
  "expo": {
    "name": "ASM Relay",
    "slug": "asm-relay",
    "version": "1.0.0",
    "orientation": "portrait",
    "scheme": "asmrelay",
    "userInterfaceStyle": "dark",
    "newArchEnabled": true,
    "android": {
      "package": "local.asmtrade.relay",
      "permissions": ["android.permission.RECEIVE_SMS", "android.permission.INTERNET"]
    },
    "plugins": [
      "expo-router",
      [
        "expo-build-properties",
        {
          "android": {
            "compileSdkVersion": 35,
            "targetSdkVersion": 35,
            "minSdkVersion": 24
          }
        }
      ]
    ],
    "experiments": { "typedRoutes": true }
  }
}
```

- [ ] **Step 4: Write `apps/relay/tsconfig.json`**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 5: Write `apps/relay/metro.config.js`**

Metro must be told about the monorepo or it will not resolve hoisted dependencies.

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

- [ ] **Step 6: Write `apps/relay/babel.config.js`**

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
```

- [ ] **Step 7: Write `apps/relay/app/_layout.tsx`**

```tsx
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
```

- [ ] **Step 8: Write a placeholder `apps/relay/app/index.tsx`**

```tsx
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function Home() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>ASM Relay</Text>
      <Text style={styles.body}>
        Forwards this phone&apos;s own bank SMS to your demo server.
      </Text>
      <Link href="/settings" style={styles.link}>
        Settings
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  title: { color: "#e8edf3", fontSize: 28, fontWeight: "600" },
  body: { color: "#93a2b4", fontSize: 14, lineHeight: 20 },
  link: { color: "#3d8bfd", fontSize: 14, fontWeight: "600", marginTop: 8 },
});
```

- [ ] **Step 9: Add `settings.tsx` as a stub so routing resolves**

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function Settings() {
  return (
    <View style={styles.screen}>
      <Text style={styles.body}>Configuration arrives in Task 3.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24 },
  body: { color: "#93a2b4", fontSize: 14 },
});
```

- [ ] **Step 10: Ignore the generated native project**

Append to the root `.gitignore`:

```gitignore
apps/relay/android/
apps/relay/ios/
apps/relay/.expo/
```

`expo prebuild` regenerates these, and committing them would mean reviewing thousands of generated lines on every SDK bump.

- [ ] **Step 11: Add relay scripts to the root `package.json`**

```json
    "relay:prebuild": "pnpm --filter @asm/relay prebuild",
    "relay:android": "pnpm --filter @asm/relay android",
    "relay:start": "pnpm --filter @asm/relay start"
```

- [ ] **Step 12: Install, prebuild, and run**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm install
pnpm relay:prebuild
ls apps/relay/android/app/src/main/AndroidManifest.xml
grep -c "RECEIVE_SMS" apps/relay/android/app/src/main/AndroidManifest.xml
```

Expected: the manifest exists and `RECEIVE_SMS` appears at least once.

With a device connected (`adb devices` lists it) or an emulator running:

```bash
pnpm relay:android
```

Expected: the app builds, installs, and shows the placeholder screen. The first build takes several minutes.

- [ ] **Step 13: Commit**

```bash
git add apps/relay package.json .gitignore
git commit -m "feat(relay): expo scaffold with android prebuild"
```

---

## Task 2: The local native SMS module

**Files:**
- Create: `apps/relay/modules/sms-reader/expo-module.config.json`, `apps/relay/modules/sms-reader/index.ts`, `apps/relay/modules/sms-reader/src/SmsReader.types.ts`, `apps/relay/modules/sms-reader/android/build.gradle`, `apps/relay/modules/sms-reader/android/src/main/AndroidManifest.xml`, `apps/relay/modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `IncomingSms = { sender: string; body: string; receivedAt: number }`
  - `startListening(): Promise<void>`
  - `stopListening(): Promise<void>`
  - `isListening(): Promise<boolean>`
  - `addSmsListener(listener: (event: IncomingSms) => void): { remove(): void }`

**Design note on receiver lifetime.** The receiver is registered **dynamically** while JavaScript is listening, rather than declared statically in the manifest. A manifest receiver would survive the app being killed, but it needs a static bridge to reach JS and behaves unpredictably under Android's background restrictions. Dynamic registration means the relay works while the app is open — which is what a demonstration needs, and it is honest about the fragility rather than pretending otherwise.

- [ ] **Step 1: Write `apps/relay/modules/sms-reader/expo-module.config.json`**

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.smsreader.SmsReaderModule"]
  }
}
```

- [ ] **Step 2: Write `apps/relay/modules/sms-reader/android/build.gradle`**

```gradle
apply plugin: 'com.android.library'
apply plugin: 'kotlin-android'
apply plugin: 'maven-publish'

group = 'expo.modules.smsreader'
version = '0.1.0'

def expoModulesCorePlugin = new File(
  project(":expo-modules-core").projectDir.absolutePath,
  "ExpoModulesCorePlugin.gradle"
)
apply from: expoModulesCorePlugin
applyKotlinExpoModulesCorePlugin()

android {
  namespace "expo.modules.smsreader"
  defaultConfig {
    versionCode 1
    versionName "0.1.0"
  }
  lintOptions {
    abortOnError false
  }
}

dependencies {
  implementation project(':expo-modules-core')
}
```

- [ ] **Step 3: Write `apps/relay/modules/sms-reader/android/src/main/AndroidManifest.xml`**

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.RECEIVE_SMS" />
</manifest>
```

- [ ] **Step 4: Write the Kotlin module**

Create `apps/relay/modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt`:

```kotlin
package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads THIS device's incoming SMS and emits each one to JavaScript.
 *
 * The receiver is registered dynamically while JS is listening rather than
 * declared statically, so it exists only while the app is running. That is a
 * deliberate limitation: a manifest receiver would survive an app kill but
 * needs a static bridge to reach JS and fights Android's background limits.
 */
class SmsReaderModule : Module() {

  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    Events("onSmsReceived")

    AsyncFunction("startListening") {
      if (receiver != null) return@AsyncFunction

      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")

      // Multipart messages arrive as several PDUs for one logical message.
      // Concatenating them is what stops a long alert being truncated.
      val created = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
          if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

          val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
          if (messages.isEmpty()) return

          val sender = messages[0].displayOriginatingAddress ?: "unknown"
          val body = messages.joinToString("") { it.displayMessageBody ?: "" }
          if (body.isBlank()) return

          sendEvent(
            "onSmsReceived",
            mapOf(
              "sender" to sender,
              "body" to body,
              "receivedAt" to System.currentTimeMillis()
            )
          )
        }
      }

      val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        // Required from API 33; a bank SMS is an external broadcast.
        context.registerReceiver(created, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(created, filter)
      }

      receiver = created
    }

    AsyncFunction("stopListening") {
      val current = receiver ?: return@AsyncFunction
      appContext.reactContext?.unregisterReceiver(current)
      receiver = null
    }

    AsyncFunction("isListening") {
      receiver != null
    }

    OnDestroy {
      receiver?.let { current ->
        runCatching { appContext.reactContext?.unregisterReceiver(current) }
        receiver = null
      }
    }
  }
}
```

- [ ] **Step 5: Write `apps/relay/modules/sms-reader/src/SmsReader.types.ts`**

```ts
export interface IncomingSms {
  /** DLT header such as AX-ICICIB, or a phone number. */
  sender: string;
  body: string;
  /** Epoch milliseconds, from the device clock. */
  receivedAt: number;
}

export interface SmsReaderEvents {
  onSmsReceived: (event: IncomingSms) => void;
}
```

- [ ] **Step 6: Write `apps/relay/modules/sms-reader/index.ts`**

```ts
import { NativeModule, requireNativeModule } from "expo";
import type { IncomingSms, SmsReaderEvents } from "./src/SmsReader.types";

declare class SmsReaderModule extends NativeModule<SmsReaderEvents> {
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  isListening(): Promise<boolean>;
}

const SmsReader = requireNativeModule<SmsReaderModule>("SmsReader");

export function startListening(): Promise<void> {
  return SmsReader.startListening();
}

export function stopListening(): Promise<void> {
  return SmsReader.stopListening();
}

export function isListening(): Promise<boolean> {
  return SmsReader.isListening();
}

export function addSmsListener(
  listener: (event: IncomingSms) => void,
): { remove(): void } {
  return SmsReader.addListener("onSmsReceived", listener);
}

export type { IncomingSms };
```

- [ ] **Step 7: Rebuild so the native module is linked**

A new local module changes the native project, so a plain reload is not enough.

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm relay:prebuild
pnpm relay:android
```

Expected: the build succeeds. If Gradle reports `Could not find project ':expo-modules-core'`, the prebuild did not pick up the module — confirm `expo-module.config.json` sits at `apps/relay/modules/sms-reader/` and re-run prebuild with `--clean`.

- [ ] **Step 8: Commit**

```bash
git add apps/relay/modules
git commit -m "feat(relay): local expo module reading device sms"
```

---

## Task 3: Configuration, sender filter, and secure storage

**Files:**
- Create: `apps/relay/src/types.ts`, `apps/relay/src/senders.ts`, `apps/relay/src/config.ts`, `apps/relay/app/settings.tsx`, `apps/relay/vitest.config.ts`
- Test: `apps/relay/src/senders.test.ts`

**Interfaces:**
- Consumes: `expo-secure-store`
- Produces:
  - `RelayConfig = { serverUrl: string; secret: string; senders: string[] }`
  - `loadConfig(): Promise<RelayConfig>`
  - `saveConfig(config: RelayConfig): Promise<void>`
  - `parseSenderList(raw: string): string[]`
  - `isAllowedSender(sender: string, allowlist: readonly string[]): boolean`

- [ ] **Step 1: Write `apps/relay/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only pure logic is unit-tested here. Native and storage paths are
    // verified on device.
    include: ["src/senders.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing sender test**

Create `apps/relay/src/senders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedSender, parseSenderList } from "./senders";

describe("parseSenderList", () => {
  it("splits a comma-separated list and uppercases it", () => {
    expect(parseSenderList("iciciB, hdfcbk ,axisbk")).toEqual([
      "ICICIB",
      "HDFCBK",
      "AXISBK",
    ]);
  });

  it("drops empty entries", () => {
    expect(parseSenderList("ICICIB,,  ,HDFCBK")).toEqual(["ICICIB", "HDFCBK"]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseSenderList("")).toEqual([]);
    expect(parseSenderList("   ")).toEqual([]);
  });

  it("de-duplicates entries", () => {
    expect(parseSenderList("ICICIB,icicib")).toEqual(["ICICIB"]);
  });
});

describe("isAllowedSender", () => {
  const allow = ["ICICIB", "HDFCBK"];

  it("matches a DLT header containing an allowed fragment", () => {
    expect(isAllowedSender("AX-ICICIB", allow)).toBe(true);
    expect(isAllowedSender("VM-HDFCBK-S", allow)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAllowedSender("ax-icicib", allow)).toBe(true);
  });

  it("rejects an unlisted sender", () => {
    expect(isAllowedSender("JD-AMAZON", allow)).toBe(false);
  });

  it("rejects everything when the allowlist is empty", () => {
    // Fail closed. An empty allowlist means unconfigured, not "forward
    // everything" — forwarding every SMS on the device would be the worst
    // possible default.
    expect(isAllowedSender("AX-ICICIB", [])).toBe(false);
  });

  it("rejects a blank sender", () => {
    expect(isAllowedSender("", allow)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm --filter @asm/relay test
```

Expected: FAIL — cannot resolve `./senders`.

- [ ] **Step 4: Write `apps/relay/src/types.ts`**

```ts
export interface RelayConfig {
  /** Base URL of the demo server, e.g. http://192.168.1.20:3000 */
  serverUrl: string;
  /** Matches SMS_RELAY_SECRET on the server. */
  secret: string;
  /** Sender fragments to forward. Empty means forward nothing. */
  senders: string[];
}

export interface QueuedMessage {
  id: number;
  sender: string;
  body: string;
  receivedAt: number;
  attempts: number;
  nextAttemptAt: number;
}
```

- [ ] **Step 5: Write `apps/relay/src/senders.ts`**

```ts
export function parseSenderList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Pre-filter only. The server parses authoritatively; this exists so the phone
 * does not ship every OTP and delivery notification over the network.
 *
 * Fails closed on an empty allowlist: unconfigured must mean "forward nothing",
 * never "forward everything".
 */
export function isAllowedSender(
  sender: string,
  allowlist: readonly string[],
): boolean {
  if (allowlist.length === 0) return false;
  const upper = sender.trim().toUpperCase();
  if (upper.length === 0) return false;
  return allowlist.some((fragment) => upper.includes(fragment));
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @asm/relay test
```

Expected: PASS — 10 tests.

- [ ] **Step 7: Write `apps/relay/src/config.ts`**

```ts
import * as SecureStore from "expo-secure-store";
import { parseSenderList } from "./senders";
import type { RelayConfig } from "./types";

const KEY_SERVER = "relay.serverUrl";
const KEY_SECRET = "relay.secret";
const KEY_SENDERS = "relay.senders";

const EMPTY: RelayConfig = { serverUrl: "", secret: "", senders: [] };

/**
 * The relay secret lives in the OS keystore, never in a committed file and
 * never in plain AsyncStorage.
 */
export async function loadConfig(): Promise<RelayConfig> {
  try {
    const [serverUrl, secret, senders] = await Promise.all([
      SecureStore.getItemAsync(KEY_SERVER),
      SecureStore.getItemAsync(KEY_SECRET),
      SecureStore.getItemAsync(KEY_SENDERS),
    ]);

    return {
      serverUrl: serverUrl ?? "",
      secret: secret ?? "",
      senders: parseSenderList(senders ?? ""),
    };
  } catch {
    return EMPTY;
  }
}

export async function saveConfig(config: RelayConfig): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_SERVER, config.serverUrl.trim()),
    SecureStore.setItemAsync(KEY_SECRET, config.secret.trim()),
    SecureStore.setItemAsync(KEY_SENDERS, config.senders.join(",")),
  ]);
}

export function isConfigComplete(config: RelayConfig): boolean {
  return (
    config.serverUrl.startsWith("http") &&
    config.secret.length > 0 &&
    config.senders.length > 0
  );
}
```

- [ ] **Step 8: Write `apps/relay/app/settings.tsx`**

```tsx
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { loadConfig, saveConfig } from "@/config";
import { parseSenderList } from "@/senders";

export default function Settings() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [sendersRaw, setSendersRaw] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadConfig().then((config) => {
      setServerUrl(config.serverUrl);
      setSecret(config.secret);
      setSendersRaw(config.senders.join(", "));
    });
  }, []);

  async function onSave() {
    await saveConfig({
      serverUrl,
      secret,
      senders: parseSenderList(sendersRaw),
    });
    setSaved(true);
    setTimeout(() => router.back(), 600);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.field}>
        <Text style={styles.label}>Server URL</Text>
        <TextInput
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="http://192.168.1.20:3000"
          placeholderTextColor="#5b6a7d"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Text style={styles.hint}>
          Your machine&apos;s LAN address, not localhost — the phone is a
          different device.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Relay secret</Text>
        <TextInput
          value={secret}
          onChangeText={setSecret}
          placeholder="SMS_RELAY_SECRET from .env"
          placeholderTextColor="#5b6a7d"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Bank senders</Text>
        <TextInput
          value={sendersRaw}
          onChangeText={setSendersRaw}
          placeholder="ICICIB, HDFCBK, AXISBK"
          placeholderTextColor="#5b6a7d"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.hint}>
          Only messages from these senders leave the phone. Empty means nothing
          is forwarded.
        </Text>
      </View>

      <Pressable onPress={() => void onSave()} style={styles.button}>
        <Text style={styles.buttonText}>{saved ? "Saved" : "Save"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 20 },
  field: { gap: 6 },
  label: {
    color: "#93a2b4",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#1c2836",
    borderColor: "#253243",
    borderWidth: 1,
    borderRadius: 8,
    color: "#e8edf3",
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  hint: { color: "#6b7a8d", fontSize: 12, lineHeight: 17 },
  button: {
    backgroundColor: "#3d8bfd",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
});
```

- [ ] **Step 9: Commit**

```bash
git add apps/relay
git commit -m "feat(relay): secure configuration and sender pre-filter"
```

---

## Task 4: The outbox queue and forwarder

**Files:**
- Create: `apps/relay/src/queue.ts`, `apps/relay/src/forwarder.ts`

**Interfaces:**
- Consumes: `expo-sqlite`; `RelayConfig`, `QueuedMessage`
- Produces:
  - `openQueue(): Promise<SQLiteDatabase>`
  - `enqueue(sender: string, body: string, receivedAt: number): Promise<void>`
  - `dueMessages(limit: number): Promise<QueuedMessage[]>`
  - `markSent(id: number): Promise<void>`
  - `markFailed(id: number, attempts: number): Promise<void>`
  - `queueStats(): Promise<{ pending: number; sent: number }>`
  - `startForwarder(getConfig: () => RelayConfig): { stop(): void }`

**Why a queue rather than a direct POST.** A phone loses signal constantly. Posting inline would drop a credit alert whenever the network blinked, and a lost credit means a deposit that never confirms. The queue makes delivery at-least-once; the server's unique constraint on UTR makes it effectively exactly-once.

- [ ] **Step 1: Write `apps/relay/src/queue.ts`**

```ts
import * as SQLite from "expo-sqlite";
import type { QueuedMessage } from "./types";

let db: SQLite.SQLiteDatabase | null = null;

export async function openQueue(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  db = await SQLite.openDatabaseAsync("relay-outbox.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outbox (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sender        TEXT    NOT NULL,
      body          TEXT    NOT NULL,
      receivedAt    INTEGER NOT NULL,
      attempts      INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt INTEGER NOT NULL DEFAULT 0,
      sentAt        INTEGER
    );
    CREATE INDEX IF NOT EXISTS outbox_due
      ON outbox (sentAt, nextAttemptAt);
  `);
  return db;
}

export async function enqueue(
  sender: string,
  body: string,
  receivedAt: number,
): Promise<void> {
  const database = await openQueue();
  await database.runAsync(
    "INSERT INTO outbox (sender, body, receivedAt, nextAttemptAt) VALUES (?, ?, ?, ?)",
    sender,
    body,
    receivedAt,
    Date.now(),
  );
}

export async function dueMessages(limit: number): Promise<QueuedMessage[]> {
  const database = await openQueue();
  return database.getAllAsync<QueuedMessage>(
    `SELECT id, sender, body, receivedAt, attempts, nextAttemptAt
       FROM outbox
      WHERE sentAt IS NULL AND nextAttemptAt <= ?
      ORDER BY receivedAt ASC
      LIMIT ?`,
    Date.now(),
    limit,
  );
}

export async function markSent(id: number): Promise<void> {
  const database = await openQueue();
  await database.runAsync("UPDATE outbox SET sentAt = ? WHERE id = ?", Date.now(), id);
}

/** Exponential backoff, capped at five minutes. */
export async function markFailed(id: number, attempts: number): Promise<void> {
  const database = await openQueue();
  const delayMs = Math.min(300_000, 2_000 * 2 ** attempts);
  await database.runAsync(
    "UPDATE outbox SET attempts = ?, nextAttemptAt = ? WHERE id = ?",
    attempts + 1,
    Date.now() + delayMs,
    id,
  );
}

export async function queueStats(): Promise<{ pending: number; sent: number }> {
  const database = await openQueue();
  const row = await database.getFirstAsync<{ pending: number; sent: number }>(
    `SELECT
       SUM(CASE WHEN sentAt IS NULL THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN sentAt IS NOT NULL THEN 1 ELSE 0 END) AS sent
     FROM outbox`,
  );
  return { pending: row?.pending ?? 0, sent: row?.sent ?? 0 };
}
```

- [ ] **Step 2: Write `apps/relay/src/forwarder.ts`**

```ts
import { dueMessages, markFailed, markSent } from "./queue";
import type { RelayConfig } from "./types";

const DRAIN_INTERVAL_MS = 4_000;
const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 12;

async function postOne(
  config: RelayConfig,
  message: { sender: string; body: string; receivedAt: number },
): Promise<boolean> {
  try {
    const response = await fetch(`${config.serverUrl}/api/bank-feed/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify({
        sender: message.sender,
        body: message.body,
        receivedAt: new Date(message.receivedAt).toISOString(),
      }),
    });

    // 202 covers both "accepted" and "parsed to nothing" — an ignored
    // promotional SMS is a success from the phone's point of view.
    // 400 means the server will never accept this payload, so retrying is
    // pointless; treat it as delivered and stop.
    return response.status === 202 || response.status === 400;
  } catch {
    return false;
  }
}

/**
 * Drains the outbox on a timer. At-least-once delivery; the server's unique
 * constraint on UTR makes the duplicate harmless.
 */
export function startForwarder(getConfig: () => RelayConfig): { stop(): void } {
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const drain = async (): Promise<void> => {
    const config = getConfig();

    if (config.serverUrl.startsWith("http") && config.secret.length > 0) {
      const batch = await dueMessages(BATCH_SIZE).catch(() => []);

      for (const message of batch) {
        if (message.attempts >= MAX_ATTEMPTS) {
          // Give up rather than retrying forever, but keep the row so the
          // failure is visible rather than silent.
          await markFailed(message.id, message.attempts).catch(() => {});
          continue;
        }

        const ok = await postOne(config, message);
        if (ok) {
          await markSent(message.id).catch(() => {});
        } else {
          await markFailed(message.id, message.attempts).catch(() => {});
        }
      }
    }

    if (running) timer = setTimeout(() => void drain(), DRAIN_INTERVAL_MS);
  };

  void drain();

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/relay/src
git commit -m "feat(relay): sqlite outbox with backoff and forwarder"
```

---

## Task 5: The main screen and permission flow

**Files:**
- Modify: `apps/relay/app/index.tsx`

**Interfaces:**
- Consumes: everything above; `PermissionsAndroid` from `react-native`
- Produces: a screen that requests `RECEIVE_SMS`, starts and stops the listener, and shows queue counts

- [ ] **Step 1: Replace `apps/relay/app/index.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, useFocusEffect } from "expo-router";
import {
  addSmsListener,
  startListening,
  stopListening,
} from "../modules/sms-reader";
import { isConfigComplete, loadConfig } from "@/config";
import { enqueue, queueStats } from "@/queue";
import { startForwarder } from "@/forwarder";
import { isAllowedSender } from "@/senders";
import type { RelayConfig } from "@/types";

const EMPTY_CONFIG: RelayConfig = { serverUrl: "", secret: "", senders: [] };

export default function Home() {
  const [config, setConfig] = useState<RelayConfig>(EMPTY_CONFIG);
  const [listening, setListening] = useState(false);
  const [granted, setGranted] = useState(false);
  const [stats, setStats] = useState({ pending: 0, sent: 0 });
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  // The forwarder reads config through a ref so it picks up edits without
  // being restarted.
  const configRef = useRef<RelayConfig>(EMPTY_CONFIG);
  configRef.current = config;

  const subscriptionRef = useRef<{ remove(): void } | null>(null);
  const forwarderRef = useRef<{ stop(): void } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadConfig().then(setConfig);
    }, []),
  );

  useEffect(() => {
    forwarderRef.current = startForwarder(() => configRef.current);
    const interval = setInterval(() => {
      void queueStats().then(setStats);
    }, 3_000);

    return () => {
      forwarderRef.current?.stop();
      clearInterval(interval);
    };
  }, []);

  async function requestPermission(): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      {
        title: "Read incoming SMS",
        message:
          "ASM Relay forwards bank alerts from this phone to your own demo server.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );
    const ok = result === PermissionsAndroid.RESULTS.GRANTED;
    setGranted(ok);
    return ok;
  }

  async function toggle() {
    if (listening) {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      await stopListening();
      setListening(false);
      return;
    }

    if (!(await requestPermission())) return;

    subscriptionRef.current = addSmsListener((event) => {
      // Pre-filter on the device so unrelated messages never leave it.
      if (!isAllowedSender(event.sender, configRef.current.senders)) return;

      setLastSeen(`${event.sender} · ${event.body.slice(0, 48)}…`);
      void enqueue(event.sender, event.body, event.receivedAt);
    });

    await startListening();
    setListening(true);
  }

  const ready = isConfigComplete(config);

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Status</Text>
        <Text
          style={[
            styles.status,
            { color: listening ? "#2fbd85" : "#93a2b4" },
          ]}
        >
          {listening ? "Listening" : "Stopped"}
        </Text>
        <Text style={styles.meta}>
          {config.senders.length === 0
            ? "No senders configured — nothing will be forwarded."
            : `Forwarding from ${config.senders.join(", ")}`}
        </Text>
      </View>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.cardLabel}>Queued</Text>
          <Text style={styles.statValue}>{stats.pending}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.cardLabel}>Sent</Text>
          <Text style={styles.statValue}>{stats.sent}</Text>
        </View>
      </View>

      {lastSeen ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Last matched message</Text>
          <Text style={styles.meta}>{lastSeen}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => void toggle()}
        disabled={!ready && !listening}
        style={[
          styles.button,
          {
            backgroundColor: listening ? "#e0526a" : "#2fbd85",
            opacity: !ready && !listening ? 0.4 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.buttonText,
            { color: listening ? "#ffffff" : "#06231a" },
          ]}
        >
          {listening ? "Stop" : "Start listening"}
        </Text>
      </Pressable>

      {!ready ? (
        <Text style={styles.warning}>
          Set the server URL, relay secret and sender list before starting.
        </Text>
      ) : null}

      {!granted && listening ? (
        <Text style={styles.warning}>SMS permission was not granted.</Text>
      ) : null}

      <Link href="/settings" style={styles.link}>
        Settings
      </Link>

      <Text style={styles.footer}>
        Reads only this device&apos;s messages, only from the senders above, and
        sends them only to your own server. Demonstration use.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 14, justifyContent: "center" },
  card: {
    backgroundColor: "#16202c",
    borderColor: "#253243",
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 4,
  },
  cardLabel: {
    color: "#93a2b4",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  status: { fontSize: 22, fontWeight: "700" },
  meta: { color: "#93a2b4", fontSize: 12, lineHeight: 17 },
  row: { flexDirection: "row", gap: 12 },
  stat: {
    flex: 1,
    backgroundColor: "#16202c",
    borderColor: "#253243",
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 4,
  },
  statValue: {
    color: "#e8edf3",
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  button: { borderRadius: 10, paddingVertical: 15, alignItems: "center" },
  buttonText: { fontSize: 15, fontWeight: "700" },
  warning: { color: "#e0ac50", fontSize: 12, textAlign: "center" },
  link: {
    color: "#3d8bfd",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
  },
  footer: {
    color: "#6b7a8d",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 8,
  },
});
```

- [ ] **Step 2: Rebuild and run on device**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm relay:android
```

- [ ] **Step 3: Commit**

```bash
git add apps/relay/app
git commit -m "feat(relay): status screen with permission and queue display"
```

---

## Task 6: End-to-end verification with the server

**Files:**
- Modify: none

- [ ] **Step 1: Find the machine's LAN address**

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

Note the address — the phone needs it. `localhost` will not work; the phone is a different device.

- [ ] **Step 2: Switch the server to the SMS feed**

Edit `.env`:

```bash
BANK_FEED="sms"
```

Then restart both processes:

```bash
pnpm dev:engine
```

```bash
pnpm dev
```

Expected engine log: `bankfeed.started` with `feed: "sms"`.

- [ ] **Step 3: Verify the relay endpoint rejects an unauthenticated post**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/bank-feed/sms \
  -H 'Content-Type: application/json' \
  -d '{"sender":"AX-ICICIB","body":"Rs.100.00 credited","receivedAt":"2026-09-12T10:00:00.000Z"}'
```

Expected: `401`.

- [ ] **Step 4: Verify it accepts an authenticated post**

```bash
curl -s -X POST http://localhost:3000/api/bank-feed/sms \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer local-dev-relay-secret-change-me" \
  -d '{"sender":"AX-ICICIB","body":"Rs.10764.37 credited to a/c XX4321 (UPI Ref 528312345678)","receivedAt":"2026-09-12T10:00:00.000Z"}' \
  -w "\n%{http_code}\n"
```

Expected: `{"accepted":true}` and `202`.

```bash
psql -d asm_trade -c 'SELECT "amountInr", utr FROM "BankCredit" ORDER BY "createdAt" DESC LIMIT 1;'
```

Expected: `1076437` and `528312345678`.

- [ ] **Step 5: Configure the app and run the live path**

On the phone, open **Settings** and enter the LAN URL, the relay secret, and the bank sender fragments. Save, then press **Start listening** and grant the permission.

Send yourself a test SMS from a second phone with a body shaped like a bank alert, using a sender you have allowlisted. Expected: **Queued** increments, then **Sent** increments within a few seconds, and the server logs `bankfeed.sms_relayed`.

For the real thing: make a genuine ₹1 UPI payment to your own account from another of your accounts. The bank's credit alert should flow phone → server → `BankCredit`.

- [ ] **Step 6: Verify offline queueing**

Put the phone into airplane mode and send another allowlisted test SMS. Expected: **Queued** rises and **Sent** does not. Restore connectivity and it drains within a few seconds.

- [ ] **Step 7: Verify the sender filter**

Send a message from a sender that is *not* allowlisted. Expected: neither counter moves, and nothing reaches the server — the message never left the phone.

- [ ] **Step 8: Restore the simulated feed**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
sed -i '' 's/^BANK_FEED="sms"/BANK_FEED="simulated"/' .env
grep '^BANK_FEED=' .env
```

Expected: `BANK_FEED="simulated"`. This is the standing constraint — the SMS path is now a proven seam, and it goes back to being unplugged.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: plan 06 verification"
```

---

## Definition of Done

- [ ] `pnpm --filter @asm/relay test` passes — 10 sender-filter tests
- [ ] `pnpm relay:prebuild` generates an Android project containing `RECEIVE_SMS`
- [ ] `pnpm relay:android` installs a working debug build on a device or emulator
- [ ] The settings screen persists server URL, secret and senders across an app restart
- [ ] Pressing **Start listening** prompts for the SMS permission and shows **Listening**
- [ ] An allowlisted test SMS increments **Queued** then **Sent**
- [ ] A non-allowlisted SMS increments neither and never reaches the server
- [ ] `POST /api/bank-feed/sms` without the bearer token returns 401
- [ ] A relayed bank alert lands in `BankCredit` with the right amount and UTR
- [ ] Airplane mode queues messages and they drain on reconnect
- [ ] `BANK_FEED` is back to `simulated` at the end

## Known limitations, stated plainly

- **The relay works only while the app is open.** The receiver is registered dynamically, so Android may stop it when the app is killed or the OEM battery manager intervenes — Xiaomi, Oppo and Vivo are notorious for this. A manifest-declared receiver would survive longer but needs a static bridge to JS and still fights background limits.
- **No delivery guarantee.** If the phone misses an SMS, nothing detects it. There is no acknowledgement channel from the bank.
- **The parser can drift.** Banks reword templates without notice. The server's candidate-plus-disambiguate approach tolerates more of this than per-bank templates, but not all of it.

These are the reasons the specification calls this infrastructure genuinely bad, and the reasons `simulated` stays the configured feed. The app exists to show the mechanism works, not because it is a good way to move money.

## What Plan 07 depends on from here

Nothing. Plan 07 (Platform surface) touches only the web app and has no dependency on the companion app.
