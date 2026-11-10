# Mobile P5 — iPhone PWA, Distribution, Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPhone users get an installable home-screen web app with push; logged-in Android web users are pointed at the app; the APK and over-the-air (OTA) updates are served from our VPS; Android releases build from a git tag in GitHub Actions (with a documented Mac fallback) — no Expo account.

**Architecture:** PWA = manifest + metadata + a push-only service worker registered only in standalone mode, plus small client components in the platform shell (install sheet, get-app bar, push toggle) driven by pure visibility rules. Distribution = Next.js routes streaming files from read-only bind mounts (`/app/releases`, `/app/updates`). The OTA endpoint implements the expo-updates protocol v1 with RSA code signing. CI builds two Android variants with `expo prebuild` + Gradle and rsyncs artifacts to the VPS.

**Tech Stack:** Next.js 16 (`apps/web`), Web Push API + service worker, `expo-updates`, GitHub Actions (JDK 17, Android SDK 36), Docker Compose bind mounts, bash.

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-p5-pwa-distribution-design.md` · **Needs:** P1 (app config, `/api/v1` helpers); push parts need P4 (devices route, VAPID route); OTA/app parts need P2.

## Global Constraints

- Public/SEO pages (landing, guides, compare, legal, about, security) never show the install sheet or the get-app bar.
- Service worker: **no fetch handler, no caching** — push and notification click only. Served with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`.
- Web push permission is requested only from a user tap inside the installed (standalone) app; hidden when `PushManager` is missing (iOS < 16.4).
- Install sheet: iPhone Safari, logged in, not standalone, not in-app browsers; at most once per 7 days; "Don't show again" is permanent. Get-app bar: Android phone browsers, logged in, not standalone; dismiss hides for 14 days. All browser-storage access wrapped in try/catch.
- APK files: `/srv/app/releases/indianxtrade-<semver>.apk` (+ `.sha256`), mounted read-only at `/app/releases`. Version strings must match `^\d+\.\d+\.\d+$`.
- OTA files: `/srv/app/updates/<runtimeVersion>/<updateId>/`, mounted read-only at `/app/updates`. `runtimeVersion` policy `appVersion`. Code signing `rsa-v1_5-sha256`, `keyid "main"`; private key only in VPS env (`EXPO_UPDATES_PRIVATE_KEY`) and the owner's offline backup; certificate committed at `apps/mobile/certs/certificate.pem`.
- Release tags: `app-v<semver>` (full build), `app-ota-v<semver>` (OTA only). The tag version must equal `apps/mobile/package.json` `version` (and `app.config.ts` `version`).
- `APP_LATEST_VERSION` / `APP_MIN_VERSION` are bumped by hand after testing, never by CI.
- Keystores, `google-services.json`, Firebase and VAPID secrets never enter the repo.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

| File | Responsibility |
|---|---|
| `apps/web/src/app/manifest.ts` | PWA manifest |
| `apps/web/src/app/layout.tsx` | `appleWebApp`, icons, startup images |
| `apps/web/public/sw.js` | push + notificationclick |
| `apps/web/next.config.ts` | headers for `/sw.js` |
| `apps/web/src/lib/install-rules.ts` (+test) | pure visibility rules for sheet/bar/push toggle |
| `apps/web/src/lib/web-push-client.ts` (+test) | subscription → request body, VAPID key decode |
| `apps/web/src/components/pwa/{ServiceWorkerRegistrar,IosInstallSheet,GetAppBar,PushToggle}.tsx` | client components |
| `apps/web/src/components/shell/PlatformShell.tsx`, `components/account/AccountHub.tsx` | mount points |
| `apps/web/src/app/download/app/route.ts`, `download/app/[version]/route.ts` (+tests) | APK download |
| `apps/web/src/lib/expo-updates.ts` (+test), `app/api/v1/app/updates/route.ts`, `…/assets/route.ts` | OTA server |
| `deploy/docker-compose.yml` | bind mounts |
| `apps/mobile/app.config.ts`, `apps/mobile/certs/certificate.pem`, `apps/mobile/src/update/*` | OTA client + direct-build update prompt |
| `.github/workflows/mobile-release.yml` | CI builds |
| `scripts/app-release.sh`, `docs/mobile-release.md` | Mac fallback + runbook |

---

### Task 1: Manifest and iPhone metadata

**Files:**
- Modify: `apps/web/src/app/manifest.ts`, `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/manifest.test.ts`
- Create: `apps/web/public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-splash-*.png`

**Interfaces:**
- Produces: manifest with `id: "/?app=pwa"`, `start_url: "/trade?source=pwa"`, `scope: "/"`, `display: "standalone"`, `orientation: "portrait"`, icons 192/512 (any) + 512 (maskable).

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
  it("opens the installed app on the trade screen, not the landing page", () => {
    const m = manifest();
    expect(m).toMatchObject({ id: "/?app=pwa", start_url: "/trade?source=pwa", scope: "/", display: "standalone", orientation: "portrait" });
  });
  it("ships a maskable icon for Android home screens", () => {
    expect(manifest().icons?.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
  });
});
```

Run: `pnpm --filter @asm/web exec vitest run src/app/manifest.test.ts` → FAIL.

- [ ] **Step 2: Icons**

Generate from `apps/web/public/brand/indianxtrade-mark.png` (gold mark) on the dark background `#1e2024` (the current `theme_color`):
```bash
cd apps/web/public && mkdir -p icons
magick brand/indianxtrade-mark.png -resize 192x192 -background "#1e2024" -gravity center -extent 192x192 icons/icon-192.png
magick brand/indianxtrade-mark.png -resize 512x512 -background "#1e2024" -gravity center -extent 512x512 icons/icon-512.png
magick brand/indianxtrade-mark.png -resize 360x360 -background "#1e2024" -gravity center -extent 512x512 icons/maskable-512.png
for s in 1170x2532 1179x2556 1290x2796 1125x2436 828x1792 750x1334; do
  magick -size $s xc:"#1e2024" \( brand/indianxtrade-mark.png -resize 360x360 \) -gravity center -composite icons/apple-splash-$s.png
done
```
(The maskable icon keeps the mark inside the 80% safe zone.) If ImageMagick is unavailable, use `sharp` in a one-off Node script in the scratchpad.

- [ ] **Step 3: Implement**

`manifest.ts`:

