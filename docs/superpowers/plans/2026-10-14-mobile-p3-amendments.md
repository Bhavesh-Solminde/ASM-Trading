# Mobile P3 (payments, history, account): plan amendments (pre-flight review, 2026-10-20)

## R5 rebase (2026-10-21), overrides everything below

**Why this section exists.** The owner merged Codex's R5 redesign (PR #94, 518856e) into this branch and said to keep its UI. The merge is a056096.

**Where the findings are.** The re-preflight is `.superpowers/sdd/p3-r5-preflight.md`: 2 Blockers, 8 Important, 10 Minor.

**Precedence.** Where this section and anything below disagree, this section wins. Everything below that is not mentioned here still applies, restyled to R5.

**Baseline**
- HEAD a056096.
- Mobile vitest **754 / 83 files**; `tsc` and eslint clean.
- The stacked PR base is still `claude/mobile-p2-shell-trade`.
- The worktree is `.claude/worktrees/mobile-p3-t1a`. Never touch `.claude/worktrees/mobile-p3`, which is Codex's.

### R0. Design source

**Look.** R5 everywhere:
- `theme/tokens.ts` as merged;
- `Txt` native sans;
- R5 `Money`;
- the R5 hub patterns.

For flow screens, use the **R2 chrome** of the Figma file `FKOYMF8qihz9OG9qKrrIzJ` ("IndianxTrade Mobile redesign review", page "02 · Premium revision"):
- a 44pt rounded-square `raised` back button with a 21/600 title;
- the CTA stack at the bottom: a pale `light` main button over a `secondary` button;
- key/value cards on `surface`;
- small tinted status tags.

**Content and behaviour** come from the task sections below (built from the N-boards and checked against the server):
- what is on each screen, in what order;
- data, validation, money rules, routes and copy limits.

**Figma R2 frames are labelled "Proposal awaiting approval".** Use them for layout and chrome only. When an R2 frame disagrees with a task section on behaviour, the task section wins (owner Q1).

**Dropped Passbook decoration:**
- `Stamp lg` / `xs`;
- perforations;
- the Payments cover card and its gradient;
- `Tricolour` in flows;
- the dashed rule under amounts;
- Martian money.

**Figma access.** The Figma MCP is rate-limited (Starter plan). Two R2 boards are saved for implementers: `.superpowers/sdd/figma-r2-payment-states.png` and `.superpowers/sdd/figma-r2-identity.png`. For everything else, build from the R5 code patterns and this section.

| Screen | Route | Look reference | Content from |
|---|---|---|---|
| Trade, fullscreen | `trade` | R5 as merged. P3 does not restyle it. | T8c only |
| Payments hub | `payments/index` | R5 (exists), Figma "R5 / Payments" | T1b (fixes only) |
| Deposit | `payments/deposit` | R2 "Add money" | T2 |
| UPI pay | `payments/pay/[token]` | R2 "UPI payment" | T3a |
| Pending, result, receipt | inside `pay/[token]` | R2 "Checking payment", "Payment confirmed", "Completed receipt" (saved PNG) | T3b |
| USDT pay | inside `pay/[token]` | R2 "UPI payment" frame | T4 |
| UTR / tx-hash claim | `payments/claim/[id]` | R2 form chrome (labels above fields, as on "Identity details") | T3a, T4 |
| Withdraw | `payments/withdraw` | R2 "Withdraw" | T5 |
| History | `history` | R5 (exists), Figma "R5 / History" | T6 |
| Payment detail | a `Sheet` over History | R2 "Payment details" (saved PNG) | T6 |
| Account hub | `account/index` | R5 (exists), Figma "R5 / Account" | T8a (additions) |
| Profile | `account/profile` | R2 "Profile" (saved PNG) | T8a |
| Language | `account/language` | R2 "Preferences" | T8a |
| Verify | `account/verify` | R2 "Verify identity" (saved PNG) | T7b (4 captures) |
| KYC details | `account/kyc-details` | R2 "Identity details" (saved PNG) | T7b |
| KYC camera | `account/kyc-camera` | N-KycCamera geometry with R5 tokens (R2 "Document capture" is a placeholder) | T7b |
| Security, PIN | `account/security`, `security-pin` | R2 "Security" | T8b |
| Support | `account/support` | R2 "Support" | T8b |
| Currency | `account/currency` | R5 settings rows | T8c |
| Notifications | `account/notifications` | stub | P4 |

### R1. Primitives, as they are now (replaces "Primitives to use" where they differ)

**Tokens** (`theme/tokens.ts`, R5):
- surfaces and rules: `ground #080a10`, `surface #131720`, `raised #1d2330`, `rule #303747`, `ruleSoft #222835`;
- ink: `ink #f4f6fb`, `ink2 #a4acbe`, `ink3 #858fa5` (5.52 on surface, 4.84 on raised);
- accent: `accent #456ae7` (white on it 4.70), `accentText #a2b8ff`;
- direction and bonus: `downText #ff827a`, `gold #e4c58b` (bonus only; 9.48 on raised);
- `up` / `down` / `upInk` are unchanged.

**Removed from the token plan:**
- The canvas → token map (`#3f6ff2 → accent` …) is deleted.
- T1b adds **only** `paper #f4f6f8` (the QR card; ground on it 18.3) and `cameraInk #dfe4ea`, with contrast tests.
- `goldDim`, `goldRule`, `coverTop`, `coverBottom` and `coverRule` are dropped.
- The deposit bonus box is `raised` with a `ruleSoft` border and `gold` text.

**Typography**
- `Txt` renders Latin UI in the **system sans** and sets `fontWeight` (the "never sets fontWeight" note is obsolete for Latin).
- Devanagari stays bundled Anek.
- `font="fig"` (Martian) is for ASCII-only cells only: countdowns, times, UTR, tx hash, USDT address, references.
- Never put `font="fig"` on anything that can hold `₹`, `−` or Hindi.

**Money**
- `<Money>` is a single sans `Txt` with `tabular-nums`.
- Large figures use `<Money numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>` in a full-width box.
- The old "Fitting figures" rule (`fitSize` on Martian advances, floor 22) is **obsolete** for money. Do not use `fitSize` / `MARTIAN_ADVANCE_EM` in P3.
- Sizes:
  - hub total 40/500 (as R5 Payments);
  - flow amount 40/600;
  - receipt and detail 36/600.
- Every amount still comes from `money()`, with `+` / `−` where shown.

**Header**
- There is **no `TabHeader`**, and the shared-header rule (amendment I3) is obsolete.
- Hubs: `<Screen>` + `ScrollView` with padding 20, then a 28/600 `accessibilityRole="header"` title (R5).
- Trade keeps `TopBar`:
  - an account selector sheet, `testID` `account-selector` / `account-demo` / `account-live`;
  - the wallet button → `/payments`.
- `AppHeader` is flat: `HEADER_ROW` 62, no gradient, no tricolour.

**Buttons**
- The main flow CTA is `light` (R5 "Add money", Figma R2). The second CTA is `secondary`. Inline links use `text`.
- `primary` (the accent fill) is not used for flow CTAs.
- Every CTA testID named below is unchanged.

**`Sheet`**
- Content mounts **only while presented** (R5). Keep any state that must survive a dismiss in the screen.
- Example: `AmountSheet` reports its value up through `onDone`, and its draft lives in the screen.
- e2e flows open a sheet before asserting ids inside it.

**`BottomNav`**
- It hides on pushed flow screens and on Trade in fullscreen, via `tabBarHidden(route, fullscreen)`.

**`Stamp`**
- `sm` / `md` stay for existing users. Do not add `xs` / `lg`.
- Status is shown with the new `StatusTag`.

**`LedgerHeader` / `LedgerRow`**
- Unchanged: there is no ledger table in P3 (see T6).

**New `src/ui` pieces (T1b):**
- `BackHeader({ title, onBack?, icon: "arrowLeft" | "close", aside? })`:
  - a 44×44 `raised` button, radius 12;
  - a 21/600 title with `flex: 1`.
- `IconTile` (as below).
- `KeyValueBox({ rows })`:
  - a `surface` card, radius 14, padding 16;
  - each row is a 14 `ink2` label with `flex: 1` and a value with `flexShrink: 0`;
  - rows are `minHeight` 28.
- `ListState` (as below).
- `StatusTag({ tone, label })`:
  - radius 6, `raised` background, padding 3×8;
  - the label is 12/600 in the tone colour: up → `up`, caution → `accentText`, down → `downText`, neutral → `ink2`;
  - `gold` stays bonus-only.
- `SettingsRow({ icon, title, value?, onPress, testID? })`:
  - extracted from `account/index.tsx`'s row: `minHeight` 56, an 18 `ink2` icon, the title with `flex: 1`, the value in `ink2` with `flexShrink: 0`, a chevron and a bottom `rule`;
  - the Account hub switches to it.
- `AmountFigure({ text, words, onPress?, testID })`:
  - a fitted 40/600 `Money`, then the words at 14 `ink2`;
  - pressable, `minHeight` 44, no dashed rule.

**Icons, brand logos and the deposit radiogroup**
- The icon list and brand logos are as in T1b below.
- Rows in the deposit radiogroup keep `minHeight` 66.

### R2. "All tasks" changes

- **Design.** Replace "The canvas is the source of truth" with R0. Read the N-board only for content, order and copy.
- **Fonts and glyphs, and Fitting figures.** Replaced by R1 Typography and R1 Money.
- **P2 learnings.** Unchanged and binding, now also for any R5 file a task touches:
  - Hindi shrink-wrap;
  - `minHeight`;
  - targets ≥ 44pt;
  - rules of hooks;
  - `<Link asChild>`;
  - `insets.bottom`;
  - `useNow` in leaf components only.
- **Queries.**
  - Screens never declare inline `useQuery`s for wallet, payments, checkout, prefill or profile. Use the `src/api/queries.ts` hooks.
  - **One query key, one query type.** Never mix `useQuery` and `useInfiniteQuery` on a key.
  - `useAccountTradesLoaded` is called **only** in `trade.tsx`. Every other screen reads `listLoadedFor(useListLoaded(s => s.loadedFor), account.id, bootstrapTradesAccountId(boot.accounts))`.
- **Refetch.** The Payments and History hubs refetch on focus (`useFocusEffect`) and have pull-to-refresh.
- **i18n.**
  - R5 hub strings live under `redesign.*`. Reuse a key when the copy is the same.
  - New strings go in the feature namespaces, in both files.
