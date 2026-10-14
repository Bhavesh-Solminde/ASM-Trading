# Mobile sub-project 3 — Payments, History, Account

**Date:** 2026-10-14 · **Overview:** [mobile app overview](2026-10-14-mobile-app-overview-design.md) · **Needs:** [1](2026-10-14-mobile-p1-server-design.md), [2](2026-10-14-mobile-p2-shell-trade-design.md)

## Goal

Fill the Payments, History and Account tabs with native versions of today's
mobile web flows, adding UPI app hand-off, native KYC camera, pull to refresh
and skeletons. Every write goes to an existing route; no new money logic.

## Payments tab

- **Balance card** (`GET /api/v1/wallet`): live balance (real + bonus),
  available to withdraw, locked bonus note, demo balance, bonus progress bar,
  Deposit / Withdraw buttons. Balances also update live from the socket
  `balance:update`.
- **Recent payments**: first 5 rows from `GET /api/v1/payments`, "See all" →
  History filtered to payments.

## Deposit (amount → method → pay)

Config from `GET /api/v1/deposit-config`.

1. **Amount**: keypad sheet (`client-core` `amount-input`), quick chips,
   per-method min/max from `limits`, live bonus preview (`bonus`).
2. **Method**: PhonePe, GPay, Paytm, UPI (any app), USDT. Methods outside the
   amount's limits are disabled with the reason; UPI rows show "Coming soon"
   when `upiEnabled` is false; USDT hidden with no networks.
3. **Create**: `POST /api/deposits` (`CreateDepositSchema`) → `checkoutToken`.
4. **Pay screen** from `GET /api/v1/checkout/:token`, polling
   `GET /api/deposits/:id/status` every 4s while visible (same cadence as
   `UpiStatusPoller`), stopping on a final status.

**UPI pay screen**

- Countdown to `expiresAt`, amount, payee VPA (copy), QR rendered locally
  from `upiUri` (`react-native-qrcode-svg`).
- "Pay with …" buttons for installed apps only. Detection via
  `Linking.canOpenURL` on each app's scheme, declared in the Android manifest
  `<queries>`:

  | App | Scheme used |
  |---|---|
  | PhonePe | `phonepe://pay?<upiUri query>` |
  | GPay | `tez://upi/pay?<upiUri query>` |
  | Paytm | `paytmmp://pay?<upiUri query>` |
  | Any UPI app | `upi://pay?<query>` (system chooser) |

  The chosen method's app is shown first.
- On return to the app (`AppState` active), poll immediately.
- "I've paid" → claim screen: UTR entry (`ClaimUtrSchema`) →
  `POST /api/deposits/:id/claim`, or screenshot upload →
  `POST /api/deposits/:id/screenshot` (image picked/compressed as in KYC).
- Expired: same messages as the web deposit page, with the claim link.

**USDT pay screen**: network, amount in USDT (slot amount when `isSlot`),
receiving address with QR + copy, countdown; gateway deposits poll status only;
non-gateway shows the tx-hash claim (`ClaimUsdtPaymentSchema` →
`POST /api/deposits/:id/usdt-claim`).

**Result**: success screen with credited amount and bonus; failure/expired
screen with next steps. Haptic success on completion.

## Withdraw (amount → payout → confirm)

Data from `GET /api/v1/wallet` + `GET /api/v1/withdrawal-prefill`.

- KYC not `VERIFIED` → a full card "Verify your identity to withdraw" →
  Account → Verify identity. (Gate is still enforced server-side.)
- **Amount**: keypad, limits from `client-core` `withdrawal-limits`
  (₹700–₹50,000 on INR), shows available-to-withdraw.
- **Payout**: Bank (holder, account number, IFSC) / UPI ID / USDT (network +
  address, `isValidUsdtAddress`), prefilled from `lastPayouts`; validated with
  `PayoutDetailsSchema`.
