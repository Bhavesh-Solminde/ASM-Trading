# Current completion audit — 5 November 2026

Scope: full website integration in `codex/otc-website-integration`, with the
owner's subsequent chart SL/TP and visibility changes. The owner subsequently
authorized production release. Source `71ced0c` is deployed, OTC is active,
and the four migrations applied. See `otc-production-release.md` for live
verification and the remaining browser screenshot limitation.

| Requirement | Current authoritative evidence | Status |
| --- | --- | --- |
| Written full integration plan | `otc-website-integration-plan.md`, updated to latest owner corrections | Implemented |
| Shared30market catalogue, 200bots/market | `packages/market-sim/src/catalogue.ts`, worker tests, KVM snapshot | Verified |
| Bots do not register users | Engine wallet leaderboard; KVM snapshot has100normal USERs and200accounts, not6,000botusers | Verified |
| Normal signup/login accounts | Local corrected preview HTTP report; KVM lifecycle and normal100signup runner | Verified |
| Only USER+LIVE changes books | Eligibility/account-flow tests and KVM lifecycle; DEMO entire-path nonmutation checks | Verified |
| Persistent finite books and true matches | Runtime/archive PostgreSQL checks, execution audits, funding/volume benchmark | Verified |
| Infrequent reference polling for all30 | Reference scheduler tests, persisted cooldown tests, actual local/KVM source/calibration snapshot | Verified |
| No illustrative startup chart | New runtime guard,19focused engine checks,90market/seed path runs,30corrected preview WS snapshots | Verified |
| Reference updates never directly overwrite candles | Anchored-market and runtime tests | Verified |
| Fixed92% profit, SL/TP, expiry, ties, no manualclose | Fixed-contract tests, ledger tests, actual HTTP/KVM lifecycle | Verified |
| Original terms across currency change | DB/account tests and real website currency lifecycle | Verified |
| Multiple positions and1/10/20/40/100 accounts | KVM schedules, execution audits,3,734accepted LIVE entries, all100final ledgers reconcile | Verified |
| Idempotency and crash recovery | Injected crash tests afterfill/finalize/credit, writer fencing, missing checkpoint guard | Verified |
| Selected-market transport and private events | Real HTTP/WS tests,100authenticated-client runs, no crossed notifications | Verified |
| History paging/retention and bounded buffers | Actual archive tests and36hour worker run | Verified |
| Top10 bot P&L from actual wallets | Leaderboard wallet-equity test, real WebSocket rows; no botuser creation | Verified |
| Main chart uses same library/appearance as demo | Lightweight Charts source/options; build/types and UI tests | Implemented; fresh visual review pending |
| Chart SL/TP with no number fields | `OtcProtection`/ticket interaction tests: snappeddrag, keyboard, restore, sidevalidation, original retry payload | Implemented; real mouse/touch review pending |
| Hide reference, lower book/flow/performance UI | Removed from workspace/PriceChart; authenticated HTML check | Verified source/HTTP; fresh visual review pending |
| Six performance preferences retained | Incremental chart/volume, stable store, compact stream,6cache,worker,bounded diagnostics; checklist updated | Automated checks passed |
| Actual KVM workload measurements | `verification/kvm/README.md`, container samples,33valid100socketprocesssamples | Verified for tested workload |
|300× / hour jumps / long session | Worker300× achieved; durable KVM103× measured honestly; exactrestoration/volume/funding checks | Verified, durable300× not achieved |
| Desktop/phone rendering, pan/zoom, overlays and account/market/style switching | Browser tool still rejects local access despite owner's Enabled reply | **Unverified / remaining gate** |
| Actual browser frame/longtask/switch measurements | No current usable browser-control surface | **Unverified / remaining gate** |
| Full current build/types/website checks | Post-main-merge production build, strict deployed-package types, 75 website files/491 checks;19 engine OTC checks;39 market-model and82 contract checks | Passed |
| Legacy full DB suite | Prior unchanged DOGE/USDJPY legacy display-step test fails | Known baseline failure; not allDBgreen |

Earlier bot-parity and accounting/load reports do not prove the originally
affected startup price paths were realistic. The screenshot-discovered defect,
saved original evidence, actual fix and new test inputs are in `otc-startup-fix.md`.
Original preview history remains preserved, with corrected history in the new
`otc_preview_fixed` database. No old trade outcomes/candles were rewritten.

The goal remains active until the remaining actual browser gates are resolved.
Do not treat server or mocked DOM checks as browser-frame or visual evidence.