```ts
import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/?app=pwa",
    name: `${SITE_NAME} — Trading`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/trade?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1e2024",
    theme_color: "#1e2024",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

In `layout.tsx` `metadata`, add:

```ts
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
    startupImage: [
      { url: "/icons/apple-splash-1170x2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-1179x2556.png", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-1290x2796.png", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-1125x2436.png", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-828x1792.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/icons/apple-splash-750x1334.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
```

Check the `Metadata['appleWebApp']` type in `node_modules/next/dist/lib/metadata/types` for the exact field names in this Next version before writing (AGENTS.md rule). `apple-icon.png` (180px) already exists in `app/`.

- [ ] **Step 4: Run, build, commit**

Run: `pnpm --filter @asm/web exec vitest run src/app/manifest.test.ts && pnpm --filter @asm/web build` → PASS; `curl -s localhost:3000/manifest.webmanifest` after `pnpm --filter @asm/web start` shows the new fields.

```bash
git add apps/web/src/app/manifest.ts apps/web/src/app/manifest.test.ts apps/web/src/app/layout.tsx apps/web/public/icons
git commit -m "feat(web): installable PWA manifest and iPhone metadata"
```

---

### Task 2: Visibility rules (pure) and the service worker

**Files:**
- Create: `apps/web/src/lib/install-rules.ts`, `install-rules.test.ts`
- Create: `apps/web/public/sw.js`, `apps/web/src/components/pwa/ServiceWorkerRegistrar.tsx`
- Modify: `apps/web/next.config.ts` (headers), `apps/web/src/components/shell/PlatformShell.tsx`

**Interfaces:**
- Produces (`install-rules.ts`):
  - `type DeviceKind = "iphone-safari" | "iphone-other" | "android-phone" | "other"`
  - `deviceKind(userAgent: string): DeviceKind`
  - `isStandalone(env: { displayModeStandalone: boolean; navigatorStandalone: boolean | undefined }): boolean`
  - `isPublicPath(pathname: string): boolean`
  - `showIosInstallSheet(s: { kind: DeviceKind; standalone: boolean; loggedIn: boolean; pathname: string; lastShownAt: number | null; dismissedForever: boolean; now: number }): boolean`
  - `showGetAppBar(s: { kind: DeviceKind; standalone: boolean; loggedIn: boolean; pathname: string; dismissedAt: number | null; now: number }): boolean`
  - `canOfferWebPush(s: { standalone: boolean; hasPushManager: boolean; hasNotification: boolean }): boolean`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { canOfferWebPush, deviceKind, isPublicPath, showGetAppBar, showIosInstallSheet } from "./install-rules";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DAY = 86_400_000;
const now = 100 * DAY;

describe("deviceKind", () => {
  it("recognises iPhone Safari and nothing else as installable on iOS", () => {
    expect(deviceKind(IPHONE_SAFARI)).toBe("iphone-safari");
    expect(deviceKind(IPHONE_INSTAGRAM)).toBe("iphone-other");
    expect(deviceKind(IPHONE_CHROME)).toBe("iphone-other");
  });
  it("treats Android phones, not tablets, as app targets", () => {
    expect(deviceKind(ANDROID_CHROME)).toBe("android-phone");
    expect(deviceKind(ANDROID_TABLET)).toBe("other");
  });
});

describe("isPublicPath", () => {
  it("covers the landing and content pages", () => {
    for (const p of ["/", "/guides", "/guides/x", "/compare/y", "/about", "/legit", "/security"]) expect(isPublicPath(p)).toBe(true);
    expect(isPublicPath("/trade")).toBe(false);
  });
});

describe("showIosInstallSheet", () => {
  const base = { kind: "iphone-safari" as const, standalone: false, loggedIn: true, pathname: "/trade", lastShownAt: null, dismissedForever: false, now };
  it("shows to a signed-in iPhone Safari user who hasn't installed", () => {
    expect(showIosInstallSheet(base)).toBe(true);
  });
  it("waits a week between showings and respects don't-show-again", () => {
    expect(showIosInstallSheet({ ...base, lastShownAt: now - 6 * DAY })).toBe(false);
    expect(showIosInstallSheet({ ...base, lastShownAt: now - 7 * DAY })).toBe(true);
    expect(showIosInstallSheet({ ...base, dismissedForever: true })).toBe(false);
  });
  it("never shows on public pages, when installed, signed out, or in other browsers", () => {
    expect(showIosInstallSheet({ ...base, pathname: "/" })).toBe(false);
    expect(showIosInstallSheet({ ...base, standalone: true })).toBe(false);
    expect(showIosInstallSheet({ ...base, loggedIn: false })).toBe(false);
    expect(showIosInstallSheet({ ...base, kind: "iphone-other" })).toBe(false);
  });
});

describe("showGetAppBar", () => {
  const base = { kind: "android-phone" as const, standalone: false, loggedIn: true, pathname: "/history", dismissedAt: null, now };
  it("shows on logged-in Android phone pages and hides for 14 days after dismissal", () => {
    expect(showGetAppBar(base)).toBe(true);
    expect(showGetAppBar({ ...base, dismissedAt: now - 13 * DAY })).toBe(false);
    expect(showGetAppBar({ ...base, dismissedAt: now - 14 * DAY })).toBe(true);
  });
  it("never shows on public pages or on iPhone", () => {
    expect(showGetAppBar({ ...base, pathname: "/guides" })).toBe(false);
    expect(showGetAppBar({ ...base, kind: "iphone-safari" })).toBe(false);
  });
});

describe("canOfferWebPush", () => {
  it("only offers push inside the installed app on a browser that supports it", () => {
    expect(canOfferWebPush({ standalone: true, hasPushManager: true, hasNotification: true })).toBe(true);
    expect(canOfferWebPush({ standalone: false, hasPushManager: true, hasNotification: true })).toBe(false);
    expect(canOfferWebPush({ standalone: true, hasPushManager: false, hasNotification: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `install-rules.ts`**

```ts
export type DeviceKind = "iphone-safari" | "iphone-other" | "android-phone" | "other";

const DAY = 86_400_000;
const PUBLIC = [/^\/$/, /^\/(guides|compare|about|legit|security)(\/|$)/];

export function deviceKind(ua: string): DeviceKind {
  if (/iPhone|iPod/.test(ua)) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\/|Twitter|GSA\//.test(ua);
    return !otherBrowser && /Safari\//.test(ua) ? "iphone-safari" : "iphone-other";
  }
  if (/Android/.test(ua) && /Mobile/.test(ua)) return "android-phone";
  return "other";
}

export function isStandalone(env: { displayModeStandalone: boolean; navigatorStandalone: boolean | undefined }): boolean {
  return env.displayModeStandalone || env.navigatorStandalone === true;
}

export const isPublicPath = (pathname: string) => PUBLIC.some((r) => r.test(pathname));

export function showIosInstallSheet(s: {
  kind: DeviceKind;
  standalone: boolean;
  loggedIn: boolean;
  pathname: string;
  lastShownAt: number | null;
  dismissedForever: boolean;
  now: number;
}): boolean {
  if (s.kind !== "iphone-safari" || s.standalone || !s.loggedIn || s.dismissedForever || isPublicPath(s.pathname)) return false;
  return s.lastShownAt === null || s.now - s.lastShownAt >= 7 * DAY;
}

export function showGetAppBar(s: {
  kind: DeviceKind;
  standalone: boolean;
  loggedIn: boolean;
  pathname: string;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (s.kind !== "android-phone" || s.standalone || !s.loggedIn || isPublicPath(s.pathname)) return false;
  return s.dismissedAt === null || s.now - s.dismissedAt >= 14 * DAY;
}

export function canOfferWebPush(s: { standalone: boolean; hasPushManager: boolean; hasNotification: boolean }): boolean {
  return s.standalone && s.hasPushManager && s.hasNotification;
}
```

Run → PASS.

- [ ] **Step 3: Service worker**

`apps/web/public/sw.js`:

```js
/* Push-only service worker. Deliberately has NO fetch handler and caches
 * nothing: balances and trades must never be served from a cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "IndianxTrade", body: event.data ? event.data.text() : "" };
  }
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/trade";
  event.waitUntil(
    self.registration.showNotification(data.title || "IndianxTrade", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/trade";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
```

`next.config.ts` — add (merge into any existing `headers()`):

```ts
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
```

- [ ] **Step 4: Registrar**

`apps/web/src/components/pwa/ServiceWorkerRegistrar.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { isStandalone } from "@/lib/install-rules";

/** Registers the push-only worker, and only inside the installed app. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const standalone = isStandalone({
      displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
      navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    });
    if (standalone) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
```

Mount `<ServiceWorkerRegistrar />` inside `PlatformShell`'s returned tree (both the focus-mode and normal branches).

- [ ] **Step 5: Run and commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/install-rules.test.ts && pnpm --filter @asm/web exec tsc --noEmit` → PASS. `curl -I localhost:3000/sw.js` shows `Cache-Control: no-cache`.

```bash
git add apps/web/src/lib/install-rules.ts apps/web/src/lib/install-rules.test.ts apps/web/public/sw.js apps/web/next.config.ts apps/web/src/components/pwa apps/web/src/components/shell/PlatformShell.tsx
git commit -m "feat(web): push-only service worker and install visibility rules"
```

---

### Task 3: iPhone install sheet and Android get-app bar

**Files:**
- Create: `apps/web/src/components/pwa/IosInstallSheet.tsx`, `GetAppBar.tsx`, `apps/web/src/lib/safe-storage.ts`, `safe-storage.test.ts`
- Modify: `apps/web/src/components/shell/PlatformShell.tsx`

**Interfaces:**
- Consumes: Task 2 rules; P1 `GET /api/v1/app/config`.
- Produces: `readNumber(key): number | null`, `writeNumber(key, value)`, `readFlag(key): boolean`, `writeFlag(key)` — every call wrapped in try/catch, returning null/false on failure.

- [ ] **Step 1: Failing test for safe storage**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFlag, readNumber, writeNumber } from "./safe-storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("safe storage", () => {
  it("returns null instead of throwing when storage is blocked", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(readNumber("k")).toBeNull();
    expect(() => writeNumber("k", 1)).not.toThrow();
    expect(readFlag("k")).toBe(false);
  });
  it("round-trips numbers", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
    writeNumber("k", 42);
    expect(readNumber("k")).toBe(42);
  });
});
```

- [ ] **Step 2: Implement `safe-storage.ts`**

```ts
/** localStorage that never throws (private mode, blocked site data, previews). */
export function readNumber(key: string): number | null {
  try {
    const v = globalThis.localStorage?.getItem(key);
    const n = v === null || v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeNumber(key: string, value: number): void {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    /* storage unavailable — the prompt may show again, which is harmless */
  }
}

export function readFlag(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string): void {
  try {
    globalThis.localStorage?.setItem(key, "1");
  } catch {
    /* ignore */
  }
}
```

Run → PASS.

- [ ] **Step 3: Components**

`IosInstallSheet.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { deviceKind, isStandalone, showIosInstallSheet } from "@/lib/install-rules";
import { readFlag, readNumber, writeFlag, writeNumber } from "@/lib/safe-storage";

const SHOWN = "ixt.pwa.sheetShownAt";
const NEVER = "ixt.pwa.sheetNever";

export function IosInstallSheet() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = showIosInstallSheet({
      kind: deviceKind(navigator.userAgent),
      standalone: isStandalone({
        displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      }),
      loggedIn: true, // mounted only inside the signed-in platform shell
      pathname,
      lastShownAt: readNumber(SHOWN),
      dismissedForever: readFlag(NEVER),
      now: Date.now(),
    });
    if (show) {
      writeNumber(SHOWN, Date.now());
      setOpen(true);
    }
  }, [pathname]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ios-install-title" className="sheet fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-panel p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl">
      <h2 id="ios-install-title" className="text-lg font-bold">Add IndianxTrade to your Home Screen</h2>
      <p className="mt-1 text-sm text-ink-2">Opens full-screen, like an app — and can send you trade and payment alerts.</p>
      <ol className="mt-4 space-y-3 text-sm">
        <li><strong>1.</strong> Tap the <span aria-label="Share">Share</span> button in Safari&apos;s toolbar.</li>
        <li><strong>2.</strong> Scroll and tap <strong>Add to Home Screen</strong>.</li>
        <li><strong>3.</strong> Tap <strong>Add</strong>, then open IndianxTrade from your Home Screen.</li>
      </ol>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" className="h-11 rounded-xl bg-tile font-semibold" onClick={() => { writeFlag(NEVER); setOpen(false); }}>Don&apos;t show again</button>
        <button type="button" className="h-11 rounded-xl bg-brand-fill font-semibold text-white" onClick={() => setOpen(false)}>Got it</button>
      </div>
    </div>
  );
}
```

Reuse the repo's existing `.sheet` pattern/classes and scroll-lock hook (`lib/use-scroll-lock.ts`, `lib/use-dismiss.ts`) the same way other sheets in `components/` do; match their markup rather than the bare classes above where they differ. Add step pictures (three small PNG/SVG illustrations in `public/pwa/`) next to each step.

`GetAppBar.tsx`:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { deviceKind, isStandalone, showGetAppBar } from "@/lib/install-rules";
import { readNumber, writeNumber } from "@/lib/safe-storage";

const DISMISSED = "ixt.app.barDismissedAt";

export function GetAppBar() {
  const pathname = usePathname();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const show = showGetAppBar({
      kind: deviceKind(navigator.userAgent),
      standalone: isStandalone({ displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches, navigatorStandalone: undefined }),
      loggedIn: true,
      pathname,
      dismissedAt: readNumber(DISMISSED),
      now: Date.now(),
    });
    if (!show) return setHref(null);
    void fetch("/api/v1/app/config")
      .then((r) => r.json() as Promise<{ playLive: boolean; playUrl: string | null; apkUrl: string }>)
      .then((cfg) => setHref(cfg.playLive && cfg.playUrl ? cfg.playUrl : cfg.apkUrl))
      .catch(() => setHref(null));
  }, [pathname]);

  if (!href) return null;
  return (
    <div className="flex items-center gap-3 border-t border-rule bg-panel px-3 py-2 text-sm">
      <span className="flex-1">Get the IndianxTrade app — faster trades, instant alerts</span>
      <a href={href} className="rounded-lg bg-brand-fill px-3 py-1.5 font-semibold text-white">Get app</a>
      <button type="button" aria-label="Dismiss" className="h-8 w-8 text-ink-2" onClick={() => { writeNumber(DISMISSED, Date.now()); setHref(null); }}>✕</button>
    </div>
  );
}
```

