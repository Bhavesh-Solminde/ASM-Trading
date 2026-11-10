# Mobile implementation completion — 2026-11-01

The interrupted mobile work is complete in branch `codex/mobile-complete-p3-p5`. This integrates the existing P1/P2/P3 work, the final P3 fixes, P4 notifications, P5 distribution, the owner-selected CFD migration, and current main including PR #128. No production merge, deployment, release tag, upload or store submission was performed.

## Plan status

| Work | Result |
| --- | --- |
| P1 server | Existing bearer sessions, API contracts and client-core included |
| P2 app | Existing shell, auth, lock, chart and R5 design included |
| P3 payments/account | All original tasks and interrupted final fixes completed; PR #92 marked ready |
| P4 push | Transactional payment/KYC outbox, lease-fenced worker, native FCM/Web Push, presence-aware trade batches, preferences and safe tap routing |
| P5 distribution | PWA/install UI, APK streaming/checksum/help, signed variant-isolated OTA, release workflow, local scripts and runbook |
| CFD decision | Owner selected CFD; native opening, fee/leverage display, protection edits, manual close, correct net results/history, socket recovery and stale-currency/revision safeguards implemented |

P3 privacy work removes temporary KYC files, including late results after screen/session exit. Shared config tolerates future list values. Receipts keep the actual ledger currency after conversion. Both app and website withdrawals carry expected currency and reject stale units. Frozen accounts are denied bootstrap and new CFD exposure. Four misleading FAQs were corrected in shared website copy and both mobile languages.

Independent cross-reviews of P4, P5 and CFD found and fixed session cleanup, notification routing, browser subscription ownership, app-banner overlap, inconsistent currency snapshots, stale protection edits, delayed socket/fetch races and binary payout labels. These were Codex reviews, not a claimed new Opus review. Deployment typechecking now includes notify, and a PR workflow runs the full isolated suite plus Android export.

## Verification

The final serial workspace test run exited successfully: **3,629 tests across 15 packages**.

| Package | Passing tests |
| --- | ---: |
| Mobile | 1,540 |
| Website | 523 |
| Engine | 423 |
| Database | 399 |
| Algorithm | 248 |
| Contracts | 124 |
| Client core | 121 |
| Tatum | 80 |
| Pricing | 45 |
| Mail | 45 |
| Trading | 39 |
| Notify | 19 |
| Config | 10 |
| Harness | 8 |
| Logger | 5 |

- TypeScript passed for mobile, website, engine, contracts, client-core, database and notify. Scoped lint and whitespace checks passed.
- Production website build and final Android JavaScript export passed. The lockfile installs offline/frozen from the available cache.
- A native arm64 debug APK compiled, installed and started on Android API 35. The local incomplete NDK r27 install was avoided using the existing r27b through a temporary build-only Gradle initialization file; no SDK files or production build settings were modified.
- Emulator automation passed login, PIN creation/confirmation, Demo selection, Payments/History/Account navigation, cold-start unlock and the final CFD label. Native Hindi, physical-device performance, camera, actual payment intents and real notification delivery still need the release acceptance below.
- The deterministic HTTP lifecycle test uses a real isolated PostgreSQL database and the real CFD desk. It verifies internal authentication, stale-currency rejection, exact investment/opening-fee debit, manual close and no second payout on a duplicate close. Its injected deterministic provider does not weaken production quote/session checks.
- The ordinary local app correctly disabled trading when fresh external quotes were unavailable. No real-money trade was placed.
- The first remote validation run reached engine tests and hit the adversarial Monte Carlo test's default five-second deadline (6.8 seconds on the shared runner). Its timeout now matches the other Monte Carlo scenarios at 30 seconds; all trials and assertions are unchanged.
- Earlier baseline failures were repaired with realistic fixtures/oracles and display precision changes that preserve settlement ticks and economics; see [baseline evidence](testing/mobile-baseline-repairs.md).

All database work used fresh local databases (`asm_codex_complete_test`, `asm_codex_mobile_smoke`) and separate Redis databases. Existing root/other-worktree edits were preserved. No production data or credentials were used.

Native screenshots: [CFD](testing/mobile-completion/native-cfd.png), [Payments](testing/mobile-completion/native-payments.png). These show only a throwaway local account.

## Review and deployment path

The combined review branch contains all mobile plans and merges current main, so it is the coherent replacement for merging the older mobile stack separately. Existing PR #83 and #92 retain their historical reviews; #84 is already merged into #83. Avoid merging both paths independently. Deploy urgent money hotfix #127 first as previously documented, then the combined implementation after review. Apply the push-notification migration before restarting new web/engine services. Deploy server code before distributing mobile binaries.

## Owner-controlled release acceptance

Code completion is not a signed production release. The remaining steps require the owner's identities, services or devices:

1. Supply distinct Play/direct keystores, matching Firebase/OAuth app configurations, the public OTA certificate and corresponding private server key, FCM credentials and VAPID keys. These identities were not generated or guessed.
2. Perform native Hindi review and physical-phone UPI, camera, biometric, performance, cold-start, background notification, update and rollback checks. Verify installed iPhone PWA push on iOS 16.4+.
3. Complete truthful CFD financial declarations and obtain store approval before setting Play live. Keep version announcements unchanged until signed artifacts have been installed and verified.
4. Perform hotfix #127's production-data checks and deployment prerequisites. Existing treasury/currency-normalization and historical balance decisions remain separately recorded in the owner's to-do file; they were not silently changed here.

Follow [release instructions](mobile-release.md), [push setup](mobile-push.md), [CFD details](mobile-cfd.md) and [P3 fix details](mobile-p3-completion.md). Missing OTA certificate disables OTA in development and blocks a release script; missing push credentials disable delivery safely. No unsigned update fallback is served.