- **Confirm**: summary card → `POST /api/withdrawals`
  (`CreateWithdrawalSchema`). The withdrawals route has no 2FA step today, so
  the app adds none.
- Held withdrawals: banner with cancel → `POST /api/withdrawals/:id/cancel`.

## History tab

- One list: trades (from socket store + `GET /api/trades?accountId=`) and
  payments (`GET /api/v1/payments`, infinite scroll by cursor), merged and
  grouped by day with `client-core` `history-model` / `day`.
- Filter chips: All · Trades · Deposits · Withdrawals.
- Pull to refresh; skeleton rows on first load; empty state per filter.
- Row tap → detail sheet: trade detail, or payment detail with the status
  timeline (`timeline-model`). Deep link `indianxtrade://history?tx=d:<id>` /
  `w:<id>` opens the same sheet (used by push in sub-project 4).

## Account tab

Header: nickname, email, KYC badge. Hub list:

| Item | Behaviour |
|---|---|
| Profile | `GET /api/account` → form with `UpdateProfileSchema` → `PATCH /api/account`; read-only with a note when KYC-locked (`409`) |
| Verify identity | see KYC below |
| Currency | `POST /api/account/currency` (same rules as `/account/currency`) |
| Demo account | reset → `POST /api/account/demo-balance` |
| Notifications | toggles, filled in sub-project 4 |
| Security | app lock on/off, change PIN (sub-project 2), two-factor toggles → existing `/api/account/two-factor` |
| Language | English / हिन्दी → `PATCH /api/v1/account/preferences` |
| Support | tickets list + new ticket (`/api/support`, `CreateTicketSchema`), FAQ from contracts, WhatsApp/Telegram buttons from `app/config` |
| Leaderboard | `GET /api/leaderboard` list |
| Legal & guides | open the website pages in `expo-web-browser` |
| Log out | `POST /api/auth/logout`, wipe secure store + MMKV, back to login |

## KYC (native camera)

Same rules and endpoints as `/account/verify`:

- Steps: personal details (profile fields required for KYC) → documents
  `AADHAAR_FRONT`, `AADHAAR_BACK`, `PAN` (card guide) → `SELFIE` (oval guide,
  front camera) → review → `POST /api/account/kyc/submit`.
- Capture with `expo-camera` (`CameraView`, autofocus, torch toggle for
  documents); retake / use photo.
- Gallery fallback via `expo-image-picker`.
- Compression with `expo-image-manipulator` following `shrink-image.ts`:
  long side 1600px, JPEG quality 0.85 then 0.7 and smaller steps until
  ≤ 900 KB.
- Upload each as multipart (`kind`, `file`) to
  `POST /api/account/kyc/documents`; progress per document; retry on failure.
- Status screens: PENDING ("under review"), REJECTED (shows `kycReviewNote`,
  resubmit), VERIFIED (done, withdrawals unlocked).
- Camera permission denied → explain + open settings, or use gallery.

## Shared UI pieces

Sheet (bottom-sheet with drag-to-close and backdrop), Keypad, AmountField,
StepHeader, SummaryCard, Skeleton, EmptyState, ErrorState (Retry), Toast —
ported from `components/payments/*` and the `.sheet` pattern, styled with the
sub-project 2 tokens. All strings in en/hi.

## Testing

- Unit: UPI scheme builder (query passthrough, encoding), installed-app
  detection mapping, image compression step selection, history merge/grouping
  with cursor pages, deposit amount/method validation reuse.
- Maestro: deposit UPI up to the pay screen (amount → method → token) on
  demo env; withdraw blocked by KYC; withdraw happy path with KYC-verified
  test user; KYC capture with emulator virtual camera; history pull-to-refresh
  and detail sheet.
- Manual: real UPI hand-off in PhonePe, GPay, Paytm with each production
  collection VPA (P2P intent limits), USDT copy/QR on a real wallet app.

## Out of scope

Referral, saved payout methods table, new deposit methods, any change to
verification or limits.