Mount in `PlatformShell`: `<IosInstallSheet />` at the end of the tree; `<GetAppBar />` directly above `<BottomNavBar />` — it must not break the phone grid (`grid-rows-[…var(--phone-nav-h,38px)]`): render it as `position: fixed` above the bottom nav (`bottom: var(--phone-nav-h)`) instead of a grid row. Check visually on a 390px viewport.

- [ ] **Step 4: Verify in the browser and commit**

Start the web app, open `/trade` in the built-in browser with an Android Chrome user agent at 390×844 (mobile preset) → bar visible above the nav; dismiss → gone after reload; `/guides` → never shown. Repeat with an iPhone Safari UA → install sheet once, not again on reload.

```bash
git add apps/web/src/lib/safe-storage.ts apps/web/src/lib/safe-storage.test.ts apps/web/src/components/pwa apps/web/src/components/shell/PlatformShell.tsx apps/web/public/pwa
git commit -m "feat(web): iPhone install sheet and Android get-app bar on signed-in pages"
```

---

### Task 4: Web push toggle in the installed app

**Files:**
- Create: `apps/web/src/lib/web-push-client.ts`, `web-push-client.test.ts`, `apps/web/src/components/pwa/PushToggle.tsx`
- Modify: `apps/web/src/components/account/AccountHub.tsx`

**Interfaces:**
- Consumes: P4 `GET /api/v1/push/vapid`, `POST/DELETE /api/v1/push/devices`; Task 2 `canOfferWebPush`.
- Produces: `urlBase64ToUint8Array(base64: string): Uint8Array`, `deviceBody(sub: PushSubscriptionJSON): { platform: "WEBPUSH"; token: string; p256dh: string; auth: string } | null` (pure).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { deviceBody, urlBase64ToUint8Array } from "./web-push-client";