- **testIDs.**
  - R5 added `chart-fullscreen`, `account-selector`, `account-demo` and `account-live`.
  - "`e2e/login-trade.yaml` stays unchanged" now means R5's version of it (account and duration sheets).
- **Findings superseded below:**
  - 1 (ledger) → owner Q2;
  - 4 (Account hub follows the board) → it follows R5;
  - 5 (Payments cover) → there is no cover.

### R3. Task changes

| Task | Change |
|---|---|
| **T1a** | Done (93e1a2e) and correct as merged, except `TabHeader` (dead). See T1a-fix. |
| **T1a-fix** (new, first) | See R4. |
| **T1b** | **Shrinks.** No Payments screen rebuild and no cover card. It builds the R1 pieces, adds `paper` / `cameraInk`, the icons and the brand logos. **Payments hub fixes:** see the list under this table. |
| **T2** | Content unchanged. Look per R0/R1: `BackHeader`, `AmountFigure`, the bonus box (`raised`/`gold`), and the method radiogroup on `surface`. The CTA `deposit-pay` is `light` with `28 + insets.bottom`. `AmountSheet` follows the R1 Sheet rule. |
| **T3a** | Content unchanged. The status card and chips are on `surface`. "Open <App>" is `light`; the other apps are `secondary`. |
| **T3b** | The server part is unchanged. **`PayResult` follows R2 "Payment confirmed" / "Checking payment"** (saved PNG). See the list under this table. |
| **T4** | Unchanged; T3a's frame. |
| **T5** | Content unchanged, and still **no confirm step** (owner Q1). The look is R2 "Withdraw": labels above fields, a `KeyValueBox` summary, and a `light` CTA. |
| **T6a** | **Dropped by default** (owner Q2): no ledger route or `LedgerRowSchema`. Only `GET /api/v1/payments/[key]` (with its tests) is kept, and it moves into T6. |
| **T6b → T6** | See the list under this table. |
| **T7a** | Unchanged. |
| **T7b** | Content unchanged: 4 cards (details; Aadhaar front + back; PAN; selfie). They are drawn as R2 "Verify identity" rows (`IconTile`, title, subtitle, and a state: `up` check / "Next" in `accentText` / step number). PENDING / VERIFIED / REJECTED use `StatusTag` instead of `Stamp lg`. The details form follows R2 "Identity details". The camera keeps N-KycCamera geometry. |
| **T8a** | **Shrinks**: the hub exists. See the list under this table. |
| **T8b, T8c** | Content unchanged. Look per R0. |
| **T9** | Unchanged. The testIDs are `deposit-pay`, `deposit-method-<Method>`, `pay-claim`, `withdraw-verify`, `history-seg-<s>`, `keypad-done` and `key-<k>`. Flows open sheets before asserting inside them. |

