# Mobile sub-project 5 — iPhone PWA, distribution, releases

**Date:** 2026-10-14 · **Overview:** [mobile app overview](2026-10-14-mobile-app-overview-design.md) · **Needs:** [1](2026-10-14-mobile-p1-server-design.md) (push parts need [4](2026-10-14-mobile-p4-push-design.md))

## Goal

Give iPhone users a home-screen app with push, point logged-in Android web
users to the app, serve the APK and over-the-air (OTA) updates from our VPS,
and make releases a tag push — all without an Expo account.

## A. iPhone home-screen web app

**Manifest (`app/manifest.ts`):** add `id: "/?app=pwa"`, `scope: "/"`,
`start_url: "/trade?source=pwa"`, `orientation: "portrait"`, maskable icons
(192, 512) generated from the gold mark, `theme_color`/`background_color`
from the current tokens.

**Root layout metadata:** `appleWebApp: { capable: true, statusBarStyle:
"black-translucent", title: "IndianxTrade" }`, apple-touch-icon 180, iPhone
splash images (`apple-touch-startup-image` for the common sizes).

**Service worker `public/sw.js`** (plain JS, served with
`Cache-Control: no-cache`, `Service-Worker-Allowed: /`):

- `push` → `showNotification(title, { body, data: { url }, icon, badge })`.
- `notificationclick` → focus an open client and navigate to `url`, else
  `clients.openWindow(url)`.
- **No fetch handler, no caching** — balances must never come from a cache.

**Registration (client component in the platform shell):** register `sw.js`
only when `matchMedia("(display-mode: standalone)").matches` or
`navigator.standalone`.

**Notifications toggle (web Account page, installed app only):** "Turn on
notifications" → `Notification.requestPermission()` (must be a tap) →
`PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` with
the key from `GET /api/v1/push/vapid` → `POST /api/v1/push/devices`
(`platform: "WEBPUSH"`, endpoint, keys). Off → unsubscribe + `DELETE`.
Hidden on iOS < 16.4 (no `PushManager`).

**Install guide sheet:** logged-in pages, iPhone Safari (`/iPhone|iPad/` UA,
not standalone, not in-app browsers like Instagram/FB). Three illustrated
steps: Share → Add to Home Screen → Add. Shown at most once per 7 days
(localStorage, wrapped in try/catch), "Don't show again" sets a permanent
flag. Never on public/SEO pages.

## B. Android "Get the app" bar

Logged-in pages only, Android phone browsers, not standalone: a slim
dismissible bar above the bottom nav — "Get the IndianxTrade app — faster
trades, instant alerts" + button. Target from `GET /api/v1/app/config`:
`playUrl` when `playLive`, else `/download/app`. Dismiss hides it for 14 days
(localStorage). Never on landing, guides, compare, legal pages.

## C. APK download

- VPS directory `/srv/app/releases/` (bind-mounted read-only into the web
  container at `/app/releases`) holds `indianxtrade-<version>.apk` and
  `indianxtrade-<version>.apk.sha256`.
- `GET /download/app` → 307 to `/download/app/<APP_LATEST_VERSION>`.
- `GET /download/app/[version]` streams the APK
  (`Content-Type: application/vnd.android.package-archive`,
  `Content-Disposition: attachment`), 404 for unknown versions; version
  validated against `^\d+\.\d+\.\d+$` (no path traversal).
- A small "How to install" page section on `/download/app?help=1`
  (allow-unknown-sources steps, checksum).

## D. OTA update server (expo-updates protocol v1)

App config: `updates.url = https://<site>/api/v1/app/updates`,
`runtimeVersion: { policy: "appVersion" }`, code signing enabled with our
certificate (`codeSigningCertificate`, `keyid: "main"`, `alg: rsa-v1_5-sha256`).

Storage: `/srv/app/updates/<runtimeVersion>/<updateId>/` = output of
`expo export --platform android` (`metadata.json`, bundles, assets) plus
`expoConfig.json`; bind-mounted read-only at `/app/updates`.

`GET /api/v1/app/updates` (headers `expo-runtime-version`,
`expo-platform`, `expo-protocol-version`, `expo-expect-signature`):

