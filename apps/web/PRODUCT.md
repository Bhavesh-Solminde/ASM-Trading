# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: retail traders in India placing short-duration digital-options trades — typically small stakes ($1–$100 range per the current UI defaults), many sessions per day, on a screen they keep open while doing something else. They fund and withdraw through Indian consumer payment rails (UPI, PhonePe, PayTM) rather than cards or wire.

Secondary: an internal operator who reviews and approves deposits, manages tradable assets, and inspects delivery of transactional messages (`/admin/*`).

Desktop is the first-class design target (user decision, 2026-09-14). Mobile is required but adapted after.

## Product Purpose

A web trading platform for digital ("binary") options: the trader picks an asset, sets an expiry duration and a stake, predicts Up or Down, and receives a fixed payout if correct. Around that core loop sits the money path — deposit, balance, withdrawal, transaction history — and the account path — KYC verification, two-step verification, security settings, support.

Success is a trader who can fund, place, and settle a trade without hesitating at any step, and withdraw without needing support.

Stage: real product preparing to launch to real users (confirmed 2026-09-14). Production concerns — real error states, KYC flows, edge cases, accessibility — are in scope, not deferred.

## Positioning

Familiar digital-options mechanics delivered on India-native payment rails, under its own identity rather than as a visible imitation of an incumbent.

The structural layout of established brokers is deliberately retained because traders already know it (confirmed 2026-09-14: "same layout, own identity"). The differentiation is intended to live in identity, craft, and the money path — not in reinventing the trade loop.

Open: no differentiating claim about payouts, spreads, asset coverage, or execution has been established. Future work must not invent one.

## Operating Context

- **Dual accounts.** Every trader holds a Live and a Demo account and switches between them from the top bar; the demo balance is resettable. Design must make the active account unmistakable — a trade placed on the wrong one is a real loss.
- **Manual deposit approval.** Deposits are not instant. They enter a Processing state, an operator approves them in `/admin/deposits`, and the trader waits. The UI must hold that wait credibly.
- **Hosted UPI checkout.** Deposits hand off to a standalone checkout route (`/checkout/[token]`) showing a QR code and UPI ID, after which the trader enters a UTR / UPI reference number to confirm they paid. This screen is outside the platform shell and is the highest-stakes moment in the product.
- **Two-step verification** gates both platform entry and withdrawals.
- **KYC/document verification** blocks withdrawal until identity fields are complete.
- Sessions are cookie-based; every platform page is a dynamic server component reading `cookies()` at render.

## Capabilities and Constraints

Confirmed capabilities: live candlestick charting (`lightweight-charts`), multi-asset tab switching with per-asset payout percentages, duration and stake entry, Up/Down order placement, open-trade and trade-history lists, deposit method selection, UPI QR + deep-link checkout with UTR confirmation, withdrawal requests, paginated payment history, profile/KYC form, 2FA toggles, support ticket creation and FAQ, and an admin surface for deposits, assets, and messages.

Technical constraints that bound any redesign:

- **Server-first.** Only 19 of 83 source files are `"use client"`. Platform pages are async server components querying the database directly in the render body. New interactivity must introduce client boundaries deliberately; there is no client fetch layer to reuse.
- **Chart colors are imperative.** `PriceChart.tsx` passes colors to `createChart` as JS objects, and the checkout QR renders to canvas. Neither follows a CSS token change automatically; both need explicit bridging.
- **Tailwind v4, CSS-first.** No `tailwind.config.*` exists; the token scale lives in a `@theme` block in `globals.css`.
- **No UI primitives exist.** No Button, Card, Input, Dialog, Table — each is re-authored inline per page across 368 `className` sites.
- **Tests do not constrain markup.** All 15 test files are Vitest node tests over API routes and pure functions. No DOM, RTL, snapshot, or class-name assertions.
- **No i18n layer.** English only; none planned as of 2026-09-14.
- Four nav destinations (Tournaments, Market, Analytics, More) are deliberately rendered as visible-but-disabled rail items via `available: false` in `src/lib/nav.ts`. This is intentional and must be preserved.
- Build hazard, not UI-specific: `packages/db/generated/` is a gitignored Prisma artifact; `pnpm --filter @asm/db generate` must run before `apps/web` will render.

## Brand Commitments

- Name: **ASM** / AMScoins (as used across the repo and commit history).
- **Binding structural reference:** the 15 screenshots in `reference/` (Quotex web trading platform, captured 2026-09-10). The user has made the *layout* binding — icon rail, center chart, right-hand trade panel, tabbed account pages — and explicitly *not* the visual identity. Palette, typography, iconography, and detailing are to be replaced with an identity of its own.
- No logo asset, wordmark, or brand palette exists yet.

Open: voice and tone have not been established.

## Evidence on Hand

- `reference/` — 15 screenshots of the incumbent competitor UI, dated 2026-09-10. Structural reference only.
- `docs/` — a demo runbook covering prerequisites, start commands, and a walk-through.
- The running application itself (~2,400 LOC of UI) is the incumbent visual implementation.

Absences future work must not fabricate: there are no testimonials, no customer names, no press coverage, no performance or payout benchmarks, no license or regulatory claims, and no published pricing. Regulatory status is undetermined and must not be asserted in UI copy.

## Product Principles

1. **The active account is never ambiguous.** Live versus Demo is the highest-consequence piece of state in the product; it outranks aesthetics wherever the two compete.
2. **Money states are told honestly.** Deposits are manually approved and slow. The design's job is to make waiting legible and trustworthy, not to imply an instant credit that has not happened.
3. **The trade loop is muscle memory.** Familiar structure is a deliberate asset. Identity and craft carry the differentiation; the positions of things do not move to be interesting.
4. **Density without noise.** This is an Operate surface a trader keeps open for hours. Scanability, stable layout, and numeric legibility outrank expression.
5. **Claim nothing unearned.** With no regulatory, performance, or social proof established, the interface earns trust through precision and candor rather than assertion.

## Accessibility & Inclusion

No product-specific standard has been established. Given the confirmed launch intent, the working baseline is WCAG 2.2 AA for contrast, focus visibility, and keyboard operability — recorded here as a default to confirm, not as a captured requirement.

Note: the up/down and profit/loss semantics are currently carried by green/red alone. Colorblind-safe redundant encoding (icon, sign, or position) is an open accessibility decision with direct financial consequence.