**T1b, Payments hub fixes (on R5's screen)**
- The total comes from the socket `balances[live.id]`, else `useWallet()`.
- `useFocusEffect` refetch plus a `RefreshControl`.
- The Withdraw button label becomes `withdraw.title`. T1b adds the key ("Withdraw") to en and hi; T5 reuses it.
- The KYC next-step card shows only for NOT_STARTED / REJECTED, with one title and a `text` link. Fix the duplicated copy.
- "Bonus ₹x" is pressable and opens `BonusSheet`, which moves here from Trade (owner Q3).
- Recent activity is the first **5** rows, plus "See all" → `/history?filter=payments`.
- `PaymentActivity` rows (I6):
  - tappable → `/history?tx=<key>`, `minHeight` 66;
  - `+` and `up` on credited deposits;
  - `−` on withdrawals that moved money;
  - `ink3` when `paymentMovedNoMoney`;
  - a `StatusTag` instead of the "· status" text;
  - the amount has `flexShrink: 0`.
- The T3a pending-payment slot goes under the buttons.
- Tests:
  - `statusTagTone` (pure);
  - a `paymentFigure(row)` sign/tone helper (pure).

**T3b, `PayResult` (R2 "Payment confirmed" / "Checking payment")**
- A 64 `up` check circle.
- "Money added", 28/600.
- The amount, 40/600.
- "Your live balance has been updated", in ink2.
- A `KeyValueBox`: Method, Status (`StatusTag`), Reference (`referenceFor`), Bonus (gold, hidden at 0), UTR (fig), Date.
- "New balance".
- Buttons: `light` "Start trading", then `secondary` "Share receipt".
- No `Stamp lg`, no perforations.
- EXPIRED / REJECTED use the same frame with a `down` `StatusTag` and the web copy, as T3b already specifies.

**T6 (History upgrade on R5's screen)**
- Keep R5's Trade | Payments segments and the Trade segment (`TradesBody`), as they are.
- The Trade segment's `listLoaded` comes from the store (R2 Queries).
- **Payments segment:**
  - `usePaymentsInfinite`, with `onEndReached` → `fetchNextPage`;
  - day groups from client-core `groupByDay` / `dayLabel`, with labels from i18n;
  - the T1b rows, plus `ListState`;
  - refetch on focus.
- **Params:**
  - `?filter=payments|deposits|withdrawals` selects the Payments segment, and deposits / withdrawals filter it through `itemMatchesFilter`;
  - `?filter=trades` selects Trade;
  - `?tx=d:<id>|w:<id>` (P4 contract) selects Payments and opens the detail sheet once, then `router.setParams({ tx: undefined })`.
- **Detail sheet:** T6b's content, laid out as R2 "Payment details":
  - the `StatusTag`;
  - the amount at 36/600;
  - "UPI deposit · Live account";
  - a `KeyValueBox` (Reference with copy, Created, Account, Method);
  - "Payment timeline" with the T6b dots in R5 colours;
  - Cancel withdrawal (HELD and in its window) as `secondary`.
- testIDs: `history-seg-trades`, `history-seg-payments`, `history-tx-<key>`.
- **Dropped:**
  - the ledger table and the Balance column;
  - `ledgerSections`, `ledgerFigure` and `money({ symbol: false })`;
  - the `LedgerRow` gap/padV options;
  - the currency-change footer.

**T8a (additions to the existing Account hub)**
- The identity row gets:
  - the name from `useProfile` (first + last, else the nickname, else the email's local part);
  - the email;
  - a KYC `StatusTag` (Verified / In review / Rejected / Not done);
  - an `accessibilityLabel` that includes the name.
- The verify card shows only for NOT_STARTED / REJECTED.
- Rows switch to `SettingsRow` with real icons:
  - Security (with its value);
  - Language (`languages`);
  - Currency (the LIVE currency);
  - Notifications (`bell`);
  - Help & support (`lifeBuoy`);
  - **Reset demo balance** (T8a's flow).
- Log out gets an `Alert` confirm.
- Build `profile`, `language` and the `notifications` stub as specified below.

### R4. T1a-fix (do first; small; its own Gate and commit)

1. **B1 (one payments query).**
   - `PaymentActivity` reads `usePaymentsInfinite()` (flatten `pages`; a `limit?: number` prop).
   - `payments/index.tsx` uses `useWallet()`.
   - Delete both inline queries.
   - Grep: no other `queryKey: ["payments"` and no other `queryKey: ["wallet"` outside `queries.ts`.
2. **I1 (History list state).**
   - `history.tsx` drops `useAccountTradesLoaded` and reads `listLoadedFor(...)` from `list-loaded-store`.
3. **Dead code.**
   - Delete `src/trade/TabHeader.tsx`.
   - Remove `TopBar`'s unused `listLoaded` prop and Trade's pass-through. Edit the current file.
4. **I4 (system sans in inputs).**
   - `useUiFamily(weight)` returns `undefined` for the Latin script.
   - `Field`, `PasswordField` and the MarketSheet search add `fontWeight` when the family is `undefined`, as `Txt` does.
   - Devanagari is unchanged.
5. **I3 (Hindi shrink-wrap).**
   - The Payments Withdrawable / Bonus row becomes two `flex: 1` columns, each `numberOfLines={1}`.
   - The `PaymentActivity` amount and the Account Language value get `flexShrink: 0`.
6. **Gate** as in All tasks.
7. **Commit:** `fix(mobile): one payments query, History reads Trade's list state, system sans in inputs after R5`.

### R5. Task list and order (replaces the 15-task list)

There are **14 tasks**: T1a-fix, T1b, T2, T3a, T3b, T4, T5, T6, T7a, T7b, T8a, T8b, T8c, T9.
- T1a is done.
- T6a is folded into T6: only the single-payment route survives.

### R6. Owner questions (the defaults are built; confirm in the PR)

1. **Figma R2 flow frames are "Proposal awaiting approval".** Should they bind on content too?
   - Default: no. They bind on look and layout only, and the task sections bind on behaviour. That resolves three conflicts:
     - KYC asks for **4 captures** (the R2 frame shows 3 steps);
     - Withdraw has **no "Review withdrawal" step** (the amount is on the CTA);
     - the receipt also shows Bonus, UTR and Date.
2. **History: R5 activity (Trade | Payments) or the Passbook running-balance ledger?**
   - Default: R5 activity. The server ledger route (old T6a) is dropped.
   - This replaces old Finding 1.
3. **R5 removed the Trade bonus chip,** which reverses the Oct-12 decision "bonus chip on /trade only".
   - Default: accept it. `BonusSheet` moves to Payments (tap "Bonus ₹x").
   - Deposit keeps its bonus row, the "can't be withdrawn" line and "How it works".
4. **Payment detail: a sheet over History, or a full screen as in R2?**
   - Default: a sheet. It keeps `/history?tx=` working, and Back returns to History.
5. **Owner-only (OWNER-TODO).** Export the "02 · Premium revision" frames as PNGs to `docs/design/r5-figma-2026-10-21/`, because the Figma MCP Starter limit blocks agents. Until then, implementers use R0 and the two saved boards.

---

These amendments override `2026-10-14-mobile-p3-payments-account.md` wherever the two conflict.

**How the controller uses them.** Give each task's implementer and reviewer that task's section plus "All tasks".

**Where they come from.** They are the corrections from the pre-flight review (`.superpowers/sdd/p3-preflight-review.md`: 5 Blockers, 15 Important, 14 Minor).

**Who decided.** The controller made the design calls while the owner was away. They are conservative and reversible, and they follow the canvas. The open ones are listed at the end.

**Line references.** "P<n>" is a line of the plan as written at 20befb5.

**Task list.** The plan now has **15 tasks**, run in this order:
T1a, T1b, T2, T3a, T3b, T4, T5, T6a, T6b, T7a, T7b, T8a, T8b, T8c, T9.

- Each task gets its own Gate and commit.
- The plan's commit messages split the same way.

## Already on the branch (build on it, never revert it)

**Starting point**
- P3 branches from `claude/mobile-p2-shell-trade` at 20befb5. That is P2 complete: PR #84, the restyle T1–T13 and fix rounds A–G.
- The stacked PR base is `claude/mobile-p2-shell-trade`, not main (fixes P11).
- Baseline: mobile vitest **741** passing.

**Primitives to use**
- **Theme** (`src/theme/ui.tsx`):
  - `Screen` (with `bleedTop`), `Txt` (`font`, `weight`, `size`, `color`, `tracking`, `lineHeight`, `script`; never sets fontWeight), `useUiFamily`.
  - `Button`. Its kinds are **`primary | light | secondary | text`**, and it takes an `icon` prop.
  - `Card`, `Row`, `Skeleton`.
- **Tokens** (`src/theme/tokens.ts`):
  - `accent #3d6cf0`.
  - `ink3 #7c8695`. Never use it on the header.
  - `down`: fill, stroke and border only. Text uses **`downText`**.
  - `gold`: bonus only.
  - `upInk` / `downInk`.
- **`src/ui`:**
  - Money and figures: `Money`, `FigText` (with `fig-runs`).
  - Status and lists: `Stamp` (`sm` / `md`), `LedgerHeader` / `LedgerRow`, `Chip` (with `role` and `figures`).
  - Overlays: `Sheet` (pads `insets.bottom`, closes on Android back), `GateScreen`, `Toast` (`toast(msg, "neutral" | "up" | "down")`).
  - Forms (`form.tsx`): `Field`, `PasswordField`, `FormScroll` (keyboard or `insets.bottom`), `TextLink`, `PromptLink`.
  - Shell and decoration: `PillFill`, `Icon`, `AppHeader`, `Tricolour`, `DashedRule`, `BrandMark` / `Wordmark`, `BottomNav`, `LanguageSwitch`.
- **Money**:
  - `src/money/format.ts`: `money(minor, currency, { trim })` (Indian grouping on INR, never throws), `groupIndian`, `groupTyped`.
  - `src/money/words.ts`: `amountInWords(rupees, "en" | "hi")`.
- **Fit** (`src/trade/header-fit.ts`): `fitSize`, `textEm`, `MARTIAN_ADVANCE_EM`, `RUPEE_ADVANCE_EM`, `DEVANAGARI_ADVANCE_EM`, `isCompactWidth` (< 380dp), `FILL_RIGHT`. The advances are read from the TTFs by `src/theme/ttf-reader.ts` and tested.

**Data, header and keypad**
- `src/api/client.ts`: `api(path, { method, body, form, schema, auth, token, silentRateLimit, timeoutMs })`.
- `src/api/errors.ts`: `ApiError(message, status, code)` with codes `offline`, `timeout`, `rate_limited`, `unauthenticated` and gate codes.
- `src/api/queries.ts`: `queryClient`, `useBootstrap`, `useAppConfig`.
- `src/api/refresh-bootstrap.ts`: `refreshBootstrap(queryClient)`. **Every** bootstrap invalidation goes through it.
- Trades for one account: `src/trade/fetch-account-trades.ts`, `useAccountTradesLoaded`.
- Header: `TopBar` / `StaleTopBar` in `src/trade/TopBar.tsx`, `BonusSheet`.
- Keypad: `KeypadSheet` (testIDs `key-<k>`, `key-back`, `keypad-done`) and `keypad-model.ts`. Key handling is client-core `applyKey`.
- `src/trade/useNow.ts`: use it in small leaf components only.

**Session, lock and gate**
- `src/trade/trade-errors.ts`: the code → i18n pattern.
- `src/auth/messages.ts`: `errorText`, `validationKey`.
- i18n:
  - `setLocale` (`@/i18n`) and `saveLocale` (`@/i18n/locale-pref`).
  - L1 locale sync (`use-locale-sync`) already PATCHes the server locale whenever the language changes.
- `useLock`: `enableBiometric`, `setPin`, `verifyPin`, `unlockWithBiometric`, `disable`, `reset`, `method`, `enabled`.
- `useSession.signOut()`. It clears `queryClient`, the socket store, the resume cache and toasts.
- Gatekeeper and `src/gate/route-for.ts`. `GATE_PATHS` includes `/lock` and `/lock-setup`.
- `app/+not-found.tsx`.

**App config and tests**
- `app.config.ts`:
  - `scheme: "indianxtrade"`.
  - An explicit `permissions` list plus `blockedPermissions`.
  - `["expo-router", { sitemap: false }]`.
  - `typedRoutes`.
- e2e: `e2e/subflows/{open-dev-client,enter-pin}.yaml` and `e2e/README.md` (never run the folder as a whole).

**Edit rules**
- Edits to `trade.tsx`, `TopBar.tsx`, `BonusSheet.tsx`, `KeypadSheet.tsx`, `BottomNav.tsx`, `trade-request.ts`, `trade-errors.ts` and `app.config.ts` change **the current file**. Never replace a whole file with plan text.

## All tasks

**Commits**
- Every commit ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Design**
- The canvas is the source of truth: build each screen to its N-board.
  - Read the board's HTML (`docs/design/passbook-canvas-2026-10-14/N-*.dc.html`) before building, and match spacing, sizes, order and copy.
  - Names, amounts, IDs and the VPA on the boards are examples.
- Do **not** create the plan's `StepHeader`, `SummaryCard`, `ListRow`, `EmptyState`, `ErrorState` or `Keypad` (P41, P116-252). Do not build the 3-step deposit or withdraw flows (P514, P919).
- Canvas → token map:
  - #3f6ff2 → `accent`
  - #737d8c → `ink3`
  - #a6b0be → `ink2`
  - #edf1f6 → `ink`
  - #06080b → `ground`
  - #0f141b → `surface`
  - #171d26 → `raised`
  - #252d39 → `rule`
  - #1a212b → `ruleSoft`
  - #86a6ff → `accentText`
  - #142247 → `accentDim`
  - #2ecf7a → `up`
  - #ff7468 → `downText`
  - #e2b54c → `gold`
  - #9fb0d4 → `switchInk`
  - #04170c → `upInk`
- New tokens (T1b adds them, with contrast tests):

  | Token | Value | Use | Contrast |
  |---|---|---|---|
  | `goldDim` | #1a160b | bonus box background | gold on it 9.41 |
  | `goldRule` | #4a3d1c | bonus box border | |
  | `coverTop` | #13203d | Payments cover gradient | switchInk on it 7.40, ink 14.2 |
  | `coverBottom` | #0e1420 | Payments cover gradient | |
  | `coverRule` | #22314f | Payments cover border | |
  | `paper` | #f4f6f8 | QR card | ground on it 18.5 |
  | `cameraInk` | #dfe4ea | camera hint | 16.4 on black |

- Weights: canvas 620 → 600, and 560 → 500.

**Fonts and glyphs**
- Any canvas Martian Mono text that can hold `₹`, `−` or Hindi renders through `<Money>` / `<FigText>`.
- ASCII-only figures stay `<Txt font="fig">`: UTR, times, references, USDT addresses, ledger cells.
- Uppercase Martian captions ("LIVE ACCOUNT", ledger headers) use the ui family in Hindi, as `Stamp` and `LedgerHeader` do.

**Money**
- Every amount is `money()`, with a `+` / `−` prefix where the board has one.
- Never use `formatMinor`, `formatInr` or `methodAmountProblem`'s text in the app (P278, P350, P446, P724).
- Amounts in words come from `amountInWords` (INR only).

**Fitting figures**
- Every large figure is sized with `fitSize` against its measured room: Payments cover 34, Deposit / Withdraw 42, Receipt and detail 34.
  - Use `floor: 22`, the board's tracking and `fontScale` from `useWindowDimensions`.
  - Do not rely on `adjustsFontSizeToFit` for them: it does not reach FigText's nested ₹ runs on Android.
  - ASCII-only cells (ledger figures) may use `numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}`.

**P2 learnings (binding)**
- **Hindi shrink-wrap.**
  - Every multi-word `Txt` in a row has a definite width (`flex: 1`), or is one line with `numberOfLines={1}`.
  - Values beside it are `flexShrink: 0`.
  - Never leave a multi-word label shrink-wrapped in a row or in an `alignItems: "flex-end"` column.
- **Height.** Text containers use `minHeight`, never a fixed `height`.
- **Touch targets** are ≥ 44pt, through `minHeight` or `hitSlop`.
- **Rules of hooks.** Call every hook before any early return. `react-hooks/rules-of-hooks` is on for `apps/mobile`.
- **`<Link asChild>`.** Its child must never get an array `style` (that caused P2's red box). Prefer `router.push` in `onPress`. If you do use `Link`, `StyleSheet.flatten` the style.
- **Bottom inset (SDK 36 edge-to-edge).**
  - Full-screen flow screens (tab bar hidden, T1a) pad their bottom CTA with `insets.bottom`.
  - Sheets already do.
  - Forms use `FormScroll`.
- **Isolate ticking.** Countdowns tick in leaf components only (`useNow`). Never call it in a screen.

**i18n**
- Every new string goes in `src/i18n/en.json` + `hi.json`, and the parity test stays green.
- Client-side validation and limit messages come from i18n keys, never zod's `issue.message`. Map with `validationKey` or a per-form path → key map.
- **Server errors:**
  - offline, timeout, rate_limited and 5xx use translated keys (`common.noConnection`, `common.genericError`, …).
  - Known codes map to keys (the `trade-errors.ts` pattern).
  - Any other 4xx shows `ApiError.message` verbatim: English, accepted for now, listed in the PR (overrides P15).

**Money-moving POSTs**
- These are deposit create, UTR / tx-hash claim, withdrawal, withdrawal cancel, demo reset and currency convert.
- Each one uses:
  - `timeoutMs: 15000`;
  - a busy flag that blocks a second tap;
  - **no automatic retry**.
- On timeout: refetch the affected queries and toast a translated "check Payments before trying again".

**Queries and invalidation**
- `invalidateMoney()` (T1a) invalidates `wallet`, `payments`, `ledger`, `payment` and `deposit-config`, then calls `refreshBootstrap(queryClient)`.
- Never invalidate `["bootstrap"]` directly.
- Payments, Withdraw and History refetch on focus (`useFocusEffect` from expo-router).

**Accounts**
- Payments, Deposit and Withdraw always act on the **LIVE** account: deposits credit LIVE, and `/api/v1/wallet` reports LIVE.
- History follows the account selected in the header (`resolveAccount(boot.accounts, prefs.accountId, boot.liveAccess)`).

**Tests and code layout**
- Pure logic lives in framework-free `.ts` files with vitest. `src/**/*.test.ts` is the only include, so no React Native imports in tested modules.
- Every task's Gate:
  - `pnpm --filter @asm/mobile test`
  - `pnpm --filter @asm/mobile typecheck`
  - `pnpm exec eslint apps/mobile`
  - Server tasks also: `pnpm --filter @asm/web test`, `pnpm --filter @asm/contracts test`, `pnpm --filter @asm/client-core test`, and `@asm/db` where touched.

**Native dependencies**
- Install with `pnpm --filter @asm/mobile exec expo install <pkgs>`.
- Add config plugins **by hand** to `app.config.ts`: `expo install` cannot edit a dynamic config.
- Write code against the installed version, and check its `build/*.d.ts`.
- Do not add `@shopify/flash-list`: use `FlatList` / `SectionList` (overrides P9, P1003, P1298).

**Server changes**
- They are additive.
  - New contract fields are nullable or have a `.default(…)`, so an app build talks to an older server and an older app to a newer one.
  - No Prisma migration in P3.
- Every route checks ownership with `getSession` and the existing actor helpers, and answers `{ error, code: "not_found" }` 404 for someone else's row.

**P4 compatibility**
- Keep these paths:
  - `/payments/deposit` (file `app/(tabs)/payments/deposit.tsx`)
  - `/account/verify`
  - `/account/notifications`
  - `/history?tx=d:<id>` / `w:<id>`
- P4's plan references them.

**Owner-only**
- These go in the report, not the code. The controller appends them to OWNER-TODO.md.
  - Maestro runs.
  - The real-UPI checklist.
  - Camera capture on a real phone.
  - Production env (`UPI_APP_BLOCKLIST`).
  - Native Hindi review of the new strings.

**Device checks (not code; list them in the PR)**
- 320dp and 360dp in Hindi:
  - Payments cover;
  - Deposit and Withdraw figures and CTAs;
  - History ledger;
  - Account rows.
- Font scale 1.3.
- The UPI app hand-off and return.
- The camera guide on a 16:9 and a 20:9 phone.
- The 3-button navigation bar under every flow CTA.

## T1 → split into T1a and T1b

### T1a (routes, tab bar, header, queries, history-model move)

**1. Routes**
- Move `app/(tabs)/payments.tsx` → `payments/index.tsx`, and `account.tsx` → `account/index.tsx`.
- Add `payments/_layout.tsx` and `account/_layout.tsx`:
  - `<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground }, animation: "slide_from_right" }} />`.
- Create **stub** route files, so typed routes compile for every link the later tasks add. Each renders `tabs.soon`, and later tasks replace them:
  - `payments/{deposit,withdraw}.tsx`, `payments/pay/[token].tsx`, `payments/claim/[id].tsx`
  - `account/{profile,verify,kyc-details,kyc-camera,currency,notifications,security,security-pin,language,support}.tsx`
- Keep the existing Log out button on `account/index.tsx` until T8a.

**2. Hidden tab bar on flow screens**
- New `src/ui/tab-bar.ts`: `tabBarHidden(route: { state?: { index?: number } }): boolean`. It returns `(route.state?.index ?? 0) > 0`.
- `BottomNav` returns `null` when it is true for the focused tab route.
- Tests: index screen → visible; pushed screen → hidden; no nested state → visible.

**3. Shared header on Payments, History and Account (I3)**
- New `src/trade/list-loaded-store.ts`: zustand `{ loadedFor: string | null; set(id) }`.
  - `trade.tsx` publishes the result of its existing `useAccountTradesLoaded` call into it.
  - Edit only that line plus the publish effect. Leave the resume and stale logic as it is.
- New `src/trade/TabHeader.tsx`:
  - It renders the same `TopBar` as Trade: account from `resolveAccount` with `useUserPrefs(boot.userId)`, `selectAccountType` as in `trade.tsx`, and `listLoaded = loadedFor === account.id || account.id === bootstrapTradesAccountId(boot.accounts)`.
  - Before bootstrap it shows `AppHeader` with `BrandMark` and a skeleton.
  - It never calls `useAccountTradesLoaded` (no extra `GET /api/trades`).
- Payments, History and Account use `<Screen bleedTop>` + `<TabHeader/>`.
- `TopBar.tsx:173` and `BonusSheet.tsx:72` navigate to `/payments/deposit`.

**4. Queries (replace P60-112)** in `src/api/queries.ts`
- `useWallet()`, `usePaymentsInfinite()` (cursor as P78-85), `useDepositConfig()`, `useWithdrawalPrefill()`.
- `useCheckout(token, { poll })`. T3a adds `poll`; T1a takes the token only.
- `useProfile()` with a new `ProfileViewSchema`:
  - Add it to `packages/contracts/src/account.ts` with exactly the `ProfileView` fields (`packages/db/src/repositories/profile.ts:4-24`).
  - `kycStatus` is the 4-value enum and `kycDocuments` is an enum array.
  - `GET /api/account` returns `{ profile }`: unwrap it.
- `invalidateMoney()` (see All tasks).
- No `useTickets` / `useLeaderboard` here: T8b adds tickets, and the leaderboard is dropped.
- Delete P96-105's loose record schemas.

**5. Move history-model to client-core (B4)**
- New `packages/client-core/src/history/history-model.ts` gets the pure parts of `apps/web/src/components/history/history-model.ts`:
  - `HistoryFilter`, `Tone`, `PaymentRow`, `HistoryItem`, `parseFilter`, `statusTone`, `paymentMovedNoMoney`, `durationLabel`, `itemMatchesFilter`, `groupByDay`, `dayLabel`, `paymentItem`, `tradePairName`;
  - `splitAssetName` (from `apps/web/src/lib/asset-name.ts`);
  - `referenceFor` (from `payment-rows.ts`).
- Move their tests with them.
- The web files re-export the moved names and keep the web-only parts: `TONE_PILL`, `paymentAmountText` / `tradeAmount` (`formatMinor`), and `FILTER_LABEL` / `EMPTY_COPY` / `statusLabel` (English copy).
- Export the module from `client-core/src/index.ts`.
- Also move the web's `QUICK` deposit amounts (`DepositFlow.tsx:20`) to client-core as `DEPOSIT_QUICK_INR = [500, 1000, 2000, 5000]`, and use it from the web.
- `pnpm --filter @asm/web test` must stay green.

**6. Status strings**
- Add `pay.status.<STATUS>` for every DepositStatus, WithdrawalStatus and TradeStatus value (copy the web labels: Credited, Processing, In review, On hold, …).
- Add `history.title.{deposit,withdrawal}`.
- App code translates; it never shows client-core's English.

**Dropped**
- Plan Step 4 (P364-366): Trade already uses `BONUS_TIERS` through `nextBonus`.
- Plan Step 2 (P116-252).

**Commit** (replaces P373-374): `feat(mobile): tab routes, shared header, money queries; move history model to client-core`.

### T1b (Passbook pieces + Payments tab), board **N-Payments**

**Primitives**
- **Tokens**: add the new tokens (All tasks) and their contrast tests to `tokens.test.ts`.
- **Icons**: add these lucide glyphs to `icon-glyphs.ts`, copying each path from the board's inline SVG:
  - navigation: `arrowLeft`, `arrowUpRight`, `check`, `badgeCheck`;
  - payments: `copy`, `timer`, `atSign`, `indianRupee`, `rotateCcw`;
  - KYC: `idCard`, `creditCard`, `scanFace`, `flashlight`, `image`;
  - account: `bell`, `shieldCheck`, `languages`, `lifeBuoy`.
- **Brand logos**: copy `apps/web/public/brand/{phonepe.jpg,gpay.png,paytm.png,upi.png,usdt.png}` to `apps/mobile/assets/brand/`.
  - Add `src/ui/brand-logos.ts` (method → `require`). It maps `PhonePe`, `Gpay`, `PayTM`, `UPI` and `USDT`, plus the `"any"` app → upi.
- **`Stamp` sizes** (P2 T4 carry; keep `sm` / `md` as they are):
  - `xs`: 8pt, 1.2pt single border, padding 1×4, no outline. N-History inline.
  - `lg`: 15pt, 2pt border, 1pt outline at 3pt offset, `rotate: "-7deg"`. N-Receipt.
- **`LedgerHeader` / `LedgerRow`**: optional `gap` (default 10), `padV` (default 10) and `headerSize` (default 10). The defaults leave `TradesSheet` unchanged.
- **New `src/ui` pieces:**
  - `BackHeader({ title, onBack?, icon: "arrowLeft" | "close", aside? })`: a 44×44 button and a 21/600 title with `flex: 1`. Used by every flow screen.
  - `IconTile({ size: 42 | 36, logo? | icon?, light? })`: a white tile for brand logos, a `raised` tile for icons.
  - `KeyValueBox({ rows })`: rows of a `flex: 1` label in ink3 and a `flexShrink: 0` value. N-Withdraw, N-Receipt and the detail sheet use it.
  - `ListState({ loading, error, empty, onRetry })`: skeleton rows, the empty text, or the message with a `secondary` Retry (`common.retry`).
  - `AmountFigure({ text, words, onPress?, testID })`:
    - the fitted 42px figure via `FigText` and `fitSize`;
    - a dashed rule (`DashedRule`);
    - the words at 16, ink2;
    - pressable (opens the amount sheet), `minHeight` 44.
  - `SettingsGroup` / `SettingsRow({ icon, title, value?, onPress })` for T8. Rows are `minHeight` 52.

**Payments screen** (`payments/index.tsx`, replaces P254-360), in board order:
- **Title.** `TabHeader`, then "Payments" 24/600 (padding 14/20/12).
- **Cover card** (radius 16, `coverRule` border):
  - The 160° `coverTop` → `coverBottom` gradient is drawn the way `AppHeader` draws its gradient (react-native-svg).
  - "LIVE ACCOUNT" at 11, tracking 0.1, `switchInk`; `BrandMark` 36 to its right.
  - The name in caps, 16/600, tracking 0.05:
    - profile `firstName lastName`;
    - else the nickname;
    - else the email's local part.
    - Uppercase it only when the name is Latin.
  - **No "A/c ending" line**: there is no account number.
  - The total: `money(real + bonus)` from the socket (`balances[live.id]`), else the wallet; fitted, base 34.
  - `Tricolour` 2pt.
- **Two rows** (15px), label `flex: 1` ink2, value `Money` 15/500:
  - "Can withdraw": the socket `realBalance`, else `wallet.withdrawable`.
  - "Bonus, for trading": `bonusBalance`, in gold.
  - **No bonus tier bar** (P287-296).
- **Buttons.** A 2-column grid: Deposit (`primary`, icon `plus`) → `/payments/deposit`; Withdraw (`secondary`, icon `arrowUpRight`) → `/payments/withdraw`. `minHeight` 52.
- **Pending payment row.** Slot only; T3a fills it.
- **Recent.** "Recent" 17/600 with a "See all" `accentText` link → `/history`. Then the first 5 rows of `usePaymentsInfinite` page 1:
  - Tile: `IconTile` 42. A deposit shows its method's logo on white; a withdrawal shows `atSign` / `creditCard` / `usdt` on `raised`.
  - Title: `t("history.title.<kind>")` 16/600.
  - Subtitle: `${methodLabel}, ${shortDate}` 13, ink3.
  - Right column: `Money` 14/600 (`+` up, `−` downText; ink3 when `paymentMovedNoMoney`) over a `Stamp sm`.
  - Tone: up → `up`, caution → `accent`, down → `down`, neutral → `muted`.
  - The row is `minHeight` 66; tapping it goes to `/history?tx=<key>`.
- **States.** `ListState` for loading, error and "No payments yet". `RefreshControl` (tint accent) refetches wallet + payments.
- **No LIVE account** (defensive): hide the cover and show the empty text.
- **Tests**: `statusStampTone` (pure, `src/payments/status-tone.ts`) and the cover-name helper.

## T2 (deposit), board **N-Deposit**

**Keypad (I1, replaces P213-252)**
- Extract the 4×3 grid from `KeypadSheet.tsx` into `src/ui/AmountKeypad.tsx` (`{ decimals, onKey, onClear }`). Keep the cells, `testID` `key-<k>` / `key-back`, the long-press clear and the a11y labels exactly.
- `KeypadSheet` renders it. Trade's behaviour, its tests and `e2e/login-trade.yaml` stay unchanged.
- New `src/payments/AmountSheet.tsx`: a `Sheet` titled "Amount" with the figure, words (INR), quick chips (deposit: `DEPOSIT_QUICK_INR`; withdraw: none), `AmountKeypad` and Done (`light`, `testID="keypad-done"`).
  - Keys go through client-core `applyKey(current, key, { decimals })`. Do not write `nextAmount`.

**`deposit-form.ts` (replaces P427-458)**
- `methodRows(config, rupees)` returns `{ method, state: "ok" | "soon" | "limit", limit: { kind: "min" | "max"; rupees: number } | null }`. It holds **no English text**.
  - The limits come from client-core `methodLimits`.
  - All five methods are listed (Paytm included: a reversible call, see Findings).
  - USDT is hidden when `usdtNetworks` is empty.
- `depositBody` (B3):
  - UPI → `{ method, amountInr: Math.round(rupees * 100) }`.
  - USDT → `{ method: "USDT", network, amountUsdtMinor: Math.round(inrToUsdt(rupees) * 100) }`.
  - Both parse through `CreateDepositSchema`.
- Tests (replace P398-422):
  - the order of the five methods;
  - UPI soon while off;
  - USDT hidden with no networks;
  - limits on ₹400 (UPI min) and ₹900 (USDT min ₹1,000);
  - `depositBody("PhonePe", 1000)` → `amountInr: 100000`;
  - `depositBody("USDT", 2000, "tron").amountUsdtMinor === 2000` and `("USDT", 1234, "bsc")` → `1234`.

**Screen** (`payments/deposit.tsx`, replaces P462-525), one screen in board order:
- `BackHeader` "Deposit".
- **Amount block.** "Amount" 14, ink3, then `AmountFigure`:
  - the figure: `₹ ${groupTyped(value, "INR")}`, or `₹ 0`;
  - the words: `amountInWords`;
  - tapping it opens `AmountSheet`. The sheet also opens on mount when the amount is empty.
  - The limit problem for the selected method shows under the words in `downText` 13, from keys (`deposit.min` / `deposit.max` with `money(rupees * 100, "INR", { trim: true })`).
- **Bonus row** (I7):
  - A box with `goldRule` border, `goldDim` background, radius 12, padding 12/14.
  - Left (`flex: 1`): `t("deposit.bonusRow", { nth, pct })` ("1st deposit bonus, 100%"; Hindi ordinal from i18n).
  - Right: `+money(bonusMinor(amount * 100, pct))` in gold.
  - `pct = bonusPercentForDeposit(config.completedDeposits + 1)`; the row is hidden when it is 0.
  - Under it, the disclosure: "Bonus is for trading only and can't be withdrawn." in ink2 13, plus a `text` "How it works" that opens `BonusSheet` (mount it in this screen). Not on the board, but required (memory bonus-marketing-posture).
- **"Pay with"** at 14/500, ink3. Then a radiogroup box (`surface`, `ruleSoft` border, radius 14). Per row:
  - `IconTile` 42 with the logo.
  - Title 16/600: PhonePe, Google Pay, Paytm, Any UPI app, USDT.
  - Subtitle 13, ink3: "Opens the app" / "Pick from your apps" / USDT "From ₹1,000"; or "Coming soon"; or the limit text.
  - A radio dot 22: `accent` 7pt border when selected, `rule` 1.5pt otherwise.
  - `accessibilityRole="radio"` with `checked`. Disabled rows use opacity 0.6. Rows are `minHeight` 66.
  - The default selection is the first `ok` row.
- **USDT with two networks.** Below the box, `Chip`s with each network's `USDT_NETWORK_INFO[n].shortLabel`. The gateway network is tagged "Recommended", as on the web (`UsdtAmountStep.tsx:122`).
- **CTA.** A bottom `primary` button: `t("deposit.payWith", { amount, method })` ("Pay ₹2,000 with PhonePe"), `testID="deposit-pay"`, disabled until valid, busy while posting. Padding `28 + insets.bottom`.
- **Create.** `POST /api/deposits` under the money-POST rule.
  - On success, call `savePendingCheckout(userId, { token, expiresAt: null })` and `router.replace(\`/payments/pay/${checkoutToken}\`)`.
  - `src/payments/pending-checkout.ts` is MMKV, per user, with a test.
- **Strings.** `deposit.*` in both files: `title`, `amount`, `tapToEnter`, `bonusRow`, `bonusNote`, `howItWorks`, `payWith`, `payWithHeading`, `opensApp`, `pickApp`, `from`, `comingSoon`, `min`, `max`, `recommended`, `nth1`–`nth4`.

## T3 → split into T3a and T3b

### T3a (UPI pay screen, polling, claim), board **N-UpiPay**

**Polling (B2, replaces P642-680 and P767)**
- No `useCheckoutPoll`. `useCheckout(token, { poll })` uses:
  - `refetchInterval: (q) => poll && !FINAL.has(q.state.data?.status ?? "") ? 4000 : false`
  - `refetchIntervalInBackground: false`
- `poll` = the screen is focused (a ref set in `useFocusEffect`) **and** AppState is `active`.
- On AppState `active`, call `refetch()` at once.
- `FINAL = COMPLETED | REJECTED | EXPIRED`.
- On reaching a final status:
  - call `invalidateMoney()` once;
  - call `clearPendingCheckout(userId)`;
  - on `COMPLETED`, `Haptics.notificationAsync(Success)`;
  - render T3b's `PayResult`.
- Claims use the deposit id (`view.id`). Never use the id for status.

**`upi-apps.ts`**
- Keep the plan's code and tests (P553-612), and add the optional third parameter `blocklist: readonly string[] = []` now. The T9 test row moves here.

**Manifest**
- Add `plugins/with-upi-queries.js` as in P616-640, and add it to `app.config.ts` plugins.
- Add `apps/mobile/plugins/*.js` to the CommonJS block in `eslint.config.mjs`.
- `android/` is gitignored: run `pnpm --filter @asm/mobile prebuild` and grep the manifest for the four schemes. Do not commit `android/`.

**Install** `expo-clipboard` and `react-native-qrcode-svg`. The QR library is pure JS on the installed `react-native-svg`.

**Pay screen** (`payments/pay/[token].tsx` + `src/payments/UpiPay.tsx`, replaces P682-743 and P747-784)
- **Header.**
  - `BackHeader` with `icon="close"`: `router.back()`, or `/payments` when there is nothing to go back to.
  - Title `t("pay.title", { amount: money(amountInr, "INR", { trim: true }) })`.
  - Aside: the countdown leaf (`timer` icon, Martian 14, gold `mm:ss` from `expiresAt`, `useNow` inside the leaf only).
- **QR.**
  - A 196 `paper` card (radius 14, padding 12) with `QRCode value={upiUri} size={172} color={color.ground} backgroundColor={color.paper}`.
  - Caption "Scan with any UPI app, or pay below" in ink2 14.
  - A VPA chip: a 40-high pill with a `rule` border, `vpa` in Martian 14, and the `copy` icon. It copies with `expo-clipboard` and toasts `pay.copied`.
- **App buttons.** Detected with `Linking.canOpenURL(PROBE[app])`, ordered with `orderUpiApps(installed, view.method, blocklist)`:
  - The first is a `primary` 54 "Open <App>" with its logo, or "Open UPI app" for `any`.
  - The rest go in a 2-column grid of `secondary` 50 buttons with logos ("Google Pay", "Other apps").
  - `Linking.openURL(upiAppUrl(app, upiUri))`. On failure, toast `pay.noApp`.
- **Status card** at the bottom (`surface`, radius 14): a ring (an svg arc of 30% `accentText` over `rule`) and the text:
  - `AWAITING_PAYMENT`: "Waiting for your payment. This updates by itself."
  - `PENDING_CONFIRMATION`: "We got your UTR. We'll confirm it shortly."
- **Claim link.** "I've paid, add my UTR", a `text` button in `accentText`, `minHeight` 52, `testID="pay-claim"`.
  - Revealed `manualClaimDelaySec` seconds after the screen mounted (the web pattern; no server change).
  - Hidden when `claimedUtr` is set or the status is not `AWAITING_PAYMENT`.
- **Pending checkout.** Update `expiresAt` in the pending-checkout store from the view.
- **Payments row.** Fill T1b's slot: while a pending checkout exists and `now < expiresAt`, Payments shows "Payment in progress · ₹x · Continue" → `/payments/pay/<token>` (I6).

**Claim screen** (`payments/claim/[id].tsx`, replaces P786-788): **UTR only, no screenshot** (I4)
- `BackHeader` "Add UTR".
- A numeric `Field` with `keyboardType="number-pad"`, validated with `ClaimUtrSchema` and a key-based message.
- Help text, and a `primary` Submit.
- `POST /api/deposits/:id/claim { utr }`:
  - 409 with `resolved: true` → `router.back()` (the pay screen shows the result);
  - any other 4xx → the message;
  - success → `invalidateMoney()`, then `router.back()`.

**Strings.** `pay.*` and `claim.*` in both files.

### T3b (result screens + receipt data), board **N-Receipt**

**Server (I5)**
- Add nullable fields to `CheckoutViewSchema`: `creditedAt`, `creditedMinor`, `creditedCurrency`, `bonusMinor`, `utr`.
- `checkoutViewFor` fills them from:
  - the deposit's `DEPOSIT` transaction (`refType "Deposit"`, `refId`, `amount > 0`): `createdAt`, `amount`, plus the account's currency;
  - the `BONUS_GRANT` transaction for the same `refId`;
  - `utr = claimedUtr ?? matched BankCredit.utr` (`Deposit.matchedCreditId`).
- Put them in a db helper with a test. Convert BigInt with a `Number.isSafeInteger` guard.
- Add a web route test for `/api/v1/checkout/[token]`. The web checkout page ignores the new fields.

**`PayResult.tsx` (replaces P745)**
- **COMPLETED**, per the board:
  - a 64 `up` circle with a `check` icon in `upInk`;
  - "Deposit credited" 24/600;
  - a `surface` card (radius 14, `ruleSoft`) containing:
    - a `Stamp lg` "Credited" at the top right;
    - "Amount" in ink3;
    - `Money` 34, fitted (`creditedMinor`/`creditedCurrency`, else `amountInr`/INR);
    - the words (INR only).
  - Then a perforation (two 18 `ground` half-circles plus a 2pt dashed rule).
  - Then a `KeyValueBox`:
    - Bonus, in gold (hidden when null or 0);
    - Paid with;
    - UTR, in Martian (hidden when null);
    - Date, `creditedAt` in Martian `dd Mon yyyy, HH:MM`.
  - Then another perforation, and "New balance": the LIVE total from the socket or wallet after `invalidateMoney`.
  - Bottom: `primary` "Start trading" → `router.navigate("/trade")`, and a `text` "Share receipt" (RN `Share.share({ message })` with amount, bonus, method, UTR, date and `referenceFor`).
  - Pad `insets.bottom`.
- **EXPIRED / REJECTED** (no board): the same frame with a `Stamp lg` `down` "Expired" / "Rejected" and the web copy (`app/(platform)/deposit/page.tsx:31-48`):
  - **UPI expired**: "if you already paid, it will still be credited, don't pay again". **No claim link**: the claim route accepts only `AWAITING_PAYMENT`.
  - **USDT gateway**: the gateway paragraph.
  - **USDT non-gateway**: the paragraph plus "Already sent it? Submit your transaction" → the T4 tx-hash claim (`usdt-claim` accepts EXPIRED).
  - **REJECTED**: "This deposit was not approved" plus `text` "Contact support" → `/account/support`.
  - The `primary` is "New deposit" → `router.replace("/payments/deposit")`.

## T4 (USDT pay; no board, built in N-UpiPay's frame)

**Pure**
- Keep `usdtAmountText` + test (P812-836).
- `networkLabel` uses `USDT_NETWORK_INFO[n].shortLabel` ("TRON (TRC-20)"); the field names are confirmed.

**`UsdtPay.tsx`**
- Header: `BackHeader` close, "Pay 20.00 USDT", the countdown aside.
- The `paper` QR of `receivingAddress`.
- A network pill, plus a `warnBg` box: "Send only on TRON (TRC-20)".
- An address chip: Martian 13, two lines, with copy. An amount chip with copy.
- `isSlot`: "Send exactly 20.00 USDT" (emphasised).
- **Status card:**
  - `isGateway`: "We'll detect your payment automatically".
  - Otherwise: "Waiting for your payment".
- **Non-gateway** gets the claim link → `payments/claim/[id]?kind=usdt`:
  - the same screen with a tx-hash `Field` (`ClaimUsdtPaymentSchema` with key-based messages);
  - `POST /api/deposits/:id/usdt-claim { txHash }` (money-POST rule);
  - 409 → the message.
- Polling, result and pending handling are T3a / T3b's.

## T5 (withdraw), board **N-Withdraw**

**Keep** `withdraw-form.ts` + tests (P867-913). The field names are confirmed against `packages/contracts/src/withdrawal.ts`. Add:
- `maxWithdrawMinor(withdrawable, currency)`: `min(withdrawable, withdrawalLimitsMinor(currency).max)`, floored to whole units on INR.
- `initialPayout(prefill, method)`: the last payout for that method; Bank holder defaults to `kycName`.
- `payoutIssueKey(issues)`: zod path → i18n key.
- Tests for all three.

**Screen** (`payments/withdraw.tsx`, one screen, replaces P917-927)
- **`BackHeader` "Withdraw".**
- **KYC gate** (`prefill.kycStatus !== "VERIFIED"`), replacing the form below the header:
  - Title "Verify your identity to withdraw" and body.
  - `primary` "Verify identity" → `/account/verify`, `testID="withdraw-verify"`.
  - PENDING: "Your documents are under review", no button.
  - REJECTED: "Your verification needs another look", plus the button.
- **Held withdrawals.** One box per `prefill.heldWithdrawals` item: "₹x on hold", with a `text` Cancel in `downText` → `Alert.alert` confirm → `POST /api/withdrawals/:id/cancel` (money-POST rule; a 4xx shows the server message, e.g. the window has passed) → `invalidateMoney()`.
- **Amount.**
  - A row: "Amount" 14 ink3, and on the right "Max ₹8,200" (`accentText` 14/500 text button: `maxWithdrawMinor`).
  - `AmountFigure` 42 → `AmountSheet` (INR integer; USD decimals).
  - The words (INR).
  - "₹700 to ₹50,000 per withdrawal" 13, ink3 (`withdrawalLimitsMinor` + `money(…, { trim: true })`).
  - The problem line in `downText`: `withdraw.min` / `max` / `balance`.
- **"Send to".** `Chip`s for Bank / UPI ID / USDT (`role="radio"`, height 40), starting on `prefill.initialMethod ?? "UPI"`.
- **Fields** (`Field`, labels above):
  - UPI: UPI ID, with a trailing `badgeCheck` when valid.
  - Bank: holder, account number (`number-pad`), IFSC (`autoCapitalize="characters"`).
  - USDT: network chips (TRC-20 / BEP-20) and the address.
  - "Filled in from your last withdrawal" 13, ink3, while the value equals the prefill.
  - Wrap the screen in `FormScroll`.
- **Summary.** A `KeyValueBox` above the CTA:
  - "You receive" → `Money`.
  - "Usually arrives" → **"5–10 hours after review"** (`withdraw.eta`). The web's copy; overrides P923's 24 hours.
- **CTA.** `primary` `t("withdraw.submit", { amount })` ("Withdraw ₹5,000"), disabled while invalid. **No separate confirm step**: the board repeats the amount on the button.
- **Submit.** `POST /api/withdrawals { accountId: live.id, amount, payout }` under the money-POST rule. On 201:
  - `invalidateMoney()` and invalidate `withdrawal-prefill`;
  - toast "Withdrawal requested" (or "on hold" when `status === "HELD"`);
  - `router.back()`, then `router.navigate({ pathname: "/history", params: { tx: \`w:${id}\` } })` (opens the T6b detail sheet).
  - There is no socket balance setter, so `refreshBootstrap` carries the new balance.
- The 2FA note at P19 and P1385 stays true: there is no withdrawal 2FA step.

## T6 → split into T6a (server) and T6b (app)

### T6a (ledger and payment routes), server only

**Contracts** (`packages/contracts/src/app.ts`)
- `LedgerRowSchema`:

```ts
z.object({
  id: z.string(), at: z.string(), kind: z.enum(["DEPOSIT","WITHDRAWAL","TRADE_STAKE","TRADE_PAYOUT","TRADE_REFUND",
    "BONUS_GRANT","BONUS_CONVERT","DEMO_RESET","CURRENCY_CONVERT","AFFILIATE_RESET"]),
  amountMinor: z.number().int(),           // signed: debit < 0 < credit
  balanceAfterMinor: z.number().int(),
  ref: z.discriminatedUnion("type", [
    z.object({ type: z.literal("trade"), tradeId: z.string(), symbol: z.string(), direction: z.enum(["UP","DOWN"]),
      durationSec: z.number().int(), status: z.enum(["OPEN","WON","LOST","REFUNDED"]) }),
    z.object({ type: z.literal("deposit"), key: z.string(), methodLabel: z.string(), status: z.string() }),
    z.object({ type: z.literal("withdrawal"), key: z.string(), methodLabel: z.string(), status: z.string() }),
  ]).nullable(),
})
```

- `LedgerPageSchema = { currency, rows, nextCursor: string | null, endsAtCurrencyChange: boolean }`.

**`GET /api/v1/ledger?accountId=&filter=all|trades|deposits|withdrawals&limit=30&cursor=`**
- **Ownership.** `getAccountForActor(session.userId, accountId)`, else 404.
- **Order and cursor.**
  - Rows come from `Transaction` for that account, ordered `createdAt desc, id desc`.
  - The cursor is opaque (`${createdAtISO}_${id}`), with a strict before-comparison on the pair.
  - `limit` is clamped to 1–50.
- **Filter.** By `refType`: Trade / Deposit / Withdrawal.
- **Currency boundary.**
  - Find the newest row with `kind === "CURRENCY_CONVERT"` or `refType === "CurrencyChange"` (the legacy path). Return rows down to it, **including it**.
  - Then `nextCursor: null` and `endsAtCurrencyChange: true`.
  - Reason: Transaction amounts have no currency and are not converted, so older rows are in the old units.
- **Currency.** Every returned row is in `account.currency`.
- **Joins.** Join refs in batch queries (no N+1):
  - trades: `symbol`, `direction`, `durationSec`, `status`;
  - deposits and withdrawals: the existing `depositRow` / `withdrawalRow` mappers (`load-payment-rows.ts`) for `methodLabel` and `status`.
- **BigInt → Number** with a `Number.isSafeInteger` guard (memory engine-int32-overflow).
- **Tests**, in the style of `apps/web/src/app/api/v1/payments/route.test.ts`:
  - ownership 404;
  - paging stability with equal timestamps;
  - each filter;
  - stopping at a convert row;
  - signed amounts;
  - the ref join.

**`GET /api/v1/payments/[key]`** (`d:<id>` | `w:<id>`)
- Returns one `PaymentRowSchema` via the same mappers, with ownership checked.
- A bad key → 400 `bad_request`. Not found → 404 `not_found`.
- Tests.

**Commit**: `feat(api): ledger and single-payment routes for the app history`.

### T6b (History tab + payment detail), boards **N-History**, **N-PaymentDetail**

**Queries**
- `useLedger(accountId, filter)`: `useInfiniteQuery`, key `["ledger", accountId, filter]`.
- `usePayment(key)`: key `["payment", key]`.

**Pure helpers** (`src/history/ledger-view.ts` + tests; replaces P948-997):
- `ledgerSections(rows, now)`: day groups, by the IST day (`startOfDayMs(…, "Asia/Kolkata")`, the same day as the header's today line). Labels are "Today, 14 Oct" / "Yesterday" / "12 Oct", built from i18n month names.
- `particulars(row, assets)` returns `{ titleKey, titleVars, subKey, subVars, stamp }`:
  - TRADE_STAKE → `${pair}, ${Up|Down}` with sub "Stake, 1m"; for a LOST trade, "Lost, 30s"; for an OPEN one, "Open, 1m".
  - TRADE_PAYOUT → "Won, 1m".
  - TRADE_REFUND → "Refunded".
  - DEPOSIT → "Deposit" with `methodLabel` and a status stamp.
  - BONUS_GRANT → "Deposit bonus".
  - WITHDRAWAL → "Withdrawal" with a status stamp.
  - DEMO_RESET / AFFILIATE_RESET → "Balance reset".
  - CURRENCY_CONVERT → "Currency changed".
  - `pair` comes from `tradePairName` with the bootstrap asset `displayName`; `durationLabel` gives the length.
- `ledgerFigure(minor, currency)`: `money(Math.abs(minor), currency)` with the symbol stripped. Add a `{ symbol: false }` option to `money()`, with a test.

**Screen** (`app/(tabs)/history.tsx`, replaces P1001-1037)
- **Header.** `TabHeader`, then "History" 24/600.
- **Filter chips.** All / Trades / Deposits / Withdrawals (`Chip` height 40, `role="tab"`, `testID="history-filter-<f>"`), starting from `parseFilter(params.filter)`.
- **Table.** A `SectionList` with `LedgerHeader`: Particulars, Debit, Credit, Balance; `headerSize` 9.5, `gap` 6.
  - Columns: `flex` / 64 / 64 / 78.
  - Below 380dp (`isCompactWidth`): 56 / 56 / 70, gap 4.
- **Section headers.** Full width, 13/600, ink2, padding 12/0/2.
- **Rows** use `LedgerRow`, `padV` 9:
  - Particulars: title 15/600, and a sub at 12 ink3 with a `Stamp xs` for payments.
  - Debit: `downText`. Credit: `up`. Balance: ink.
  - Figures are ASCII `Txt font="fig"` at 11/500, tracking −0.03, single line with auto-fit (All tasks).
- **Taps.** Payment rows and bonus rows (deposit ref) open the detail sheet. Trade rows are not tappable, as on the board.
- **Paging and refresh.** `onEndReached` → `fetchNextPage`. Pull to refresh. Refetch on focus and after `invalidateMoney`. `ListState` for skeleton, empty (copy per filter) and error.
- **Footer.** When `endsAtCurrencyChange`: "Earlier entries are in your previous currency and aren't shown."
- **Account.** History follows the header's account. Changing the account resets the list.

**Detail sheet** (`src/history/DetailSheet.tsx`, replaces P1007-1009)
- A `Sheet` with `snapPoints={["82%"]}`.
- Heading row: the title (`flex: 1`) and a `Stamp sm`.
- `Money` 34, fitted. "To <destination>" / "via <method>" in ink2 14.
- **Timeline** (`src/history/Timeline.tsx`), from client-core `timelineSteps(kind, status)`; titles from `timeline.<id>.title` and details from keys.
  - Dots are 14: done = `up` fill; current = 2pt `accentText` ring; todo = `rule` ring; ended = `downText` fill.
  - The connector is 2×44: `up` when the next step is done, `rule` otherwise.
  - Times (Martian 12, ink3) appear on the first step only (`createdAt`) and, for deposits, on the last done step (`updatedAt`).
  - The server has no per-step times (accepted difference; see Findings).
- **Facts.** A `KeyValueBox`:
  - Reference: `referenceFor`, in Martian, with copy.
  - Method.
- **Cancel withdrawal** (`secondary`, label in `downText`), **only** when `status === "HELD"` and `now < cancelableUntil`. It follows T5's cancel flow and then refetches the payment.
- **Data.** `usePayment(key)`, so a deep link or an old row needs no paging (replaces P1035).

**Deep link**
- When the `tx` param is set, open the sheet once, then `router.setParams({ tx: undefined })` so the same link can open it again.
- A deep link arriving while locked lands on Trade after unlock (existing owner question). Accepted.

## T7 → split into T7a (pure + native) and T7b (screens)

### T7a

**`compress.ts` (I13; replaces P1112-1124 and its tests)**
- `ATTEMPTS = [[1600,0.85],[1600,0.7],[1280,0.7],[1024,0.6],[800,0.55]]`, mirroring `apps/web/src/lib/shrink-image.ts`.
- `compressWith(run)` returns the first result ≤ 900,000 bytes, **else `null`**. The screen then says "Photo too large, please retake" and never uploads.
- Tests: stops at the first fit; `null` when nothing fits; the order of attempts.

**`compress-native.ts`**
- `compressForUpload(uri, width, height)`. It is the one signature (M3).
- Resize by the long side to `maxSide` with the SDK 57 `expo-image-manipulator` API (check `build/*.d.ts`).
- Size from `expo-file-system`'s `File(uri).size`.

**`kyc-flow.ts`**
- Add `KYC_IDENTITY_FIELDS = ["firstName","lastName","dateOfBirth","aadhaar","pan","address","country"]` to `packages/contracts/src/account.ts`.
- Add a drift test in `@asm/db` against `IDENTITY_FIELDS` (`profile.ts:34`); export it from db if needed.
- `detailsComplete(profile)`: every field is non-empty.
- `nextKycStep` as P1150-1153.
- `KYC_GROUPS` for the UI: details, aadhaar (FRONT then BACK), pan, selfie.
- Tests as P1091-1106, plus `detailsComplete`.

**`upload.ts`**
- As P1156-1167, with `timeoutMs: 30000`.
- 413 / 400 show the server message.

**Install, plugins and permissions (I10)**
- `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`.
- `["expo-camera", { cameraPermission: "<P1247 text>", recordAudioAndroid: false }]`.
- `["expo-image-picker", { photosPermission: "<text>", cameraPermission: false, microphonePermission: false }]`.
- `android.permissions` += `android.permission.CAMERA`. `blockedPermissions` += `android.permission.RECORD_AUDIO`.
- After prebuild, check the merged manifest has CAMERA and none of RECORD_AUDIO or READ/WRITE_EXTERNAL_STORAGE.
- `launchImageLibraryAsync` uses Android's photo picker, so it needs no storage permission.

### T7b (verify flow), boards **N-Kyc**, **N-KycCamera**

**`account/verify.tsx`** (replaces P1249-1261), per **N-Kyc**:
- `BackHeader` "Verify your identity", then the intro 16 ink2 ("Needed once, before your first withdrawal. Takes about 3 minutes.").
- Four step cards (radius 14, padding 14, gap 10):
  - Your details;
  - Aadhaar, front and back;
  - PAN card;
  - Selfie.
- Card states:
  - done: `up` 40 tile with `check` in `upInk`;
  - current: `accent` border, `accentDim` background, `accent` tile, subtitle "Next" in `accentText`;
  - todo: `ruleSoft` border, `raised` tile, ink2 icon.
- The bottom `primary` follows the next step: "Add your details" / "Photograph Aadhaar" / "Photograph Aadhaar back" / "Photograph PAN card" / "Take a selfie" / "Submit for review".
- **Submit.** `POST /api/account/kyc/submit` → refetch the profile. A 400 shows its message (`missingFields` / `missingDocuments`); a 409 shows its message.
- **States:**
  - VERIFIED: `Stamp lg` `up` "Verified", "Withdrawals are unlocked", and `primary` "Withdraw" → `/payments/withdraw`.
  - PENDING: `Stamp lg` `accent` "In review", plus the web copy ("usually within 24 hours"). **No date**: `kycSubmittedAt` does not exist (P1254).
  - REJECTED: `kycReviewNote`, and "Start again" makes the steps editable. Re-uploading replaces documents.

**`account/kyc-details.tsx`**
- `FormScroll` with `Field`s in `KYC_IDENTITY_FIELDS` order:
  - date of birth as `YYYY-MM-DD` with a hint;
  - Aadhaar `number-pad` (12);
  - PAN `characters`;
  - address multiline;
  - country defaults to "India".
- Validate with `UpdateProfileSchema`, using key-based messages.
- `PATCH /api/account`, then back.

**`account/kyc-camera.tsx?kind=`**, per **N-KycCamera** (replaces P1171-1245):
- A full-screen black screen with a light status bar.
- **Top row**, at top 36 + safe area: close, the title ("Aadhaar, front" etc.) and a torch button (documents only).
- **Document guide.**
  - Insets 28 left and right, aspect 1.586, radius 14, a 2pt `rgba(255,255,255,0.88)` border.
  - Saffron corner brackets: 26×26, 4pt, radius 12, offset −4.
  - A 0.62 scrim drawn as four rects around the hole: RN has no 999 box-shadow.
- **Selfie.** Front camera, an oval 220×290, no torch.
- **Hint** in `cameraInk` 16, centred under the guide.
- **Bottom bar.** Gallery (`image` icon + label, 64 wide), the shutter (78 ring, 4pt white, inner disc), and a 64 spacer. Padding `20 / 34 + insets.bottom`.
- **Preview.** The image at `contain`, `primary` "Use photo" and `secondary` "Retake".
- **Use photo.** `compressForUpload` → `uploadKycDocument` ("Uploading…" busy; error plus Retry) → refetch the profile → back.
- **Permissions.** Denied: "Allow camera" while `canAskAgain`, else `Linking.openSettings()`. Gallery is always offered.
- Drop the plan's local review thumbnails (not on any board).

## T8 → split into T8a, T8b and T8c

### T8a (account hub, profile, language, notifications stub, demo reset, log out), board **N-Account**

**`account/index.tsx`** (replaces P1287), in board order:
- **Header.** `TabHeader`.
- **Identity block** (pressable → `/account/verify`):
  - avatar: a 52 circle on `raised`, initials 20/600;
  - name 20/600;
  - email 14 ink2;
  - KYC stamp `sm`: VERIFIED `up` "KYC verified"; PENDING `accent` "KYC in review"; REJECTED `down` "KYC rejected"; NOT_STARTED `muted` "KYC not done".
- **Groups** (`SettingsGroup`, header 14/500 ink3):
  - **Account**:
    - Profile → `/account/profile`.
    - Currency, valued with the LIVE account's currency → `/account/currency`.
    - Reset demo balance → `Alert` confirm → `POST /api/account/demo-balance { accountId: demo.id }` (money-POST rule) → `refreshBootstrap` + toast.
  - **App**:
    - Notifications → `/account/notifications`.
    - Security and app lock, valued "Fingerprint" / "PIN" / "Off" from `useLock` → `/account/security`.
    - Language, valued with the current language's name in its own script → `/account/language`.
  - **Help**: Support → `/account/support`.
- **Dropped from P3** (Findings): Leaderboard, Legal & guides, demo amount choices, the separate `demo.tsx`.
- **Log out**: a `text` Button under the Help group → `Alert` confirm → `useSession.getState().signOut()`. Do not add `useLock.reset()` (P1287); the next sign-in's `startFreshSession` owns that.

**`account/profile.tsx`** (P1291)
- `Field`s.
- The nickname is always editable.
- The identity fields are read-only, with a note, while PENDING or VERIFIED.
- Aadhaar is shown masked (`•••• •••• 1234`).
- `PATCH`. A 409 shows its message.

**`account/language.tsx`** (replaces P1296)
- Two radio rows, English and हिन्दी, each in its own `script`. The `LanguageSwitch` logic: `saveLocale` + `setLocale`.
- **No PATCH**: L1 already syncs it.

**`account/notifications.tsx`**
- A stub: "Notifications arrive in the next update".
- P4 replaces it and builds **N-Notify**, which is P4's board.

### T8b (security, support)

**`account/security.tsx`** (B5, replaces P1295)
- An "App lock" `Switch` (track `accent`).
- **Turning it on** with no method → `/account/security-pin?mode=set`, or `enableBiometric()`.
- **Turning it off** → re-verify in place: `unlockWithBiometric()` when the method is biometric, else `/account/security-pin?mode=verify`. Then `disable()`.
- "Change PIN" (method pin) → `mode=set` after a `verify`.
- "Use fingerprint" → `enableBiometric()`.
- **Never** navigate to `/lock` or `/lock-setup`.
- **No 2FA toggles**: the server never enforces them, and the code goes to the log.

**`account/security-pin.tsx`**
- `PinBoxes` + `PinPad`.
- `mode=set`: enter, confirm, `setPin`.
- `mode=verify`: `verifyPin`. `"wrong"` → message; `"logout"` → the store has already signed out.
- Pad `insets.bottom`.
- Add a pure `security-flow.ts` (on/off/change decisions) with tests.

**`account/support.tsx`** (P1297)
- WhatsApp / Telegram buttons when `useAppConfig().data.support.*` is set.
- An FAQ accordion from i18n `support.faq.<n>.{q,a}`. The English copy comes from contracts `FAQ`, and Hindi is translated.
- **Fix `FAQ[0]` in contracts too** (M11): drop "choose a method you have already deposited with" and say "choose Bank, UPI or USDT".
- The tickets list: `useTickets()` with a `TicketSchema` in `packages/contracts/src/support.ts`, its fields copied from the `listTicketsForActor` select.
- "New ticket": a `Sheet` with subject and body `Field`s (`CreateTicketSchema`, key-based messages) → `POST /api/support` → refetch.

### T8c (currency switch + stale-currency guard): owner question folded in (I9)

**Contracts** (`packages/contracts/src/trade.ts`)
- `OpenTradeSchema = z.strictObject({ ...tradeRequestShape, currency: z.enum(["INR","USD"]).optional() })`.
- Do **not** add it to `tradeRequestShape`: `EngineOpenTradeSchema` stays as it is.
- Tests:
  - a body without currency is still valid;
  - one with currency is valid;
  - unknown keys are still rejected;
  - the engine schema rejects `currency`.

**Server** (`apps/web/src/app/api/trades/route.ts`)
- After `getAccountForActor`, when `parsed.data.currency && parsed.data.currency !== account.currency`, return 409 `{ error: "Your account currency changed. Check your stake and try again.", code: "currency_changed" }`.
- Strip the field before calling the engine: `const { currency: _c, ...order } = parsed.data; engineOpenTrade({ ...order, actorId })`.
- Route tests: mismatch → 409, match → 201, absent → 201.

**Web**
- `components/trade/TradeTicket.tsx` sends the account's currency, so the website's own two-tab race closes too.

**App**
- `buildOpenTradeBody({ …, currency })` takes the selected account's currency.
- `trade-errors.ts`: `currency_changed: "trade.currencyChanged"`.
- On that code: `refreshBootstrap(queryClient)`. **Never resend.**
- Tests in `trade-request.test.ts` and `trade-errors.test.ts`.

**`account/currency.tsx`** (replaces P1292)
- Two rows, Demo and Live, each with its currency.
- A `secondary` "Switch to USD" / "Switch to INR" per account, with a preview: `t("currency.preview", { from: money(total, cur), to: money(convertMinorBetween(total, cur, next), next) })`.
- `Alert` confirm → `POST /api/account/currency { accountId, currency }` (money-POST rule). A 409 shows the server message.
- Success → `invalidateMoney()`.
- **No** `ACCOUNT_CURRENCIES` mirror is needed (P1292): use `["INR","USD"]` from the contract enum above.

## T9 (E2E, UPI checklist, UPI app blocklist)

**Flows** (replace P1321-1343)
- Write `e2e/deposit.yaml`, `e2e/withdraw-kyc.yaml` and `e2e/history.yaml` in the P2 pattern:
  - `runFlow: subflows/open-dev-client.yaml`, then `enter-pin`;
  - `id:` selectors.
- testIDs: `deposit-pay`, `deposit-method-<Method>`, `pay-claim`, `withdraw-verify`, `history-filter-<f>`, `keypad-done`, `key-<k>`.
- Add rows to the `e2e/README.md` table.
- **Do not run them**: Maestro is not installed; owner-only (replaces P1373).

**Checklist**
- Write `docs/mobile-upi-checklist.md` as P1349-1367.
- Filling it in needs a real phone and real payments: owner-only (M9).

**Blocklist**
- `AppConfigSchema.upiAppBlocklist: z.array(z.enum(["phonepe","gpay","paytm"])).default([])`.
- `appConfigFromEnv` parses `UPI_APP_BLOCKLIST` (comma-separated, unknown names dropped), with web tests.
- `UpiPay` passes it to `orderUpiApps` (the parameter is from T3a).
- Add `UPI_APP_BLOCKLIST=` to `.env.example`.

## Findings the controller could not settle (owner to confirm in the PR; the defaults are built)

1. **History as a real passbook (B4).**
   - The board's running Balance needs the new server ledger route (T6a), which reads `Transaction.balanceAfter`.
   - The ledger shows only money that moved. Pending or expired deposits appear on Payments and in their detail, not in History.
   - History stops at the last currency change (older ledger rows are in the old units).
   - Fallback if the owner prefers no server change: the plan's merged trades + payments list, without the Balance column.
2. **Stale-currency guard in P3 (T8c),** including the website's TradeTicket. This answers the OWNER-TODO item from 2026-10-20 (final review).
   - A trade-POST idempotency key (P2 fix-G carry) is **not** in P3; it needs engine work.
3. **Payout time.** The board has `[YOUR PAYOUT TIME]`. The app shows the web's "5–10 hours after review". The OWNER-TODO line saying "24 hours" is out of date.
4. **Account hub follows the board.**
   - Leaderboard, Legal & guides and the 2FA toggles are dropped; the 2FA toggles are not enforced on the server.
   - Log out is a text button under Help. It is not drawn on the board.
5. **Payments cover.**
   - No "A/c ending ####": the app has no account number.
   - The name is the KYC name, then the nickname, then the email.
6. **Paytm is offered** as a deposit method (the server and the web offer it) although the board shows PhonePe, Google Pay, Any UPI app and USDT.
7. **No screenshot proof** on a UPI claim. Cloudinary is not configured in production, and the board shows UTR only.
8. **Bonus disclosure line** on Deposit ("for trading only, can't be withdrawn", plus "How it works"). It is not on the board, but required (bonus-marketing posture).
9. **Payment in progress after a relock.** P3 adds the Payments "Continue" row only. The general "return to the tab you were on after unlock" stays the open OWNER-TODO question.
10. **Detail timeline times.** Only "Requested" or "Started" (and a deposit's last update) has a time. Withdrawals have no `approvedAt` / `paidAt`, and adding them would mean a migration.
11. **Withdraw has no confirm step.** The amount is on the button, as on the board.
12. **Native Hindi review** of the P3 strings; owner-only, as before.
- Note: the memory file `sms-relay-status.md` named in MEMORY.md is missing. Whether UPI deposits are on in production is unknown. The app reads `upiEnabled` at runtime.
