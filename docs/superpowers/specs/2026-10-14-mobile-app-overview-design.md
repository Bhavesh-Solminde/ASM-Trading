# IndianxTrade mobile app — overview

**Date:** 2026-10-14 · **Status:** Approved in brainstorming, specs under review

The trader-facing product becomes an Android app (Expo / React Native) and an
iPhone home-screen web app (PWA), keeping the current mobile web UI (Oct 12
redesign) and making it feel native. This overview records the decisions and
how the work is split; each sub-project has its own spec.

## Decisions (owner, 2026-10-14)

| Topic | Decision |
|---|---|
| Stack | Expo SDK 57 + expo-router in `apps/mobile` (same toolchain as `apps/relay`) |
| Android distribution | Google Play **and** a `direct` APK from our site, built from one codebase |
| iPhone | Safari "Add to Home Screen" web app with web push; no App Store |
| Scope | Trader app only; admin stays on the web |
| Languages | Android app: English + Hindi. Website and iPhone PWA: English only |
| App lock | On by default: biometric, else 4-digit PIN; re-lock after 5 min in background or a reboot; can be turned off |
| Chart | Native rewrite with `@shopify/react-native-skia`; v1 types: candles, line, area, bars (other 7 in v1.1) |
| Trade-result push | Live trades only, only when the user has no live engine connection, grouped within 10s |
| Min device | Android 8.0 (API 26), 3 GB RAM; ≥45fps chart on a ₹8–10k phone, 60fps on mid-range |
| App promotion | Logged-in pages only (Android "Get the app" bar, iPhone install sheet); public/SEO pages unchanged |
| Builds / OTA | No Expo account. GitHub Actions builds (tag-triggered) + a documented Mac script backup; OTA updates self-hosted on the VPS |
| Server API approach | Reuse existing `/api/*` routes (accept bearer tokens) and add only the missing reads under `/api/v1/*` |
| Extras in v1 | Push, biometric/PIN lock, UPI app deep link, haptics + drag-to-close sheets |

## Play Store risk

Google Play's Financial Services policy names binary options and does not allow
apps that let users trade them. The owner chose to submit anyway. Mitigations
(binding on every sub-project):

- The `direct` APK is a first-class build from day one and is the website's
  default download until Play is confirmed live.
- The Play listing and Financial features declaration describe the app honestly.
- A separate Play developer account from any other app the business publishes.
- A skeleton build goes to Play Internal testing during sub-project 1 to learn
  the verdict early.

## Sub-projects

| # | Spec | Depends on | Est. |
|---|---|---|---|
| 1 | [Server for the app](2026-10-14-mobile-p1-server-design.md) | — | 2 wk |
| 2 | [App shell + Trade](2026-10-14-mobile-p2-shell-trade-design.md) | 1 | 6.5 wk |
| 3 | [Payments, History, Account](2026-10-14-mobile-p3-payments-account-design.md) | 1, 2 (shell) | 2.5 wk |
| 4 | [Push notifications](2026-10-14-mobile-p4-push-design.md) | 1, 2 (shell) | 1 wk |
| 5 | [iPhone PWA, distribution, releases](2026-10-14-mobile-p5-pwa-distribution-design.md) | 1 | 1.5 wk |

About 13–14 weeks for one developer; 5 runs alongside 3. Each sub-project ends
in its own PR to `main`. Plans live in `docs/superpowers/plans/` and may change
as we build.

## What's different: app vs mobile website

| Area | Mobile website | App |
|---|---|---|
| First screen | Landing page | Splash → Login → Trade; public pages open in an in-app browser tab |
| Login | Cookie, 7-day sliding | Bearer token in secure storage, 30-day sliding, app lock |
| Language | English | English or Hindi (switch in Account) |
| Trade screen | Same layout | Same layout; native Skia chart (pinch/scroll/crosshair), haptics, keep-awake, instant resume |
| Trade results | Only with the tab open | Push when the app is closed |
| Sheets | Tap outside to close | Drag to close |
| UPI deposit | QR + copy | Buttons that open PhonePe/GPay/Paytm with the amount filled; QR/copy fallback |
| KYC | In-browser camera | Native camera with guides |
| Status changes | Check History | Push for deposit credited, withdrawal approved/paid/rejected, KYC decision |
| Lists | Static | Pull to refresh, skeletons, infinite scroll |
| Network loss | Silent reconnect | Offline banner; socket pauses in background, resumes on return |
| Updates | Instant on deploy | OTA for JS changes; force-update screen below the minimum version |
| Admin | Web | Not in the app |

## Cross-cutting rules

- **Money rules live in one place.** Stake limits, KYC gate, withdrawal limits,
  bonus and fraud status stay in `packages/db` / existing routes; the app never
  re-implements them.
- **Contracts first.** Every JSON shape the app consumes is a zod schema in
  `@asm/contracts`, parsed on the server before sending and in the app on
  receipt.
- **Shared pure logic** lives in `packages/client-core` (sub-project 1).
- **Migrations are hand-written** (`schema.prisma` has pre-existing drift; never
  run `prisma format`).
- **Out of scope for v1:** admin screens, referral, tournaments, landscape
  chart, widgets, App Store, the 7 extra chart types, any change to trading,
  bonus or KYC rules.