describe("web push client helpers", () => {
  it("decodes a URL-safe base64 VAPID key", () => {
    expect([...urlBase64ToUint8Array("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
  it("turns a browser subscription into the devices route body", () => {
    expect(deviceBody({ endpoint: "https://push.example/x", keys: { p256dh: "pk", auth: "au" } })).toEqual({
      platform: "WEBPUSH",
      token: "https://push.example/x",
      p256dh: "pk",
      auth: "au",
    });
  });
  it("rejects a subscription without keys", () => {
    expect(deviceBody({ endpoint: "https://push.example/x" })).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function deviceBody(sub: { endpoint?: string; keys?: Record<string, string> }) {
  const p256dh = sub.keys?.["p256dh"];
  const auth = sub.keys?.["auth"];
  if (!sub.endpoint || !p256dh || !auth) return null;
  return { platform: "WEBPUSH" as const, token: sub.endpoint, p256dh, auth };
}
```

`PushToggle.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { canOfferWebPush, isStandalone } from "@/lib/install-rules";
import { deviceBody, urlBase64ToUint8Array } from "@/lib/web-push-client";

export function PushToggle() {
  const [offer, setOffer] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ok = canOfferWebPush({
      standalone: isStandalone({
        displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
        navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      }),
      hasPushManager: "PushManager" in window,
      hasNotification: "Notification" in window,
    });
    setOffer(ok);
    if (ok) void navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setOn(!!s));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== "granted") return;
      const { publicKey } = (await (await fetch("/api/v1/push/vapid")).json()) as { publicKey: string | null };
      if (!publicKey) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const body = deviceBody(sub.toJSON() as never);
      if (body) await fetch("/api/v1/push/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setOn(true);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await fetch("/api/v1/push/devices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setOn(false);
    } finally {
      setBusy(false);
    }
  }

  if (!offer) return null;
  return (
    <button type="button" disabled={busy} onClick={() => void (on ? disable() : enable())} className="flex h-12 w-full items-center justify-between rounded-xl bg-tile px-4 text-left">
      <span>{on ? "Notifications are on" : "Turn on notifications"}</span>
      <span className="text-sm text-ink-2">{on ? "Turn off" : "Allow"}</span>
    </button>
  );
}
```

Mount `<PushToggle />` in `AccountHub.tsx` as the first item of the settings list (it renders nothing outside the installed app).

- [ ] **Step 3: Run, manual check, commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/web-push-client.test.ts && pnpm --filter @asm/web exec tsc --noEmit` → PASS.
Manual (needs a real iPhone on iOS 16.4+ and the deployed staging/production site with VAPID env + P4 engine): Safari → Add to Home Screen → open → Account → Turn on notifications → allow → trigger a deposit credit from admin → notification arrives → tap opens `/history?tx=d:<id>`.

```bash
git add apps/web/src/lib/web-push-client.ts apps/web/src/lib/web-push-client.test.ts apps/web/src/components/pwa/PushToggle.tsx apps/web/src/components/account/AccountHub.tsx
git commit -m "feat(web): web push opt-in inside the installed iPhone app"
```

---

### Task 5: APK download routes and VPS mounts

**Files:**
- Create: `apps/web/src/lib/release-files.ts`, `release-files.test.ts`
- Create: `apps/web/src/app/download/app/route.ts`, `apps/web/src/app/download/app/[version]/route.ts`, `apps/web/src/app/download/app/[version]/route.test.ts`
- Modify: `deploy/docker-compose.yml`, `deploy/DEPLOY.md`

**Interfaces:**
- Produces:
  - `RELEASES_DIR = process.env.APP_RELEASES_DIR ?? "/app/releases"`
  - `apkPath(version: string, dir?: string): string | null` (null when the version is malformed)
  - `GET /download/app` → 307 `Location: /download/app/<APP_LATEST_VERSION>` (404 page when unset)
  - `GET /download/app/<version>` → APK stream (`application/vnd.android.package-archive`, `Content-Disposition: attachment; filename="indianxtrade-<v>.apk"`, `X-Checksum-Sha256` from the `.sha256` file), 404 otherwise.

- [ ] **Step 1: Failing tests**

`release-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { apkPath } from "./release-files";

describe("apkPath", () => {
  it("maps a semver to the release file", () => {
    expect(apkPath("1.2.3", "/app/releases")).toBe("/app/releases/indianxtrade-1.2.3.apk");
  });
  it("refuses anything that could escape the folder", () => {
    for (const v of ["../etc/passwd", "1.2", "1.2.3/../../x", "latest"]) expect(apkPath(v, "/app/releases")).toBeNull();
  });
});
```

`download/app/[version]/route.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir = "";
const saved = process.env["APP_RELEASES_DIR"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "apk-"));
  writeFileSync(join(dir, "indianxtrade-1.0.0.apk"), "APKDATA");
  writeFileSync(join(dir, "indianxtrade-1.0.0.apk.sha256"), "abc123  indianxtrade-1.0.0.apk\n");
  process.env["APP_RELEASES_DIR"] = dir;
});
afterEach(() => {
  if (saved === undefined) delete process.env["APP_RELEASES_DIR"];
  else process.env["APP_RELEASES_DIR"] = saved;
});

describe("GET /download/app/:version", () => {
  it("streams the APK as a download with its checksum", async () => {
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/download/app/1.0.0"), { params: Promise.resolve({ version: "1.0.0" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(res.headers.get("content-disposition")).toContain("indianxtrade-1.0.0.apk");
    expect(res.headers.get("x-checksum-sha256")).toBe("abc123");
    expect(await res.text()).toBe("APKDATA");
  });
  it("404s an unknown or malformed version", async () => {
    const { GET } = await import("./route");
    expect((await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ version: "9.9.9" }) })).status).toBe(404);
    expect((await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ version: "../x" }) })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Implement**

`release-files.ts`:

```ts
import { join } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+$/;

export const releasesDir = () => process.env["APP_RELEASES_DIR"] ?? "/app/releases";

export function apkPath(version: string, dir: string = releasesDir()): string | null {
  return SEMVER.test(version) ? join(dir, `indianxtrade-${version}.apk`) : null;
}
```

`download/app/[version]/route.ts`:

```ts
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { apkPath } from "@/lib/release-files";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const path = apkPath(version);
  if (!path) return new Response("Not found", { status: 404 });
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const checksum = (await readFile(`${path}.sha256`, "utf8").catch(() => "")).split(/\s+/)[0] ?? "";
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="indianxtrade-${version}.apk"`,
      "Cache-Control": "public, max-age=3600",
      ...(checksum ? { "X-Checksum-Sha256": checksum } : {}),
    },
  });
}
```

`download/app/route.ts` (bare-path Location, same reason as `download/relay`):

```ts
const SEMVER = /^\d+\.\d+\.\d+$/;

export function GET(): Response {
  const v = process.env["APP_LATEST_VERSION"]?.trim() ?? "";
  if (!SEMVER.test(v)) return new Response("The app download isn't available yet.", { status: 404 });
  return new Response(null, { status: 307, headers: { Location: `/download/app/${v}` } });
}
```

- [ ] **Step 3: Mounts**

In `deploy/docker-compose.yml`, `web` service:

```yaml
    volumes:
      - /srv/app/releases:/app/releases:ro
      - /srv/app/updates:/app/updates:ro
```

In `deploy/DEPLOY.md` add a "Mobile app files" section: one-time `sudo mkdir -p /srv/app/releases /srv/app/updates && sudo chown <deploy-user> /srv/app -R`; after changing compose, `docker compose --env-file ../.env.production up -d --force-recreate web` (env/volume changes need force-recreate — see the project's deploy notes).

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/release-files.test.ts src/app/download` → PASS.

```bash
git add apps/web/src/lib/release-files.ts apps/web/src/lib/release-files.test.ts apps/web/src/app/download/app deploy/docker-compose.yml deploy/DEPLOY.md
git commit -m "feat(web): APK download routes served from the VPS releases folder"
```

---

### Task 6: OTA update server (expo-updates protocol v1)

**Files:**
- Create: `apps/web/src/lib/expo-updates.ts`, `expo-updates.test.ts`
- Create: `apps/web/src/app/api/v1/app/updates/route.ts`, `apps/web/src/app/api/v1/app/updates/assets/route.ts`
- Modify: `apps/web/src/lib/app-gate.ts` (keep `/api/v1/app/updates*` open for outdated apps)

**Interfaces:**
- Produces:
  - `updatesDir = () => process.env.APP_UPDATES_DIR ?? "/app/updates"`
  - `latestUpdateDir(runtimeVersion: string, root?: string): Promise<string | null>` — newest subfolder by `metadata.json` `createdAt`; rejects runtime versions not matching `^\d+\.\d+\.\d+$`
  - `buildManifest(dir: string, opts: { runtimeVersion: string; platform: "android"; assetUrl: (relPath: string) => string }): Promise<ExpoManifest>`
  - `signManifest(body: string, privateKeyPem: string): string` → `sig="<base64>", keyid="main"`
  - `multipartBody(parts: { name: string; contentType: string; body: string; headers?: Record<string, string> }[], boundary: string): string`
  - `safeAssetPath(root: string, rel: string): string | null`

- [ ] **Step 1: Failing tests**

```ts
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, latestUpdateDir, multipartBody, safeAssetPath, signManifest } from "./expo-updates";

function fakeExport(root: string, runtime: string, id: string, createdAt: string) {
  const dir = join(root, runtime, id);
  mkdirSync(join(dir, "_expo/static/js/android"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "_expo/static/js/android/index-abc.hbc"), "BUNDLE");
  writeFileSync(join(dir, "assets/f00d"), "PNG");
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      version: 0,
      bundler: "metro",
      createdAt,
      fileMetadata: { android: { bundle: "_expo/static/js/android/index-abc.hbc", assets: [{ path: "assets/f00d", ext: "png" }] } },
    }),
  );
  writeFileSync(join(dir, "expoConfig.json"), JSON.stringify({ name: "IndianxTrade", slug: "indianxtrade" }));
  return dir;
}

describe("expo updates", () => {
  it("picks the newest update for a runtime version", async () => {
    const root = mkdtempSync(join(tmpdir(), "ota-"));
    fakeExport(root, "1.0.0", "a", "2026-10-20T10:00:00.000Z");
    const newer = fakeExport(root, "1.0.0", "b", "2026-10-21T10:00:00.000Z");
    expect(await latestUpdateDir("1.0.0", root)).toBe(newer);
    expect(await latestUpdateDir("2.0.0", root)).toBeNull();
    expect(await latestUpdateDir("../1.0.0", root)).toBeNull();
  });

  it("builds a manifest with hashed launch asset and assets", async () => {
    const root = mkdtempSync(join(tmpdir(), "ota-"));
    const dir = fakeExport(root, "1.0.0", "a", "2026-10-20T10:00:00.000Z");
    const m = await buildManifest(dir, { runtimeVersion: "1.0.0", platform: "android", assetUrl: (p) => `https://x/assets?path=${p}` });
    expect(m.runtimeVersion).toBe("1.0.0");
    expect(m.launchAsset.url).toBe("https://x/assets?path=1.0.0/a/_expo/static/js/android/index-abc.hbc");
    expect(m.launchAsset.hash).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(m.assets[0]).toMatchObject({ fileExtension: ".png", contentType: "image/png" });
    expect(m.extra.expoClient).toMatchObject({ slug: "indianxtrade" });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("signs manifests so the app can verify them with our certificate", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = signManifest("{\"a\":1}", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const sig = /sig="([^"]+)"/.exec(header)![1]!;
    const v = createVerify("RSA-SHA256");
    v.update("{\"a\":1}");
    expect(v.verify(publicKey, sig, "base64")).toBe(true);
    expect(header).toContain('keyid="main"');
  });

  it("writes multipart/mixed parts with headers", () => {
    const body = multipartBody([{ name: "manifest", contentType: "application/json", body: "{}", headers: { "expo-signature": "s" } }], "BOUND");
    expect(body).toContain("--BOUND\r\n");
    expect(body).toContain('content-disposition: form-data; name="manifest"');
    expect(body).toContain("expo-signature: s");
    expect(body.trimEnd().endsWith("--BOUND--")).toBe(true);
  });

  it("keeps asset reads inside the updates folder", () => {
    expect(safeAssetPath("/app/updates", "1.0.0/a/assets/f00d")).toBe("/app/updates/1.0.0/a/assets/f00d");
    expect(safeAssetPath("/app/updates", "../../etc/passwd")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `expo-updates.ts`**

```ts
import { createHash, createSign } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const SEMVER = /^\d+\.\d+\.\d+$/;
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  ttf: "font/ttf", otf: "font/otf", json: "application/json", svg: "image/svg+xml",
};

export const updatesDir = () => process.env["APP_UPDATES_DIR"] ?? "/app/updates";

interface Metadata {
  createdAt?: string;
  fileMetadata: { android: { bundle: string; assets: { path: string; ext: string }[] } };
}

export interface ExpoAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension?: string;
  url: string;
}

export interface ExpoManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ExpoAsset;
  assets: ExpoAsset[];
  metadata: Record<string, string>;
  extra: { expoClient: Record<string, unknown> };
}

async function readMeta(dir: string): Promise<Metadata | null> {
  try {
    return JSON.parse(await readFile(join(dir, "metadata.json"), "utf8")) as Metadata;
  } catch {
    return null;
  }
}

export async function latestUpdateDir(runtimeVersion: string, root: string = updatesDir()): Promise<string | null> {
  if (!SEMVER.test(runtimeVersion)) return null;
  const base = join(root, runtimeVersion);
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return null;
  }
  let best: { dir: string; at: number } | null = null;
  for (const name of entries) {
    const dir = join(base, name);
    const meta = await readMeta(dir);
    const at = meta?.createdAt ? Date.parse(meta.createdAt) : NaN;
    if (Number.isFinite(at) && (!best || at > best.at)) best = { dir, at };
  }
  return best?.dir ?? null;
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function asset(root: string, dir: string, rel: string, ext: string | null, assetUrl: (p: string) => string, launch: boolean): Promise<ExpoAsset> {
  const data = await readFile(join(dir, rel));
  return {
    hash: b64url(createHash("sha256").update(data).digest()),
    key: createHash("md5").update(data).digest("hex"),
    contentType: launch ? "application/javascript" : (MIME[ext ?? ""] ?? "application/octet-stream"),
    ...(ext && !launch ? { fileExtension: `.${ext}` } : {}),
    url: assetUrl(relative(root, join(dir, rel)).split(sep).join("/")),
  };
}

/** Deterministic UUID-shaped id from the update's bundle hash. */
function idFrom(hash: string): string {
  const h = createHash("sha256").update(hash).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function buildManifest(
  dir: string,
  opts: { runtimeVersion: string; platform: "android"; assetUrl: (relPath: string) => string; root?: string },
): Promise<ExpoManifest> {
  const root = opts.root ?? resolve(dir, "..", "..");
  const meta = (await readMeta(dir))!;
  const pm = meta.fileMetadata[opts.platform];
  const launchAsset = await asset(root, dir, pm.bundle, null, opts.assetUrl, true);
  const assets = await Promise.all(pm.assets.map((a) => asset(root, dir, a.path, a.ext, opts.assetUrl, false)));
  const expoClient = JSON.parse(await readFile(join(dir, "expoConfig.json"), "utf8")) as Record<string, unknown>;
  return {
    id: idFrom(launchAsset.hash),
    createdAt: meta.createdAt ?? new Date(0).toISOString(),
    runtimeVersion: opts.runtimeVersion,
    launchAsset,
    assets,
    metadata: {},
    extra: { expoClient },
  };
}

export function signManifest(body: string, privateKeyPem: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(body);
  return `sig="${signer.sign(privateKeyPem, "base64")}", keyid="main"`;
}

export function multipartBody(
  parts: { name: string; contentType: string; body: string; headers?: Record<string, string> }[],
  boundary: string,
): string {
  const chunks = parts.map((p) => {
    const extra = Object.entries(p.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("");
    return `--${boundary}\r\ncontent-type: ${p.contentType}\r\ncontent-disposition: form-data; name="${p.name}"\r\n${extra}\r\n${p.body}\r\n`;
  });
  return `${chunks.join("")}--${boundary}--\r\n`;
}

export function safeAssetPath(root: string, rel: string): string | null {
  const full = resolve(root, rel);
  return full.startsWith(resolve(root) + sep) ? full : null;
}
```

Run → PASS. (`idFrom` makes the update id stable for the same bundle so a re-published identical update is not "new".)

- [ ] **Step 3: Routes**

`apps/web/src/app/api/v1/app/updates/route.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { buildManifest, latestUpdateDir, multipartBody, signManifest } from "@/lib/expo-updates";

export async function GET(req: NextRequest) {
  const h = req.headers;
  if (h.get("expo-protocol-version") !== "1" || h.get("expo-platform") !== "android") {
    return new Response("Unsupported update request.", { status: 400 });
  }
  const runtimeVersion = h.get("expo-runtime-version") ?? "";
  const dir = await latestUpdateDir(runtimeVersion);
  const boundary = `ixt-${randomUUID()}`;
  const wantsSig = h.get("expo-expect-signature") !== null;
  const key = process.env["EXPO_UPDATES_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
  if (wantsSig && !key) return new Response("Code signing is not configured.", { status: 500 });

  let part: { name: string; body: string };
  if (!dir) {
    part = { name: "directive", body: JSON.stringify({ type: "noUpdateAvailable" }) };
  } else {
    const origin = req.nextUrl.origin;
    const manifest = await buildManifest(dir, {
      runtimeVersion,
      platform: "android",
      assetUrl: (p) => `${origin}/api/v1/app/updates/assets?path=${encodeURIComponent(p)}`,
    });
    part = { name: "manifest", body: JSON.stringify(manifest) };
  }
  const body = multipartBody(
    [{ ...part, contentType: "application/json; charset=utf-8", headers: wantsSig && key ? { "expo-signature": signManifest(part.body, key) } : {} }],
    boundary,
  );
  return new Response(body, {
    headers: {
      "Content-Type": `multipart/mixed; boundary=${boundary}`,
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
      "Cache-Control": "private, max-age=0",
    },
  });
}
```

Behind a proxy `req.nextUrl.origin` can be the internal origin (see the note in `download/relay/route.ts`); use `SITE_URL` from `@/lib/site` instead of `req.nextUrl.origin` for asset URLs.

`apps/web/src/app/api/v1/app/updates/assets/route.ts`:

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { safeAssetPath, updatesDir } from "@/lib/expo-updates";

const TYPES: Record<string, string> = { ".hbc": "application/javascript", ".js": "application/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".ttf": "font/ttf", ".json": "application/json" };

export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  const full = safeAssetPath(updatesDir(), rel);
  if (!full) return new Response("Not found", { status: 404 });
  try {
    const s = await stat(full);
    if (!s.isFile()) return new Response("Not found", { status: 404 });
    return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
      headers: {
        "Content-Type": TYPES[extname(full)] ?? "application/octet-stream",
        "Content-Length": String(s.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
```

In `apps/web/src/lib/app-gate.ts`, add `/api/v1/app/updates` and `/api/v1/app/updates/assets` to `ALWAYS_OPEN` (an outdated app must still be able to receive an OTA fix), with a test case in `app-gate.test.ts`.

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @asm/web exec vitest run src/lib/expo-updates.test.ts src/lib/app-gate.test.ts && pnpm --filter @asm/web exec tsc --noEmit` → PASS.

```bash
git add apps/web/src/lib/expo-updates.ts apps/web/src/lib/expo-updates.test.ts apps/web/src/app/api/v1/app/updates apps/web/src/lib/app-gate.ts apps/web/src/lib/app-gate.test.ts
git commit -m "feat(web): self-hosted signed expo-updates endpoint"
```

---

### Task 7: App side — OTA client and direct-build update prompt

**Files:**
- Modify: `apps/mobile/app.config.ts`, `apps/mobile/package.json`
- Create: `apps/mobile/certs/certificate.pem`, `apps/mobile/src/update/update-check.ts`, `update-check.test.ts`, `apps/mobile/src/update/useUpdates.ts`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Produces: `updatePrompt(s: { variant: "play" | "direct"; current: string; latest: string; dismissedVersion: string | null }): "none" | "prompt"` (pure).

- [ ] **Step 1: Create the signing keypair (owner, once)**

```bash
mkdir -p ~/.indianxtrade/keys && cd ~/.indianxtrade/keys
openssl genrsa -out expo-updates-private.pem 2048
openssl req -new -x509 -key expo-updates-private.pem -out certificate.pem -days 3650 -subj "/CN=IndianxTrade Updates"
cp certificate.pem <repo>/apps/mobile/certs/certificate.pem
```
Put the private key (newlines as `\n`) in the VPS env as `EXPO_UPDATES_PRIVATE_KEY`; back up both files offline. Only `certificate.pem` is committed.

- [ ] **Step 2: Configure expo-updates**

`pnpm exec expo install expo-updates`. In `app.config.ts` add:

```ts
  runtimeVersion: { policy: "appVersion" },
  updates: {
    url: `${process.env.APP_API_URL ?? "https://indianxtrade.com"}/api/v1/app/updates`,
    enabled: true,
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
    codeSigningCertificate: "./certs/certificate.pem",
    codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
  },
```

`ON_LOAD` + `fallbackToCacheTimeout: 0`: the app starts on the cached bundle immediately and applies a downloaded update on the next launch — no slower cold starts.

- [ ] **Step 3: Failing test for the direct-build prompt**

```ts
import { describe, expect, it } from "vitest";
import { updatePrompt } from "./update-check";

describe("updatePrompt", () => {
  it("prompts direct-APK users when a newer version is out", () => {
    expect(updatePrompt({ variant: "direct", current: "1.0.0", latest: "1.1.0", dismissedVersion: null })).toBe("prompt");
  });
  it("leaves Play users to the Play Store", () => {
    expect(updatePrompt({ variant: "play", current: "1.0.0", latest: "1.1.0", dismissedVersion: null })).toBe("none");
  });
  it("does not nag again for a version the user dismissed", () => {
    expect(updatePrompt({ variant: "direct", current: "1.0.0", latest: "1.1.0", dismissedVersion: "1.1.0" })).toBe("none");
  });
  it("is quiet when up to date", () => {
    expect(updatePrompt({ variant: "direct", current: "1.1.0", latest: "1.1.0", dismissedVersion: null })).toBe("none");
  });
});
```

- [ ] **Step 4: Implement**

```ts
// update-check.ts
import { compareVersions } from "@/version";

export function updatePrompt(s: { variant: "play" | "direct"; current: string; latest: string; dismissedVersion: string | null }): "none" | "prompt" {
  if (s.variant !== "direct") return "none";
  if (compareVersions(s.current, s.latest) >= 0) return "none";
  return s.dismissedVersion === s.latest ? "none" : "prompt";
}
```

(`@/version` is the `compareVersions` copy from P2 Task 7; if P2 imported it from `@asm/client-core`, import from there.)

`useUpdates.ts`:

```ts
import * as Linking from "expo-linking";
import { useEffect } from "react";
import { Alert } from "react-native";
import { MMKV } from "react-native-mmkv";
import { useTranslation } from "react-i18next";
import { useAppConfig } from "@/api/queries";
import { appConfig } from "@/config";
import { updatePrompt } from "./update-check";

const store = new MMKV({ id: "ixt-update" });

export function useUpdatePrompt(enabled: boolean) {
  const { t } = useTranslation();
  const cfg = useAppConfig().data;
  useEffect(() => {
    if (!enabled || !cfg) return;
    const { variant, version, apiUrl } = appConfig();
    if (updatePrompt({ variant, current: version, latest: cfg.latestVersion, dismissedVersion: store.getString("dismissed") ?? null }) !== "prompt") return;
    Alert.alert(t("update.title"), t("update.body", { version: cfg.latestVersion }), [
      { text: t("update.later"), style: "cancel", onPress: () => store.set("dismissed", cfg.latestVersion) },
      { text: t("update.now"), onPress: () => void Linking.openURL(`${apiUrl}${cfg.apkUrl}`) },
    ]);
  }, [enabled, cfg, t]);
}
```

Call `useUpdatePrompt(target === null)` in the Gatekeeper. Add i18n keys `update.{title, body, later, now}` to both languages.

- [ ] **Step 5: Verify OTA end to end (manual) and commit**

1. Build and install a `direct` release APK (version 0.1.0) pointing `APP_API_URL` at a test deployment that has `EXPO_UPDATES_PRIVATE_KEY` and the `/srv/app/updates` mount.
2. Change a visible string, run the OTA publish from Task 8/9 (`scripts/app-release.sh ota 0.1.0`).
3. Kill and reopen the app twice → the new string shows.
4. Delete that update folder on the VPS → after two relaunches the old string is back (rollback works).

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck` → PASS.

```bash
git add apps/mobile
git commit -m "feat(mobile): signed OTA updates and direct-build update prompt"
```

---

### Task 8: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/mobile-release.yml`

**Interfaces:**
- Secrets used: `PLAY_UPLOAD_KEYSTORE_B64`, `PLAY_UPLOAD_KEYSTORE_PASSWORD`, `PLAY_UPLOAD_KEY_ALIAS`, `PLAY_UPLOAD_KEY_PASSWORD`, `DIRECT_KEYSTORE_B64`, `DIRECT_KEYSTORE_PASSWORD`, `DIRECT_KEY_ALIAS`, `DIRECT_KEY_PASSWORD`, `GOOGLE_SERVICES_PLAY_B64`, `GOOGLE_SERVICES_DIRECT_B64`, `APP_GOOGLE_WEB_CLIENT_ID`, and the existing `VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`.

- [ ] **Step 1: Signing config injection**

Expo prebuild regenerates `android/`, so signing is injected after prebuild by a small script. Create `apps/mobile/scripts/apply-signing.sh`:

```bash
#!/usr/bin/env bash
# Usage: apply-signing.sh <keystore-path> <store-pass> <alias> <key-pass>
# Appends a release signingConfig to the prebuilt android/app/build.gradle.
set -euo pipefail
gradle=android/app/build.gradle
cat >> "$gradle" <<EOF

android {
  signingConfigs {
    ixtRelease {
      storeFile file("$1")
      storePassword "$2"
      keyAlias "$3"
      keyPassword "$4"
    }
  }
  buildTypes { release { signingConfig signingConfigs.ixtRelease } }
}
EOF
```

`chmod +x` it. (Gradle merges a second `android {}` block; verify once locally that `./gradlew assembleRelease` produces an APK signed with the given key: `apksigner verify --print-certs app-release.apk`.)

- [ ] **Step 2: Workflow**

`.github/workflows/mobile-release.yml`:

```yaml
name: mobile release

on:
  push:
    tags:
      - "app-v*.*.*"
      - "app-ota-v*.*.*"

permissions:
  contents: write

jobs:
  build:
    if: startsWith(github.ref_name, 'app-v')
    runs-on: ubuntu-latest
    timeout-minutes: 60
    defaults:
      run:
        working-directory: apps/mobile
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "17" }
      - uses: android-actions/setup-android@v3
      - run: sdkmanager "platforms;android-36" "build-tools;36.0.0"

      - name: Install
        working-directory: .
        run: pnpm install --frozen-lockfile --filter @asm/mobile...

      - name: Version matches tag
        run: |
          tag="${GITHUB_REF_NAME#app-v}"
          pkg=$(node -p "require('./package.json').version")
          test "$tag" = "$pkg" || { echo "tag $tag != package.json $pkg"; exit 1; }

      - name: Test and typecheck
        run: pnpm test && pnpm typecheck

      - name: Write secrets
        run: |
          mkdir -p "$RUNNER_TEMP/keys"
          echo "${{ secrets.PLAY_UPLOAD_KEYSTORE_B64 }}" | base64 -d > "$RUNNER_TEMP/keys/play.p12"
          echo "${{ secrets.DIRECT_KEYSTORE_B64 }}" | base64 -d > "$RUNNER_TEMP/keys/direct.p12"
          echo "${{ secrets.GOOGLE_SERVICES_PLAY_B64 }}" | base64 -d > "$RUNNER_TEMP/keys/gs-play.json"
          echo "${{ secrets.GOOGLE_SERVICES_DIRECT_B64 }}" | base64 -d > "$RUNNER_TEMP/keys/gs-direct.json"

      - name: Build Play bundle
        env:
          APP_VARIANT: play
          GOOGLE_SERVICES_JSON: ${{ runner.temp }}/keys/gs-play.json
          APP_GOOGLE_WEB_CLIENT_ID: ${{ secrets.APP_GOOGLE_WEB_CLIENT_ID }}
        run: |
          pnpm exec expo prebuild --platform android --clean
          ./scripts/apply-signing.sh "$RUNNER_TEMP/keys/play.p12" "${{ secrets.PLAY_UPLOAD_KEYSTORE_PASSWORD }}" "${{ secrets.PLAY_UPLOAD_KEY_ALIAS }}" "${{ secrets.PLAY_UPLOAD_KEY_PASSWORD }}"
          (cd android && ./gradlew bundleRelease --no-daemon)
          mkdir -p "$RUNNER_TEMP/out"
          cp android/app/build/outputs/bundle/release/app-release.aab "$RUNNER_TEMP/out/indianxtrade-${GITHUB_REF_NAME#app-v}-play.aab"

      - name: Build direct APK
        env:
          APP_VARIANT: direct
          GOOGLE_SERVICES_JSON: ${{ runner.temp }}/keys/gs-direct.json
          APP_GOOGLE_WEB_CLIENT_ID: ${{ secrets.APP_GOOGLE_WEB_CLIENT_ID }}
        run: |
          v="${GITHUB_REF_NAME#app-v}"
          pnpm exec expo prebuild --platform android --clean
          ./scripts/apply-signing.sh "$RUNNER_TEMP/keys/direct.p12" "${{ secrets.DIRECT_KEYSTORE_PASSWORD }}" "${{ secrets.DIRECT_KEY_ALIAS }}" "${{ secrets.DIRECT_KEY_PASSWORD }}"
          (cd android && ./gradlew assembleRelease --no-daemon)
          cp android/app/build/outputs/apk/release/app-release.apk "$RUNNER_TEMP/out/indianxtrade-$v.apk"
          (cd "$RUNNER_TEMP/out" && sha256sum "indianxtrade-$v.apk" > "indianxtrade-$v.apk.sha256")

      - name: Upload APK to VPS
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.VPS_SSH_KEY }}" > ~/.ssh/deploy_key && chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H "${{ secrets.VPS_HOST }}" >> ~/.ssh/known_hosts
          rsync -av -e "ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes" \
            "$RUNNER_TEMP"/out/*.apk "$RUNNER_TEMP"/out/*.sha256 \
            ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:/srv/app/releases/

      - name: GitHub release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            ${{ runner.temp }}/out/*.aab
            ${{ runner.temp }}/out/*.apk
            ${{ runner.temp }}/out/*.sha256

      - name: Remove secrets
        if: always()
        run: rm -rf "$RUNNER_TEMP/keys" ~/.ssh/deploy_key

  ota:
    if: startsWith(github.ref_name, 'app-ota-v')
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        working-directory: apps/mobile
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10.33.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - name: Install
        working-directory: .
        run: pnpm install --frozen-lockfile --filter @asm/mobile...
      - name: Test and typecheck
        run: pnpm test && pnpm typecheck
      - name: Export update
        env:
          APP_VARIANT: direct
        run: |
          runtime=$(node -p "require('./package.json').version")
          id="$(date -u +%Y%m%d%H%M%S)-${GITHUB_SHA::7}"
          pnpm exec expo export --platform android --output-dir "$RUNNER_TEMP/ota/$runtime/$id"
          pnpm exec expo config --json --type public > "$RUNNER_TEMP/ota/$runtime/$id/expoConfig.json"
          node -e "const f=process.argv[1];const m=require(f);m.createdAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(m))" "$RUNNER_TEMP/ota/$runtime/$id/metadata.json"
      - name: Upload update to VPS
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.VPS_SSH_KEY }}" > ~/.ssh/deploy_key && chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H "${{ secrets.VPS_HOST }}" >> ~/.ssh/known_hosts
          rsync -av -e "ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes" "$RUNNER_TEMP/ota/" ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:/srv/app/updates/
      - name: Remove secrets
        if: always()
        run: rm -f ~/.ssh/deploy_key
```

Notes for the implementer:
- One OTA export serves both variants: the bundle is the same JS; the variant only changes native config (package id). `runtimeVersion` = app version, so an OTA only reaches installs of that exact version. If a variant-specific `extra` value is ever read at runtime, export twice into separate runtime folders instead.
- `expo export` output layout must match what Task 6 reads (`metadata.json`, `_expo/static/js/android/*.hbc`, `assets/*`). Confirm on the first run and adjust Task 6's reader if the SDK lays it out differently.

- [ ] **Step 3: Dry run and commit**

Push a tag on a test branch with test keystores in a fork (or temporarily point `VPS_*` at a scratch host): `git tag app-v0.1.0 && git push origin app-v0.1.0`. Expected: AAB + APK attached to the release; APK + checksum in `/srv/app/releases/`; `curl -I https://<host>/download/app/0.1.0` → 200 after `APP_LATEST_VERSION=0.1.0`.

```bash
git add .github/workflows/mobile-release.yml apps/mobile/scripts/apply-signing.sh
git commit -m "ci(mobile): tag-triggered Android builds and OTA publishing"
```

---

### Task 9: Mac fallback script and release runbook

**Files:**
- Create: `scripts/app-release.sh`, `docs/mobile-release.md`

- [ ] **Step 1: Script**

`scripts/app-release.sh`:

```bash
#!/usr/bin/env bash
# Local fallback for .github/workflows/mobile-release.yml.
# Usage:
#   scripts/app-release.sh build <version>   # Play AAB + direct APK, upload APK
#   scripts/app-release.sh ota <version>     # publish an OTA update for <version>
# Needs: JDK 17, Android SDK 36, pnpm, keys in ~/.indianxtrade/keys/, and
# VPS_HOST / VPS_USER / VPS_SSH_KEY_FILE in the environment.
set -euo pipefail

mode="${1:?build|ota}"
version="${2:?version}"
keys="$HOME/.indianxtrade/keys"
root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/apps/mobile"
out="$(mktemp -d)"

pkg=$(node -p "require('$app/package.json').version")
[[ "$pkg" == "$version" ]] || { echo "apps/mobile/package.json is $pkg, not $version"; exit 1; }

: "${VPS_HOST:?}" "${VPS_USER:?}" "${VPS_SSH_KEY_FILE:?}"
ssh_opts=(-e "ssh -i $VPS_SSH_KEY_FILE -o IdentitiesOnly=yes")

cd "$root" && pnpm install --frozen-lockfile --filter @asm/mobile...
cd "$app" && pnpm test && pnpm typecheck

if [[ "$mode" == "build" ]]; then
  : "${PLAY_STORE_PASSWORD:?}" "${PLAY_KEY_PASSWORD:?}" "${DIRECT_STORE_PASSWORD:?}" "${DIRECT_KEY_PASSWORD:?}"
  APP_VARIANT=play GOOGLE_SERVICES_JSON="$keys/gs-play.json" pnpm exec expo prebuild --platform android --clean
  ./scripts/apply-signing.sh "$keys/play-upload.p12" "$PLAY_STORE_PASSWORD" upload "$PLAY_KEY_PASSWORD"
  (cd android && ./gradlew bundleRelease)
  cp android/app/build/outputs/bundle/release/app-release.aab "$out/indianxtrade-$version-play.aab"

  APP_VARIANT=direct GOOGLE_SERVICES_JSON="$keys/gs-direct.json" pnpm exec expo prebuild --platform android --clean
  ./scripts/apply-signing.sh "$keys/direct.p12" "$DIRECT_STORE_PASSWORD" direct "$DIRECT_KEY_PASSWORD"
  (cd android && ./gradlew assembleRelease)
  cp android/app/build/outputs/apk/release/app-release.apk "$out/indianxtrade-$version.apk"
  (cd "$out" && shasum -a 256 "indianxtrade-$version.apk" > "indianxtrade-$version.apk.sha256")

  rsync -av "${ssh_opts[@]}" "$out"/*.apk "$out"/*.sha256 "$VPS_USER@$VPS_HOST:/srv/app/releases/"
  echo "Play bundle: $out/indianxtrade-$version-play.aab (upload it in Play Console)"
elif [[ "$mode" == "ota" ]]; then
  id="$(date -u +%Y%m%d%H%M%S)-$(git -C "$root" rev-parse --short HEAD)"
  dest="$out/$version/$id"
  APP_VARIANT=direct pnpm exec expo export --platform android --output-dir "$dest"
  pnpm exec expo config --json --type public > "$dest/expoConfig.json"
  node -e "const f=process.argv[1];const m=require(f);m.createdAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(m))" "$dest/metadata.json"
  rsync -av "${ssh_opts[@]}" "$out/" "$VPS_USER@$VPS_HOST:/srv/app/updates/"
  echo "Published OTA $id for runtime $version"
else
  echo "unknown mode $mode"; exit 1
fi
```

`chmod +x scripts/app-release.sh`. Run `bash -n scripts/app-release.sh` (syntax check) and `shellcheck scripts/app-release.sh` if available.

- [ ] **Step 2: Runbook**

`docs/mobile-release.md` with these sections (write each out fully):

1. **Toolchain** — JDK 17, Android SDK platform 36 + build-tools 36.0.0, pnpm 10.33.0, Node 22; how to install on macOS (`brew install --cask temurin@17 android-commandlinetools`, `sdkmanager …`).
2. **Keys and secrets** — table of every key/secret (Play upload keystore, direct keystore, OTA private key + certificate, Firebase service account, two `google-services.json`, VAPID keypair), where each lives (GitHub secret name / VPS env name / `~/.indianxtrade/keys/`), and the offline backup rule. What happens if each is lost (direct keystore lost → every APK user must uninstall/reinstall; Play upload key lost → Play Console key reset request; OTA key lost → rotate certificate, needs a full build).
3. **Full release** — bump `version` in `apps/mobile/package.json` and `app.config.ts` (+ `android.versionCode` + 1), commit, tag `app-v<version>`, watch the workflow, upload the AAB in Play Console (internal → closed → production), install the APK from `/download/app/<version>` on a test phone, then set `APP_LATEST_VERSION=<version>` in `.env.production` and `docker compose … up -d --force-recreate web`.
4. **Forcing an update** — set `APP_MIN_VERSION`, force-recreate `web`; old apps show "Update required" on their next API call.
5. **OTA update** — JS/asset-only changes; tag `app-ota-v<version>` where `<version>` is the installed app version; verify on a phone (two relaunches).
6. **Rollback** — OTA: `ssh` and delete `/srv/app/updates/<version>/<id>`; APK: set `APP_LATEST_VERSION` back.
7. **Play status** — record each Play review outcome with date; while Play is not live keep `APP_PLAY_LIVE` empty so the website points to the APK.
8. **Mac fallback** — env vars for `scripts/app-release.sh` and an example run.

- [ ] **Step 3: Commit**

```bash
git add scripts/app-release.sh docs/mobile-release.md
git commit -m "docs(mobile): release runbook and local release script"
```

---

## Self-Review Notes

- Spec coverage: A (manifest, metadata, SW push/click only, standalone registration, push toggle, install sheet rules) → T1–T4; B (get-app bar with Play/APK target, 14-day dismissal, never on public pages) → T2–T3; C (APK routes, checksum, mounts, help) → T5 (the "How to install" help is part of the runbook + APK page text — add a short `?help=1` section to `download/app/route.ts` responses only if the owner wants it; the runbook covers the steps); D (OTA protocol, signing, rollback, always-open path) → T6–T7; E (variants, Actions build + OTA jobs, secrets handling, no auto version bump, Mac script, runbook, keys) → T8–T9; testing → each task.
- The spec's "How to install page section on `/download/app?help=1`" is reduced to the runbook — flagged for the owner in the PR rather than built speculatively.
- Names consistent with P1/P2/P4: `appConfigFromEnv`, `ALWAYS_OPEN` in `app-gate.ts`, `/api/v1/push/{devices,vapid}`, `compareVersions`, `useAppConfig`, `appConfig().variant`.