- Pick the newest update directory for that runtime version (by directory
  mtime recorded in `metadata.json` → `createdAt` field we add at publish).
- No update → `204` with `expo-protocol-version: 1` (or a
  `noUpdateAvailable` directive).
- Else multipart/mixed response with the `manifest` part (id = deterministic
  UUID from the update directory hash, `launchAsset`, `assets` with SHA-256
  hashes and URLs to `/api/v1/app/updates/assets?path=…`, `metadata`,
  `extra.expoClient`) and the `expo-signature` header part signed with
  `EXPO_UPDATES_PRIVATE_KEY` (env on the VPS).
- `GET /api/v1/app/updates/assets?path=` serves a file inside the update
  directory with correct content type; rejects paths escaping the root.

Rollback = delete the newest update directory (the previous one is served
again on next launch).

## E. Release pipeline

**Variants:** `APP_VARIANT=play|direct` drives `app.config.ts` (package id,
name suffix in debug only) — see sub-project 2.

**GitHub Actions `.github/workflows/mobile-release.yml`** (on tags
`app-v*.*.*`):

1. Checkout, pnpm 10.33.0, Node 22, JDK 17, Android SDK (cmdline-tools,
   platform 36, build-tools).
2. `pnpm install --filter @asm/mobile...`, run mobile unit tests and
   typecheck.
3. Assert the tag version equals `apps/mobile/package.json` version.
4. For `play`: `APP_VARIANT=play expo prebuild --platform android --clean`,
   then `./gradlew bundleRelease` signed with the Play upload key.
5. For `direct`: same with `APP_VARIANT=direct`, `./gradlew assembleRelease`
   signed with the direct keystore.
6. Keystores come from base64 secrets (`PLAY_UPLOAD_KEYSTORE_B64`,
   `PLAY_UPLOAD_KEYSTORE_PASSWORD`, `PLAY_UPLOAD_KEY_ALIAS`,
   `PLAY_UPLOAD_KEY_PASSWORD`, and `DIRECT_*` equivalents), written to the
   runner's temp dir and deleted in an `always()` step.
7. SHA-256 the APK, rsync APK + checksum to `/srv/app/releases/` with the
   existing deploy SSH secret.
8. Create a GitHub Release with the AAB and APK attached (the AAB is uploaded
   to Play Console by hand).
9. Does **not** change `APP_LATEST_VERSION` — that env bump is a deliberate
   manual step after testing the APK.

**OTA workflow** (same file, tags `app-ota-v*`): install, test, `expo export
--platform android` with `APP_VARIANT=direct` and again `play` (bundles are
identical except config; both runtime versions get the update), add
`createdAt` to `metadata.json`, rsync to `/srv/app/updates/<runtimeVersion>/
<updateId>/`.

**Mac backup:** `scripts/app-release.sh [build|ota] <version>` performs the
same steps locally (keystores from `~/.indianxtrade/keys/`, never in the repo),
documented in `docs/mobile-release.md` together with: required toolchain
(JDK 17, Android SDK 36), env vars, how to upload the AAB to Play, how to bump
`APP_LATEST_VERSION` / `APP_MIN_VERSION`, OTA rollback, and key backup &
recovery.

**Keys (all backed up offline by the owner):** Play upload keystore, direct
APK keystore, OTA code-signing private key + certificate (certificate is
committed in `apps/mobile/certs/`, private key only in VPS env and the
offline backup), Firebase service account, VAPID keypair.

## Testing

- Web (vitest): APK route version validation and 404s; updates route —
  no-update 204, manifest shape, signature verifies with the certificate,
  asset path traversal rejected; app-config driven Get-the-app target.
- Web (component/unit): install-sheet frequency rules and UA detection;
  get-app bar visibility rules (Android only, logged-in only, not standalone).
- Manual: install PWA on iOS 16.4+ device, enable push, receive a test push,
  tap opens History; install `direct` APK from the site on a clean phone; OTA:
  publish a visible text change, relaunch twice, change appears; rollback.
- CI dry run: tag `app-v0.0.1-rc` on a fork/branch with test keys.

## Out of scope

App Store, Play Console API automation, staged rollouts, any service-worker
caching.
