# Mobile P2 Restyle ("Passbook") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every Plan-2 screen of the IndianxTrade Android app (auth, lock, lock setup, gate screens, tab shell, Trade screen with its sheets, strip and toasts) to the owner-approved "Passbook" design canvas, without changing any behaviour.

**Architecture:** A new token layer (`src/theme/tokens.ts`: Passbook palette, gradients, radii) plus bundled fonts (Anek Latin, Anek Devanagari, Martian Mono via `expo-font`) feed a script-aware `Txt` primitive. Shared primitives (`Chip`, `Stamp`, `Ledger`, `Money`, `Tricolour`, `AppHeader`, `BottomNav`, `PinBoxes`) live in `src/ui` / `src/lock` so Plan 3 reuses them. Money text goes through one mobile-only formatter (`src/money/format.ts`, Indian digit grouping for INR) and an amount-in-words helper (`src/money/words.ts`). Each task migrates a set of screens from the legacy token aliases to the new names; the last task deletes the aliases so `tsc` proves nothing was missed.

**Tech Stack:** Expo SDK 57, React Native 0.86, expo-router (js-tabs), TypeScript strict, `expo-font` + `@expo-google-fonts/{anek-latin,anek-devanagari,martian-mono}`, `@shopify/react-native-skia` 2.6.2 (Up/Down button art blend, chart), `react-native-svg` (gradients, sparkline, hairlines), `@gorhom/bottom-sheet`, vitest (pure modules only, Node env).

**Branch / worktree:** `claude/mobile-p2-shell-trade`, `/Users/solminde/Developer/Personal/AMScoins/asmtrading/.claude/worktrees/mobile-p2`. In every command below, `W` means that absolute path.

---

## Source of truth and provenance (read once)

- **Design canvas** (owner hand-edits it): https://claude.ai/artifact/XUsig5HrPUY12P4PnLF92t, published from the owner's *other* Claude account, so it is **not readable** from the account that wrote this plan (Artifact read: "not found"). The proposal artifact https://claude.ai/artifact/TceTk68TDHc7XGs3QavP9Z is in the same state.
- The canvas source was recovered from the session that built it (e391f361) and is committed with this plan at `docs/design/passbook-canvas-2026-10-14/`:
  - `Main.dc.html` = "After · Trade", refreshed from the live canvas in 2495f9a and 0f9871d (2026-10-14), **after** the owner's edits (bull `left: 105px`, header 51px, no words on Trade, bear in a 59×68 box). Authoritative.
  - `A-*.dc.html` (After boards), `N-*.dc.html` (P3/P4 boards), `B-*.dc.html` (Before), `canvas.json` = the session's last push (19:06–20:35). The owner's later hand-edits, if any, to boards other than Main are **not** captured. The device verifier should compare against the live canvas (owner's browser) when possible and report differences.
  - `proposal.html` = the written proposal (rationale; some details superseded: it still has amount-in-words and a "Demo balance" label on Trade, both removed by the owner).
- **Art and logo files** (the canvas `/_blob/...` ids could not be downloaded; the original files were recovered by byte size from the upload log of session e391f361 and committed unconverted):
  - Bull "B3 bust" (blob `546c8b56a4498f5d7373702ecfc9b839`, 114280 bytes, 380×513, alpha): `apps/mobile/assets/art/source/bull-b3-bust.webp`
  - Bear "R1 swipe" (blob `93906df2a5f21946cbfb1e9bf0884851`, 110684 bytes, 380×510, alpha): `apps/mobile/assets/art/source/bear-r1-swipe.webp`
  - IXT mark (blob `40f1bea26f0ddf24fe030e4d6066788c`, 175×120, alpha): `apps/mobile/assets/brand/source/mark.webp`
  - Wordmark (blob `d570ba0573204578048b1dc5a8e18e85` was a 520×171 black-ground webp); use the higher-resolution identical artwork `apps/web/public/brand/indianxtrade-wordmark-dark.png` (1254×410, black ground). The "alpha" wordmark variant in the scratchpad lost its chrome letters; do not use it.
  - Task 4 and Task 6 convert these with `cwebp` (installed at `/opt/homebrew/bin/cwebp`, libwebp 1.6.0; it accepts webp and png input — verified).

## Owner decisions (fixed)

- Passbook direction approved. Keep the logo and a little of the old theme (dark ground, blue accent). Feel: chart-first trading platform + Indian fintech trust. App only; the website is unchanged.
- Compact header: one 51pt row under the status bar (IXT mark, Demo/Live switch, balance with "+₹x today" above it, square Deposit button), navy gradient, saffron glow, tricolour hairline. No bell. The status-bar area stays (the gradient runs under it).
- No amount-in-words on the Trade screen. Allowed on the keypad sheet (and in P3 deposit/withdraw).
- Bottom nav 48pt.
- Up/Down art: bull B3 bust + bear R1 swipe, overlay blend at opacity **1.0**; bull at `left 105, top −3, height 88` in the 176-wide canvas button; bear in a 59×68 box at `right −1, bottom −5` with object-fit cover and object-position 49.58% 73.22%.
- Accepted but must be flagged for owner confirmation in the PR body: Indian digit grouping, bundled fonts (real size below), "Up/Down" labels instead of "Buy/Sell".

## Decisions this plan makes (and why)

1. **Engraved-art blend: Skia, not pre-composited images.** RN 0.86 has `mixBlendMode` (new arch), but Android only applies it from API 29 and minSdk is 26; Skia gives the same overlay on every device. Each Up/Down button draws its gradient and the art in one small Skia `<Canvas>` with `<Image blendMode="overlay" opacity={1}>`. Skia's `overlay` is the same W3C formula the canvas used, so the result matches exactly at every button width; a pre-tinted PNG could only approximate it because overlay depends on the gradient pixel underneath, which shifts with button width. Skia 2.6.2 is already installed and the chart already uses it; two tiny static canvases cost nothing per frame.
2. **Fonts load at runtime with `expo-font`'s `useFonts`**, gated in the Gatekeeper so the native splash hides only after fonts are ready (4 s failsafe unchanged). `expo-font`'s native module is already autolinked through `expo` (verified with `expo/bin/autolinking search`), so **no dev-client rebuild** is needed. Static weight files come from `@expo-google-fonts/*` (Google Fonts, OFL-1.1) imported per weight (`/400Regular` subpaths) so only the chosen files are bundled.
3. **Bundled weights** (canvas weights 620/650 map to SemiBold): Anek Latin 400/500/600 (≈111 KB each), Martian Mono 400/500/600 (≈48 KB each), Anek Devanagari 400/600 (≈414 KB each; Medium maps to Regular in Hindi). Total ≈ **1.31 MB raw**, not the ~300 KB first quoted (Devanagari is the bulk; subsetting to Devanagari + Latin saves only ~6%, measured with fontTools). Flag in the PR; if the owner prefers, dropping Anek Devanagari (−828 KB) falls back to the system Noto Devanagari (one constant in `font-families.ts`).
4. **Martian Mono has no ₹ glyph** (checked with fontTools). Figures render through `<Money>`, which sets the currency symbol in Anek and the digits in Martian Mono.
5. **Indian grouping is mobile-only** (`apps/mobile/src/money/format.ts`), applied to **INR only** (USD keeps `1,234.56`). `@asm/client-core` and the website are untouched. Latin digits in both languages.
6. **Amount in words**: INR only, English (Indian scale words lakh/crore, "rupees only") and Hindi ("रुपये मात्र"), keypad sheet only.
7. **"+₹x today" in the header** = the net P&L of the selected account's trades settled since 00:00 IST that the app knows about (bootstrap's last 50 DEMO trades + every socket settlement this session), i.e. the sum of `pnl` (profit on a win, −stake on a loss, 0 on a refund). The canvas sample (+₹186 = 193 − 100 − 100 + 193) adds *gross* wins to stakes lost, which is not a P&L; the plan uses the true net (the same four trades would show −₹14). Hidden when no trade settled today. Risk: undercounts LIVE / very busy days until a server-side day total exists (P3 follow-up).
8. **Login "live market line"**: there is no public quote endpoint before sign-in, so the sparkline is decorative (deterministic, seeded, no price and no market name). PRODUCT.md forbids invented figures.
9. **Markets sheet**: bootstrap carries no per-market price/change/open-hours, so rows show name, category, payout and star (no price column, no "Closed, opens 05:00"). Category chips come from `assetClass` (CRYPTO → Crypto, INDEX → India, FOREX → Forex, COMMODITY → Commodities) plus Starred.
10. **Keypad presets stay** `stakePresets()` from `@asm/client-core` (₹100, ₹250, ₹500, ₹1,000, ₹2,500); the canvas showed ₹5,000 instead of ₹250 but presets are shared with the website.
11. **Lock greeting by name** uses `profile.nickname` cached in the resume MMKV store when bootstrap arrives (wiped with the rest of that store on sign-out). Without a cached nickname it says "Welcome back".
12. **Status line** (live dot, clock, "Saved data — updating…") has no place in the canvas; it moves to a quiet line at the chart's bottom-left. The bonus chip becomes the gold "+100% BONUS" stamp in the chart's overlay row (bonus stays on /trade only).
13. **Token migration**: Task 1 replaces the palette and keeps the old names as deprecated aliases pointing at new colours; Tasks 3–12 move their files to the new names; Task 13 deletes the aliases (tsc then fails on anything missed).

## Global Constraints

- Keep all behaviour, all existing tests, and every `testID` (`login-email`, `login-password`, `login-submit`, `lock-set-pin`, `lock-message`, `pin-0`…`pin-9`, `pin-delete`, `account-demo`, `account-live`, `stake-tile`, `key-0`…`key-9`, `key-.`, `key-back`, `keypad-done`, `expiry-30`, `expiry-60`, `expiry-300`, `expiry-900`, `buy`, `sell`, `toast`, `gate-maintenance`). The `toast` text must keep the `"<market> · <result>"` shape (e2e regex `.* · .*`); `lock-message` must contain the remaining-tries digit.
- i18n: every new string in **both** `src/i18n/en.json` and `src/i18n/hi.json` with the same `{{placeholders}}` (the parity test enforces it). Latin digits in both languages.
- Touch targets ≥ 44pt (use `hitSlop` when the canvas draws a smaller box); safe-area insets on every screen; TalkBack labels on every control; Up/Down never by colour alone.
- The Gatekeeper stays the only navigation owner (`router.replace` only there; screens only `router.navigate` to tabs as today).
- `react-native-reanimated` stays **4.5.1** and `react-native-worklets` **0.10.1** (gradle check). Do not bump Skia (2.6.2).
- Lint rules in force for `apps/mobile`: no `Math.random`, no `require()` imports (use `import x from "./file.webp"`), rules-of-hooks on (call every hook unconditionally), do **not** add `eslint-disable` for exhaustive-deps.
- With a bundled font family never also set `fontWeight` (Android would synthesise bold); pick the weight by family (the `Txt` primitive does this).
- Do not edit `packages/client-core` or anything under `apps/web` (the website must not change).
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (this trailer overrides any other attribution habit).
- **Gate (run at the end of every task; all four must pass):**

```bash
W=/Users/solminde/Developer/Personal/AMScoins/asmtrading/.claude/worktrees/mobile-p2
cd $W/apps/mobile && pnpm test 2>&1 | tail -6            # expect: all test files passed, 0 failed
cd $W/apps/mobile && pnpm typecheck                      # expect: no output, exit 0
cd $W && pnpm exec eslint apps/mobile; echo "eslint=$?"  # expect: eslint=0
cd $W/apps/mobile && rm -rf "${TMPDIR:-/tmp}/ixt-export" && pnpm exec expo export --platform android --output-dir "${TMPDIR:-/tmp}/ixt-export" > "${TMPDIR:-/tmp}/ixt-export.log" 2>&1; echo "export=$?"; tail -3 "${TMPDIR:-/tmp}/ixt-export.log"   # expect: export=0
```

- **Device check (controller's verifier, after each task):** reload the dev client on the emulator, screenshot the listed screens in English and Hindi, compare with the listed artboard (`docs/design/passbook-canvas-2026-10-14/<file>`; the live canvas on the owner's account when available) and with the values in this plan. Report mismatches; implementers do not run the emulator.

## Canvas reference (extracted values)

All sizes are canvas CSS px at a 390×844 artboard = RN points.

**Palette** (`proposal.html` `:root` + boards):

| Token | Hex | Use |
|---|---|---|
| ground | `#06080b` | screen background |
| page | `#0a0d12` | (reserved) |
| surface | `#0f141b` | sheets, cards, inputs, PIN boxes |
| raised | `#171d26` | pressed keys, toasts, muted icon tiles |
| rule | `#252d39` | borders, chip outlines, ledger header rule |
| ruleSoft | `#1a212b` | ledger row rules, keypad grid lines, card borders |
| ink / ink2 / ink3 | `#edf1f6` / `#a6b0be` / `#7c8695` | text levels (ink3: 5.02 on surface, 4.60 on raised; never on the header) |
| accent | `#3d6cf0` | primary buttons, focus border, Deposit square (white on it 4.56:1) |
| onAccent | `#ffffff` | text on accent |
| accentText | `#86a6ff` | links, text buttons, nav active icon |
| accentDim | `#142247` | focus ring, nav active pill, icon tiles |
| up / upInk | `#2ecf7a` / `#04170c` | Up, wins, positive figures / text on Up |
| down / downInk | `#d63a30` / `#ffffff` | Down fill / text on Down |
| downText | `#ff7468` | red text, losses, errors, Down candles |
| gold | `#e2b54c` | bonus only |
| saffron / tricolourWhite / indiaGreen | `#ff9933` / `#f3f1ea` / `#1f9a12` | tricolour hairline, glow |
| dock | `#0b0f14` | trade dock background |
| headerTop / headerBottom | `#16284f` / `#0b1220` | header gradient 180° |
| switchRule / switchInk | `#2a3858` / `#9fb0d4` | Demo/Live switch border / unselected text |
| overlayPill | `#0f141bdd` | market pill and tools button over the chart |
| scrim | `rgba(0,0,0,0.62)` | sheet backdrop |

**Gradients:** Up `linear-gradient(135deg, #43e08f 0%, #2ecf7a 45%, #1fae63 100%)` + inset top highlight `rgba(255,255,255,0.25)` 1px; Down `linear-gradient(135deg, #ea5248 0%, #d63a30 45%, #b02a22 100%)` + highlight `rgba(255,255,255,0.2)`. Header `180deg #16284f → #0b1220`; glow ellipse 160×140 at `right −40, top −60` of the header, `radial-gradient(rgba(255,153,51,0.18), transparent 70%)`. Tricolour hairline 2px: saffron 0–33.3%, `#f3f1ea` 33.3–66.6%, green 66.6–100%; login variant fades from transparent (0%) to saffron (18%) and green (82%) back to transparent (100%).

**Type:** UI = Anek Latin (Hindi: Anek Devanagari), figures = Martian Mono. Letter-spacing in em (RN px = em × size). Weights 620/650 → 600.

**Per screen (what the canvas shows):**

- *Trade (Main)*: header (above); chart area with overlay row at `top 10, left/right 12`: market pill (h40, pad 0 12, r999, bg overlayPill, border rule, name Anek 600 15, payout Martian 500 13 up, chevron-down 16 ink3), tools button (40×40 round, same bg, ellipsis 18 ink2), gold stamp "+100% BONUS" pushed right. Last-price tag: bg ink, text ground, Martian 600 11, r4, h22; price line dashed ink3. Entry line accent 1.5px with tag (accent bg, white Martian 600 11, "Down 0:08"). Candles up `#2ecf7a` / down `#ff7468`. Position strip: `margin 8 14 0, pad 9 12, r12, bg surface, border ruleSoft, gap 12`; ring 34 (track rule); title Anek 600 15 "<Down in downText> BTC/USDT <0:08 Martian 500 12 ink2>"; sub Martian 400 12 ink3 "₹100.00 at 94,553.62"; right Martian 600 15 P&L + "if it ends now" 12 ink3. Dock: `pad 10 14 8, gap 10, border-top ruleSoft, bg dock`; amount box `pad 8 12 7, r12, border rule, bg ground`, "Amount" 13 ink3, figure Martian 600 22 −0.03em; 5 expiry chips (30s 1m 5m 15m More) grid gap 6, h40, r999, unselected border rule/ink2 Anek 500 14, selected bg+border ink/ground 600; Up/Down 2-col gap 10, h62, r12, label Anek 600 20 with arrow icon 18 (stroke 2.25) gap 6, sub Martian 500 12 −0.02em "win ₹1,930", padding 0 16 (Up right padding 30). Bottom nav 48: 4 items, active pill 64×32 r999 accentDim + icon accentText, label 12 600 ink; inactive icon/label ink3 12.
- *Amount keypad (A-Keypad)*: sheet (r22 top, border-top rule, bg surface, handle 40×5 rule r4 margin 10 auto 6, scrim .62); head "Amount" 20/600 + "Demo account" 14 ink3; figure Martian 600 46 −0.05em "₹ 2,500"; dashed rule (rule) + words Anek 16 ink2 "Two thousand five hundred rupees only"; presets h40 pad 0 12 Martian 500 14 −0.03em, selected white; "If you win (93%)" 15 ink2 + Martian 600 15 up (gross return); ledger keypad 3 cols, rules ruleSoft, digits Anek 500 27, "." ink3; Done full-width h54 r12 bg ink text ground Anek 600 17.
- *Trade length (A-Expiry)*: title "Trade length"; 13 chips in a 4-col grid gap 8, h44, Anek 15; footer border-top ruleSoft `pad 16 20 28`: "A trade placed now ends at" 15 ink2 + Martian 600 16 clock.
- *Your trades (A-Trades)*: title "Your trades"; Open N / Closed N pills h40 pad 0 16 (count Martian 12); ledger columns `54 | 1fr | 104`, gap 10; header Martian 500 10 uppercase 0.06em ink3, border-bottom rule, pad 8 0; rows border-bottom ruleSoft; time Martian 400 13 ink2; trade "BTC/USDT <Down>" Anek 600 15 + Martian 400 11 ink3 −0.03em "₹100 · 94,553.62 to 94,547.27"; result Martian 600 14 (+ up / − downText) and a stamp WON (up) / LOST (downText); footer border-top rule `pad 14 20 28`: "Today, Demo" 15 ink2 + Martian 600 16.
- *Stamp*: `pad 2 6, border 1.5 + outline 1 at offset 2 (same colour), r3, Martian 600 10, 0.08em, uppercase` (bonus stamp: pad 3 7, 11px, 0.06em).
- *Markets (A-Markets)*: title "Markets"; search h48 r12 border rule bg ground Anek 16; chips h40 pad 0 16; rows `pad 12 20`, border-bottom ruleSoft, name Anek 600 16 + subtitle 13 ink3, payout Martian 600 14 up (44 wide).
- *Deposit bonus (A-Bonus)*: subtitle 15 ink2; ledger `1fr | 80 | 96` (Deposit / Bonus / Status); tier Anek 600 16; % Martian 15 (next: 600 gold, else 500 ink); status "NEXT" gold stamp or "Upcoming" 14 ink3; note 14 ink2; Deposit button accent h54.
- *Login (A-Login)*: `pad-top 40`; wordmark 250 wide + fading tricolour 250×2 (margin-top 2); 128-high area sparkline (up line 1.8, fill up 0.28→0, end dot r3.5); form `pad 14 20 0, gap 14`; "Log in" 28/600 −0.01em; label 14/500 ink2 above input; input h52 r12 border rule bg surface Anek 16, focused border accent + 3px ring accentDim; password eye button 44×44 at right 4; submit h54 r12 accent Anek 600 17 (margin-top 4); links row 14: "Forgot password?" accentText left, "New here? Create account" right; language pills h36 pad 0 16 (English / हिन्दी) bottom-centred, `pad 0 20 28`.
- *Lock setup (A-LockSetup)*: `pad 40 20 28`; centred column gap 30: 4 empty PIN boxes (preview), title 28/600 lh1.15 + body 16 ink2; options card (border ruleSoft, r14, bg surface): rows `pad 14 16, gap 14`, icon tile 42 r12 (fingerprint: accentDim/accentText; key: raised/ink2), title 17/600 + hint 14 ink3, chevron 18 ink3; "Not now" text button h48 accentText 500 16.
- *Lock (A-Lock)*: mark 72; "Welcome back, Asha" 24/600; "Enter your PIN" 15 ink2; 4 boxes 60×70 r10 border 1.5 (filled: dot 12 ink; active: accent + ring; error: downText), gap 12; fixed message slot, 15 downText; ledger keypad full width, keys h64 Anek 500 27, fingerprint bottom-left (accentText 26), delete bottom-right (ink2 26); "Forgot PIN? Log in again" text button h52 accentText 15, margin-bottom 16.
- *Gate screens (N-Update pattern)*: `pad 40 20 28`; mark 76; title 28/600 lh1.15; body 16 ink2; info card (r14 border ruleSoft bg surface pad 14 16, rows "You have / Needed" 15, value Martian); primary button with icon at the bottom.

## File Map

```
apps/mobile/
  package.json                          + expo-font, @expo-google-fonts/{anek-latin,anek-devanagari,martian-mono}
  assets/art/source/*.webp              originals (committed with this plan; not bundled)
  assets/art/bull-b3@2x.webp @3x        Task 6 (cwebp)
  assets/art/bear-r1@2x.webp @3x        Task 6 (cwebp)
  assets/brand/source/mark.webp         original
  assets/brand/mark.webp wordmark.webp  Task 4
  app/_layout.tsx                       T1 fonts gate, T10 saved locale
  app/(auth)/login.tsx register.tsx forgot.tsx                       T10
  app/(tabs)/_layout.tsx                T5 BottomNav
  app/(tabs)/trade.tsx                  T5 header, T8 chrome, T11 nickname
  app/(tabs)/payments.tsx history.tsx account.tsx                    T5
  app/lock.tsx lock-setup.tsx           T11
  app/blocked.tsx maintenance.tsx update-required.tsx                T12
  src/theme/tokens.ts (+test)           T1 palette; T13 alias removal
  src/theme/font-families.ts (+test)    T1 pure family resolver
  src/theme/font-assets.ts              T1 font asset map
  src/theme/ui.tsx                      T1 Txt/Screen, T3 Button
  src/types/assets.d.ts                 T1 *.webp, *.ttf modules
  src/gate/Gatekeeper.tsx               T1 fontsReady
  src/money/format.ts (+test)           T2 money(), groupIndian(), groupTyped()
  src/money/words.ts (+test)            T2 amountInWords()
  src/ui/Icon.tsx Chip.tsx Sheet.tsx    T3
  src/ui/Money.tsx Stamp.tsx Ledger.tsx DashedRule.tsx Tricolour.tsx Brand.tsx   T4
  src/ui/AppHeader.tsx BottomNav.tsx    T5
  src/trade/day-total.ts (+test)        T5
  src/trade/TopBar.tsx                  T5
  src/ui/gradient.ts (+test)            T6
  src/trade/beast-frame.ts (+test) TradeButton.tsx                   T6
  src/trade/Dock.tsx KeypadSheet.tsx ExpirySheet.tsx stake-input.ts  T6/T7
  src/trade/MarketPill.tsx ChartTools.tsx StatusRow.tsx PositionStrip.tsx src/chart/Chart.tsx   T8
  src/trade/MarketSheet.tsx TradesSheet.tsx BonusSheet.tsx markets.ts closed-stamp.ts (+tests)  T9
  src/ui/form.tsx sparkline-path.ts (+test) Sparkline.tsx LanguageSwitch.tsx  T10
  src/i18n/keys.ts (+test) locale-pref.ts                            T10
  src/lock/PinBoxes.tsx PinPad.tsx      T11
  src/cache/resume-cache.ts             T11 nickname
  src/ui/GateScreen.tsx OfflineBanner.tsx Toast.tsx                  T12
  src/i18n/en.json hi.json              every task that adds copy
```

---

### Task 1: Passbook palette, bundled fonts, script-aware `Txt`

**Files:**
- Modify: `apps/mobile/package.json` (via `expo install`)
- Modify: `apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/theme/tokens.test.ts`
- Create: `apps/mobile/src/theme/font-families.ts`, `apps/mobile/src/theme/font-families.test.ts`, `apps/mobile/src/theme/font-assets.ts`
- Modify: `apps/mobile/src/theme/ui.tsx` (Txt, Screen, Skeleton)
- Modify: `apps/mobile/src/types/assets.d.ts`
- Modify: `apps/mobile/app/_layout.tsx`, `apps/mobile/src/gate/Gatekeeper.tsx`

**Interfaces:**
- Produces: `color` (new names listed in the palette table + deprecated aliases `panel tile tileHi brand brandInk brandFill brandDim caution`), `gradient.{header,up,down}`, `radius.{xs,sm,md,lg,sheet,pill}`, `space(n)`; `type Weight = 400|500|600`, `type Script = "latin"|"devanagari"`, `scriptFor(language)`, `uiFamily(weight, script)`, `figFamily(weight)`, `nearestWeight(css)`, `FONT_FAMILIES`; `FONT_ASSETS`; `Txt` props `{ variant?, font?: "ui"|"fig", weight?, size?, color?, tracking?, lineHeight?, script? } & TextProps`; `type TxtProps`; `useUiFamily(weight): string`; `Screen` gains `bleedTop?: boolean`; `<Gatekeeper fontsReady />`.

- [ ] **Step 1: Install the font packages**

```bash
cd $W/apps/mobile && pnpm exec expo install expo-font @expo-google-fonts/anek-latin @expo-google-fonts/anek-devanagari @expo-google-fonts/martian-mono
```

Expected `package.json` dependencies gain `"expo-font": "~57.0.4"`, `"@expo-google-fonts/anek-latin": "^0.4.2"`, `"@expo-google-fonts/anek-devanagari": "^0.4.1"`, `"@expo-google-fonts/martian-mono": "^0.4.2"` (if `expo install` writes other ranges, keep what it writes). Do not add an `expo-font` config plugin (fonts load at runtime; the native module is already autolinked through `expo`).

- [ ] **Step 2: Write the failing font-family test** — `apps/mobile/src/theme/font-families.test.ts`

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, figFamily, nearestWeight, scriptFor, uiFamily } from "./font-families";

describe("font families", () => {
  it("picks Devanagari for Hindi and Latin otherwise", () => {
    expect(scriptFor("hi")).toBe("devanagari");
    expect(scriptFor("hi-IN")).toBe("devanagari");
    expect(scriptFor("en")).toBe("latin");
    expect(scriptFor(undefined)).toBe("latin");
  });
  it("maps weights to bundled files", () => {
    expect(uiFamily(400, "latin")).toBe("AnekLatin_400Regular");
    expect(uiFamily(500, "latin")).toBe("AnekLatin_500Medium");
    expect(uiFamily(600, "latin")).toBe("AnekLatin_600SemiBold");
    expect(uiFamily(500, "devanagari")).toBe("AnekDevanagari_400Regular");
    expect(uiFamily(600, "devanagari")).toBe("AnekDevanagari_600SemiBold");
    expect(figFamily(500)).toBe("MartianMono_500Medium");
  });
  it("rounds canvas CSS weights to the nearest bundled weight", () => {
    expect(nearestWeight(400)).toBe(400);
    expect(nearestWeight(500)).toBe(500);
    expect(nearestWeight(620)).toBe(600);
    expect(nearestWeight(650)).toBe(600);
  });
  it("loads every family it hands out", () => {
    const src = readFileSync(fileURLToPath(new URL("./font-assets.ts", import.meta.url)), "utf8");
    expect(FONT_FAMILIES).toHaveLength(8);
    for (const name of FONT_FAMILIES) expect(src).toContain(`import { ${name} }`);
  });
});
```

Run: `cd $W/apps/mobile && pnpm test -- font-families` → FAIL (module not found).

- [ ] **Step 3: Implement `font-families.ts` and `font-assets.ts`**

`apps/mobile/src/theme/font-families.ts`:

```ts
/** Bundled weights. Canvas weights 620/650 render as 600 (see nearestWeight). */
export type Weight = 400 | 500 | 600;
export type Script = "latin" | "devanagari";

const LATIN: Record<Weight, string> = { 400: "AnekLatin_400Regular", 500: "AnekLatin_500Medium", 600: "AnekLatin_600SemiBold" };
/** Each Devanagari weight is ~414 KB, so only Regular and SemiBold ship; Medium falls back to Regular. */
const DEVANAGARI: Record<Weight, string> = {
  400: "AnekDevanagari_400Regular",
  500: "AnekDevanagari_400Regular",
  600: "AnekDevanagari_600SemiBold",
};
const FIGURES: Record<Weight, string> = { 400: "MartianMono_400Regular", 500: "MartianMono_500Medium", 600: "MartianMono_600SemiBold" };

export function scriptFor(language: string | undefined): Script {
  return language?.toLowerCase().startsWith("hi") ? "devanagari" : "latin";
}

/** Family for UI text. Anek Devanagari also carries Latin letters and ₹, so Hindi screens use it for everything. */
export function uiFamily(weight: Weight, script: Script): string {
  return (script === "devanagari" ? DEVANAGARI : LATIN)[weight];
}

/** Family for figures (money, prices, times). Martian Mono has no ₹: <Money> sets the symbol in Anek. */
export function figFamily(weight: Weight): string {
  return FIGURES[weight];
}

export function nearestWeight(css: number): Weight {
  return css >= 590 ? 600 : css >= 490 ? 500 : 400;
}

export const FONT_FAMILIES: readonly string[] = [...new Set([...Object.values(LATIN), ...Object.values(DEVANAGARI), ...Object.values(FIGURES)])];
```

`apps/mobile/src/theme/font-assets.ts` (per-weight subpath imports so only these eight files are bundled):

```ts
import { AnekDevanagari_400Regular } from "@expo-google-fonts/anek-devanagari/400Regular";
import { AnekDevanagari_600SemiBold } from "@expo-google-fonts/anek-devanagari/600SemiBold";
import { AnekLatin_400Regular } from "@expo-google-fonts/anek-latin/400Regular";
import { AnekLatin_500Medium } from "@expo-google-fonts/anek-latin/500Medium";
import { AnekLatin_600SemiBold } from "@expo-google-fonts/anek-latin/600SemiBold";
import { MartianMono_400Regular } from "@expo-google-fonts/martian-mono/400Regular";
import { MartianMono_500Medium } from "@expo-google-fonts/martian-mono/500Medium";
import { MartianMono_600SemiBold } from "@expo-google-fonts/martian-mono/600SemiBold";

/** Keys are the family names font-families.ts hands out (Google Fonts, OFL-1.1, via @expo-google-fonts). */
export const FONT_ASSETS = {
  AnekLatin_400Regular,
  AnekLatin_500Medium,
  AnekLatin_600SemiBold,
  AnekDevanagari_400Regular,
  AnekDevanagari_600SemiBold,
  MartianMono_400Regular,
  MartianMono_500Medium,
  MartianMono_600SemiBold,
};
```

If `tsc` cannot resolve a `/400Regular` subpath, check `node_modules/@expo-google-fonts/anek-latin/400Regular/index.d.ts` exists; do **not** fall back to the package root import (it would bundle all eight weights of each family).

Run: `pnpm test -- font-families` → PASS.

- [ ] **Step 4: Replace the palette** — `apps/mobile/src/theme/tokens.ts` (whole file)

```ts
/**
 * The "Passbook" palette from the owner-approved design canvas (2026-10-14,
 * docs/design/passbook-canvas-2026-10-14). The app no longer mirrors the website's theme.
 */
export const color = {
  ground: "#06080b",
  page: "#0a0d12",
  surface: "#0f141b",
  raised: "#171d26",
  rule: "#252d39",
  ruleSoft: "#1a212b",
  ink: "#edf1f6",
  ink2: "#a6b0be",
  ink3: "#7c8695",
  accent: "#3d6cf0",
  onAccent: "#ffffff",
  accentText: "#86a6ff",
  accentDim: "#142247",
  up: "#2ecf7a",
  /** Text on `up` fills. */
  upInk: "#04170c",
  /** Down button fill. Red text on dark uses `downText`. */
  down: "#d63a30",
  /** Text on `down` fills. */
  downInk: "#ffffff",
  downText: "#ff7468",
  /** Bonus only. */
  gold: "#e2b54c",
  saffron: "#ff9933",
  tricolourWhite: "#f3f1ea",
  indiaGreen: "#1f9a12",
  dock: "#0b0f14",
  headerTop: "#16284f",
  headerBottom: "#0b1220",
  switchRule: "#2a3858",
  switchInk: "#9fb0d4",
  overlayPill: "#0f141bdd",
  scrim: "rgba(0, 0, 0, 0.62)",
  warnBg: "#2a1210",
  /** @deprecated use surface (removed in Task 13) */
  panel: "#0f141b",
  /** @deprecated use raised (removed in Task 13) */
  tile: "#171d26",
  /** @deprecated use raised (removed in Task 13) */
  tileHi: "#1f2733",
  /** @deprecated use accentText for text/lines or accent for fills (removed in Task 13) */
  brand: "#86a6ff",
  /** @deprecated use onAccent (removed in Task 13) */
  brandInk: "#ffffff",
  /** @deprecated use accent (removed in Task 13) */
  brandFill: "#3d6cf0",
  /** @deprecated use accentDim (removed in Task 13) */
  brandDim: "#142247",
  /** @deprecated use gold (removed in Task 13) */
  caution: "#e2b54c",
} as const;

export const gradient = {
  header: { colors: ["#16284f", "#0b1220"] },
  up: { colors: ["#43e08f", "#2ecf7a", "#1fae63"], positions: [0, 0.45, 1], highlight: "rgba(255, 255, 255, 0.25)" },
  down: { colors: ["#ea5248", "#d63a30", "#b02a22"], positions: [0, 0.45, 1], highlight: "rgba(255, 255, 255, 0.2)" },
} as const;

export const radius = { xs: 3, sm: 8, md: 12, lg: 14, sheet: 22, pill: 999 } as const;
export const space = (n: number) => n * 4;
/** @deprecated use <Txt> props (removed in Task 13) */
export const font = {
  regular: { fontSize: 14, color: color.ink },
  small: { fontSize: 12, color: color.ink2 },
  title: { fontSize: 18, fontWeight: "700" as const, color: color.ink },
  number: { fontVariant: ["tabular-nums" as const] },
};
export const tokens = { color, gradient, radius, space };
```

- [ ] **Step 5: Rewrite the token test** — `apps/mobile/src/theme/tokens.test.ts` (whole file; the website mirror test no longer applies)

```ts
import { describe, expect, it } from "vitest";
import { color, gradient, space } from "./tokens";

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("Passbook tokens", () => {
  it("match the design canvas", () => {
    expect({
      ground: color.ground, surface: color.surface, raised: color.raised, rule: color.rule, ruleSoft: color.ruleSoft,
      ink: color.ink, ink2: color.ink2, ink3: color.ink3, accent: color.accent, accentText: color.accentText,
      accentDim: color.accentDim, up: color.up, upInk: color.upInk, down: color.down, downText: color.downText, gold: color.gold,
    }).toEqual({
      ground: "#06080b", surface: "#0f141b", raised: "#171d26", rule: "#252d39", ruleSoft: "#1a212b",
      ink: "#edf1f6", ink2: "#a6b0be", ink3: "#7c8695", accent: "#3d6cf0", accentText: "#86a6ff",
      accentDim: "#142247", up: "#2ecf7a", upInk: "#04170c", down: "#d63a30", downText: "#ff7468", gold: "#e2b54c",
    });
    expect(gradient.up.colors).toEqual(["#43e08f", "#2ecf7a", "#1fae63"]);
    expect(gradient.down.colors).toEqual(["#ea5248", "#d63a30", "#b02a22"]);
  });

  it("keeps text readable (WCAG AA 4.5:1) where the canvas puts it", () => {
    expect(contrast(color.upInk, color.up)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.downInk, color.down)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ground, color.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink2, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink3, color.ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.downText, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.accentText, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.gold, color.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps white on the accent at AA (4.56:1; the 17px/600 labels are not WCAG large text)", () => {
    expect(contrast(color.onAccent, color.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink3, color.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color.ink3, color.raised)).toBeGreaterThanOrEqual(4.5);
  });

  it("space() is a 4pt grid", () => {
    expect(space(0)).toBe(0);
    expect(space(3)).toBe(12);
  });
});
```

- [ ] **Step 6: Asset module types** — append to `apps/mobile/src/types/assets.d.ts`

```ts
// Metro asset ids: usable as an <Image source>, a Skia useImage()/useFont() source, or an expo-font source.
declare module "*.webp" {
  const id: number;
  export default id;
}
declare module "*.ttf" {
  const id: number;
  export default id;
}
```

- [ ] **Step 7: `Txt`, `useUiFamily`, `Screen bleedTop`** — in `apps/mobile/src/theme/ui.tsx` replace the `Screen`, `Txt` and `Skeleton` functions and add imports; leave `Button`, `Card`, `Row` as they are (Task 3 restyles Button).

```tsx
import { useTranslation } from "react-i18next";
import { figFamily, scriptFor, uiFamily, type Script, type Weight } from "./font-families";

/**
 * Makes room for the "No connection" strip while it shows. `bleedTop`: the screen draws its own header under
 * the status bar (the Trade tab's AppHeader handles the inset and the strip itself).
 */
export function Screen({ children, style, bleedTop = false }: { children: ReactNode; style?: ViewStyle; bleedTop?: boolean }) {
  const offline = useOfflineVisible();
  const own = StyleSheet.flatten(style);
  const paddingTop = bleedTop ? screenTopPadding(own, false, 0) : screenTopPadding(own, offline, OFFLINE_BANNER_HEIGHT);
  return (
    <SafeAreaView style={[styles.screen, style, { paddingTop }]} edges={bleedTop ? ["left", "right"] : ["top", "left", "right"]}>
      {children}
    </SafeAreaView>
  );
}

const VARIANT = {
  regular: { size: 14, weight: 400, color: color.ink },
  small: { size: 12, weight: 400, color: color.ink2 },
  title: { size: 20, weight: 600, color: color.ink },
} as const satisfies Record<string, { size: number; weight: Weight; color: string }>;

export type TxtProps = TextProps & {
  /** Legacy presets; prefer size/weight/color. */
  variant?: keyof typeof VARIANT;
  /** "ui" = Anek (Latin or Devanagari by language), "fig" = Martian Mono. */
  font?: "ui" | "fig";
  weight?: Weight;
  size?: number;
  color?: string;
  /** Letter-spacing in em, as on the canvas (-0.02 = -0.02em). */
  tracking?: number;
  lineHeight?: number;
  /** Force a script (the language switch shows हिन्दी in Devanagari on an English screen). */
  script?: Script;
};

/** The one text primitive: picks the bundled family by weight and the current language. Never sets fontWeight. */
export function Txt({ variant, font: kind = "ui", weight, size, color: ink, tracking, lineHeight, script, style, ...rest }: TxtProps) {
  const { i18n } = useTranslation();
  const base = variant ? VARIANT[variant] : undefined;
  const w = weight ?? base?.weight ?? 400;
  const s = size ?? base?.size ?? 14;
  const sc = script ?? scriptFor(i18n.language);
  const family = kind === "fig" ? figFamily(w) : uiFamily(w, sc);
  const lh = lineHeight ?? Math.round(s * (kind === "ui" && sc === "devanagari" ? 1.5 : 1.3));
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: family, fontSize: s, lineHeight: lh, color: ink ?? base?.color ?? color.ink },
        tracking !== undefined ? { letterSpacing: tracking * s } : null,
        style,
      ]}
    />
  );
}

/** Font family for a TextInput (inputs cannot use <Txt>). */
export function useUiFamily(weight: Weight): string {
  const { i18n } = useTranslation();
  return uiFamily(weight, scriptFor(i18n.language));
}

export function Skeleton({ height = 16, width = "100%" }: { height?: number; width?: number | `${number}%` }) {
  return <View style={{ height, width, borderRadius: radius.sm, backgroundColor: color.raised }} />;
}
```

(`styles.screen` already uses `color.ground`; keep it.)

- [ ] **Step 8: Load fonts before the splash hides**

In `apps/mobile/app/_layout.tsx` add `import { useFonts } from "expo-font";` and `import { FONT_ASSETS } from "@/theme/font-assets";`, then inside `RootLayout` (first line):

```tsx
  // Bundled fonts (no network). An error still lets the app start, in the system font.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
```

and render `<Gatekeeper fontsReady={fontsLoaded || fontError !== null} />` instead of `<Gatekeeper />`.

In `apps/mobile/src/gate/Gatekeeper.tsx` change the signature and the `settled` line:

```tsx
export function Gatekeeper({ fontsReady }: { fontsReady: boolean }) {
```

```tsx
  // Hide the splash only once the user is on the right screen, the app-config answer is in and the fonts are
  // registered (text drawn before that would flash in the system font).
  const settled = booted && navReady && ready && cfgSettled && fontsReady && redirect === null;
```

The 4 s failsafe is unchanged (it still hides the splash if fonts never load).

- [ ] **Step 9: Run the Gate** (Global Constraints). Also confirm only the eight chosen font files are bundled:

```bash
find "${TMPDIR:-/tmp}/ixt-export" -name "*.ttf" | wc -l      # expect 8
du -ch $(find "${TMPDIR:-/tmp}/ixt-export" -name "*.ttf") | tail -1   # expect ≈ 1.3M
```

- [ ] **Step 10: Commit**

```bash
cd $W && git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/src/theme apps/mobile/src/types/assets.d.ts apps/mobile/app/_layout.tsx apps/mobile/src/gate/Gatekeeper.tsx
git commit -m "feat(mobile): Passbook palette, bundled Anek + Martian Mono fonts, script-aware Txt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check:** every screen turns to the new ground/surface colours (legacy aliases now point at Passbook values); splash → app without a system-font flash; Hindi text in Anek Devanagari. Compare the ground/sheet colours against any `A-*` board.

---

### Task 2: Indian digit grouping and amount in words

**Files:**
- Create: `apps/mobile/src/money/format.ts`, `apps/mobile/src/money/format.test.ts`
- Create: `apps/mobile/src/money/words.ts`, `apps/mobile/src/money/words.test.ts`
- Modify: `apps/mobile/src/trade/stake-input.ts`, `apps/mobile/src/trade/stake-input.test.ts`
- Modify (swap `formatMinor` → `money`): `src/trade/Dock.tsx`, `src/trade/KeypadSheet.tsx`, `src/trade/PositionStrip.tsx`, `src/trade/TopBar.tsx`, `src/trade/TradesSheet.tsx`, `src/trade/result.ts`

**Interfaces:**
- Produces: `groupIndian(digits: string): string`; `money(minor: number, currency: string, opts?: { trim?: boolean }): string`; `groupTyped(text: string, currency: string): string`; `amountInWords(rupees: number, locale: "en" | "hi"): string`; `stakeDisplay(text: string, currency: string): string` (signature change).

- [ ] **Step 1: Failing tests** — `apps/mobile/src/money/format.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { groupIndian, groupTyped, money } from "./format";

describe("groupIndian", () => {
  it("groups the last three digits, then pairs", () => {
    expect(groupIndian("0")).toBe("0");
    expect(groupIndian("999")).toBe("999");
    expect(groupIndian("1000")).toBe("1,000");
    expect(groupIndian("99999")).toBe("99,999");
    expect(groupIndian("100000")).toBe("1,00,000");
    expect(groupIndian("999600")).toBe("9,99,600");
    expect(groupIndian("123456789")).toBe("12,34,56,789");
  });
});

describe("money", () => {
  it("formats INR in Indian grouping with paise", () => {
    expect(money(99960000, "INR")).toBe("₹9,99,600.00");
    expect(money(18600, "INR")).toBe("₹186.00");
    expect(money(5, "INR")).toBe("₹0.05");
  });
  it("trims .00 on whole amounts only when asked", () => {
    expect(money(193000, "INR", { trim: true })).toBe("₹1,930");
    expect(money(193050, "INR", { trim: true })).toBe("₹1,930.50");
    expect(money(1000, "USD", { trim: true })).toBe("$10");
  });
  it("keeps Western grouping for other currencies", () => {
    expect(money(123456789, "USD")).toBe("$1,234,567.89");
  });
  it("leads a negative amount with a minus sign", () => {
    expect(money(-1400, "INR")).toBe("−₹14.00");
    expect(money(-100, "USD")).toBe("−$1.00");
  });
  it("rejects fractional minor units", () => {
    expect(() => money(1.5, "INR")).toThrow();
  });
});

describe("groupTyped", () => {
  it("groups typed whole rupees the Indian way", () => {
    expect(groupTyped("", "INR")).toBe("0");
    expect(groupTyped("2500", "INR")).toBe("2,500");
    expect(groupTyped("125000", "INR")).toBe("1,25,000");
  });
  it("keeps the client-core behaviour elsewhere (trailing point kept while typing)", () => {
    expect(groupTyped("1250", "USD")).toBe("1,250");
    expect(groupTyped("12.", "USD")).toBe("12.");
    expect(groupTyped("12.5", "USD")).toBe("12.5");
  });
});
```

`apps/mobile/src/money/words.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { amountInWords } from "./words";

describe("amountInWords (English, Indian scale)", () => {
  it.each([
    [1, "One rupee only"],
    [100, "One hundred rupees only"],
    [2500, "Two thousand five hundred rupees only"],
    [125000, "One lakh twenty-five thousand rupees only"],
    [999600, "Nine lakh ninety-nine thousand six hundred rupees only"],
    [10000000, "One crore rupees only"],
    [1234567890, "One hundred twenty-three crore forty-five lakh sixty-seven thousand eight hundred ninety rupees only"],
  ])("%i", (n, words) => {
    expect(amountInWords(n, "en")).toBe(words);
  });
  it("is empty for zero", () => {
    expect(amountInWords(0, "en")).toBe("");
  });
});

describe("amountInWords (Hindi)", () => {
  it.each([
    [1, "एक रुपया मात्र"],
    [100, "एक सौ रुपये मात्र"],
    [2500, "दो हज़ार पाँच सौ रुपये मात्र"],
    [125000, "एक लाख पच्चीस हज़ार रुपये मात्र"],
    [999600, "नौ लाख निन्यानवे हज़ार छह सौ रुपये मात्र"],
    [10000000, "एक करोड़ रुपये मात्र"],
    [1234567890, "एक सौ तेईस करोड़ पैंतालीस लाख सड़सठ हज़ार आठ सौ नब्बे रुपये मात्र"],
  ])("%i", (n, words) => {
    expect(amountInWords(n, "hi")).toBe(words);
  });
});
```

Run: `pnpm test -- money` → FAIL.

- [ ] **Step 2: Implement** — `apps/mobile/src/money/format.ts`

```ts
import { currencySymbol, formatMinor, groupAmountInput } from "@asm/client-core";

/** "999600" -> "9,99,600": the last three digits, then pairs (thousand, lakh, crore). Digits only, no sign. */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const pairs: string[] = [];
  while (rest.length > 2) {
    pairs.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest !== "") pairs.unshift(rest);
  return `${pairs.join(",")},${last3}`;
}

export interface MoneyOpts {
  /** Drop ".00" on a whole amount ("₹1,930"), as on the Up/Down buttons and quick amounts. */
  trim?: boolean;
}

/**
 * The app's money text. INR uses Indian grouping (₹9,99,600.00); other currencies keep @asm/client-core's
 * formatMinor ($1,234.56). A negative amount leads with "−". The website never imports this.
 */
export function money(minor: number, currency: string, opts: MoneyOpts = {}): string {
  if (!Number.isInteger(minor)) throw new Error(`money: expected an integer, received ${minor}`);
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const whole = abs % 100 === 0;
  if (currency !== "INR") {
    const text = formatMinor(abs, currency);
    return sign + (opts.trim && whole ? text.replace(/\.00$/, "") : text);
  }
  const rupees = groupIndian(String(Math.floor(abs / 100)));
  const paise = String(abs % 100).padStart(2, "0");
  return `${sign}${currencySymbol(currency)}${opts.trim && whole ? rupees : `${rupees}.${paise}`}`;
}

/** The keypad's typed amount: Indian grouping for INR (whole rupees only), client-core grouping elsewhere. */
export function groupTyped(text: string, currency: string): string {
  if (currency !== "INR") return groupAmountInput(text);
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits === "" ? "0" : groupIndian(digits);
}
```

`apps/mobile/src/money/words.ts`

```ts
export type WordsLocale = "en" | "hi";

const EN_ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–99 in Hindi (the numbers are irregular, so they are listed). */
const HI = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
];

interface Lang {
  under100: (n: number) => string;
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
}

const LANG: Record<WordsLocale, Lang> = {
  en: {
    under100: (n) => {
      if (n < 20) return EN_ONES[n] ?? "";
      const unit = n % 10;
      const tens = EN_TENS[Math.floor(n / 10)] ?? "";
      return unit ? `${tens}-${EN_ONES[unit] ?? ""}` : tens;
    },
    hundred: "hundred",
    thousand: "thousand",
    lakh: "lakh",
    crore: "crore",
  },
  hi: { under100: (n) => HI[n] ?? "", hundred: "सौ", thousand: "हज़ार", lakh: "लाख", crore: "करोड़" },
};

function under1000(n: number, l: Lang): string[] {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${l.under100(h)} ${l.hundred}`);
  if (r) parts.push(l.under100(r));
  return parts;
}

/** Words for n > 0 on the Indian scale; crores above 999 recurse ("one hundred twenty-three crore"). */
function spell(n: number, l: Lang): string[] {
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor(n / 100_000) % 100;
  const thousand = Math.floor(n / 1000) % 100;
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(...spell(crore, l), l.crore);
  if (lakh) parts.push(l.under100(lakh), l.lakh);
  if (thousand) parts.push(l.under100(thousand), l.thousand);
  if (rest) parts.push(...under1000(rest, l));
  return parts;
}

/**
 * Whole rupees as a cheque writes them: "Two thousand five hundred rupees only" / "दो हज़ार पाँच सौ रुपये मात्र".
 * Empty for 0 (the keypad hides the line). Paise are not spelled (INR stakes are whole rupees).
 */
export function amountInWords(rupees: number, locale: WordsLocale): string {
  const n = Math.floor(Math.abs(rupees));
  if (n === 0) return "";
  const words = spell(n, LANG[locale]).join(" ");
  if (locale === "hi") return `${words} ${n === 1 ? "रुपया" : "रुपये"} मात्र`;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${n === 1 ? "rupee" : "rupees"} only`;
}
```

Run: `pnpm test -- money` → PASS.

- [ ] **Step 3: `stakeDisplay` takes the currency** — in `apps/mobile/src/trade/stake-input.ts` replace the function (and drop its now-unused `groupAmountInput` import if nothing else uses it):

```ts
/** The stake text as shown: Indian grouping on INR, "0" when empty, a trailing point kept while typing. */
export function stakeDisplay(text: string, currency: string): string {
  return groupTyped(text, currency);
}
```

with `import { groupTyped } from "@/money/format";`. In `stake-input.test.ts` change the `stakeDisplay` block to:

```ts
describe("stakeDisplay", () => {
  it("groups as typed", () => {
    expect(stakeDisplay("", "USD")).toBe("0");
    expect(stakeDisplay("1250", "USD")).toBe("1,250");
    expect(stakeDisplay("12.", "USD")).toBe("12.");
    expect(stakeDisplay("12.5", "USD")).toBe("12.5");
    expect(stakeDisplay("125000", "INR")).toBe("1,25,000");
  });
});
```

(keep the existing `it` title if it differs; only the calls and the INR line change). Update the two callers: `Dock.tsx` `stakeDisplay(stake)` → `stakeDisplay(stake, currency)`; `KeypadSheet.tsx` `stakeDisplay(value)` (twice) → `stakeDisplay(value, currency)`.

- [ ] **Step 4: Swap `formatMinor` for `money`** in `Dock.tsx`, `KeypadSheet.tsx`, `PositionStrip.tsx`, `TopBar.tsx`, `TradesSheet.tsx`, `result.ts`: replace each `formatMinor(` call with `money(` (same arguments), remove `formatMinor` from the `@asm/client-core` import, add `import { money } from "@/money/format";`. Confirm nothing is left:

```bash
cd $W/apps/mobile && grep -rn "formatMinor" src app | grep -v "src/money/" ; echo "left=$?"   # expect left=1 (no matches)
```

`result.test.ts` expectations (`₹180.00`, `₹100.00`) stay valid (under ₹1,000 both groupings agree).

- [ ] **Step 5: Run the Gate.**

- [ ] **Step 6: Commit**

```bash
cd $W && git add apps/mobile/src/money apps/mobile/src/trade
git commit -m "feat(mobile): Indian digit grouping for INR and amount-in-words (en/hi)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check:** Trade header balance shows `₹9,99,600.00`-style grouping on a DEMO INR account; a USD account (if any) still shows `$1,234.56`.

---

### Task 3: Primitives I — icon set, Button, Chip, Sheet

**Files:**
- Modify: `apps/mobile/src/ui/Icon.tsx` (whole file)
- Modify: `apps/mobile/src/theme/ui.tsx` (Button)
- Create: `apps/mobile/src/ui/Chip.tsx`
- Modify: `apps/mobile/src/ui/Sheet.tsx`
- Modify: `apps/mobile/src/trade/BonusSheet.tsx` (one line: `kind="up"` → `kind="primary"`)

**Interfaces:**
- Consumes: `Txt`, `color`, `radius` (Task 1).
- Produces: `IconName` = `"trade" | "wallet" | "history" | "user" | "chevron" | "chevronDown" | "close" | "more" | "briefcase" | "star" | "search" | "lock" | "bolt" | "plus" | "arrowUp" | "arrowDown" | "fingerprint" | "key" | "eye" | "eyeOff" | "delete" | "download"`; `Icon({ name, size?=22, color?, strokeWidth?=1.75, filled? })`; `Button({ label, onPress, kind?: "primary"|"light"|"secondary"|"text", disabled?, busy?, testID?, icon?: IconName })`; `Chip({ label, selected?, onPress, height?=40, figures?, size?=14, count?, testID?, accessibilityLabel?, style?, script?, role?: "button"|"tab"|"radio", disabled? })`; `Sheet` gains `aside?: string` and `flush?: boolean`.

- [ ] **Step 1: Icon set** — `apps/mobile/src/ui/Icon.tsx` (whole file; paths are lucide's, copied from the canvas SVGs)

```tsx
import { Circle, Path, Svg } from "react-native-svg";
import { color as palette } from "@/theme/tokens";

export type IconName =
  | "trade" | "wallet" | "history" | "user" | "chevron" | "chevronDown" | "close" | "more" | "briefcase" | "star"
  | "search" | "lock" | "bolt" | "plus" | "arrowUp" | "arrowDown" | "fingerprint" | "key" | "eye" | "eyeOff"
  | "delete" | "download";

type Glyph = { paths: string[]; circles?: { cx: number; cy: number; r: number; fill?: boolean }[] };

/** 24×24 outline glyphs (lucide, as drawn on the Passbook canvas). Rects are written as paths. */
const G: Record<IconName, Glyph> = {
  trade: {
    paths: [
      "M9 5v4", "M8 9h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z", "M9 15v2", "M17 3v2",
      "M16 5h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M17 13v3", "M3 3v16a2 2 0 0 0 2 2h16",
    ],
  },
  wallet: {
    paths: [
      "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",
      "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",
    ],
  },
  history: { paths: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"] },
  user: { paths: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"], circles: [{ cx: 12, cy: 7, r: 4 }] },
  chevron: { paths: ["m9 18 6-6-6-6"] },
  chevronDown: { paths: ["m6 9 6 6 6-6"] },
  close: { paths: ["M6 6l12 12M18 6L6 18"] },
  more: { paths: [], circles: [{ cx: 12, cy: 12, r: 1 }, { cx: 19, cy: 12, r: 1 }, { cx: 5, cy: 12, r: 1 }] },
  briefcase: { paths: ["M4 8h16v11H4z", "M9 8V5h6v3"] },
  star: { paths: ["M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2 8 13.7 4 9.8 9.5 9z"] },
  search: { paths: ["M15.5 15.5L20 20", "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z"] },
  lock: { paths: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"] },
  bolt: { paths: ["M13 3L5 14h6l-1 7 8-11h-6z"] },
  plus: { paths: ["M5 12h14", "M12 5v14"] },
  arrowUp: { paths: ["m5 12 7-7 7 7", "M12 19V5"] },
  arrowDown: { paths: ["M12 5v14", "m19 12-7 7-7-7"] },
  fingerprint: {
    paths: [
      "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4", "M14 13.12c0 2.38 0 6.38-1 8.88", "M17.29 21.02c.12-.6.43-2.3.5-3.02",
      "M2 12a10 10 0 0 1 18-6", "M2 16h.01", "M21.8 16c.2-2 .131-5.354 0-6", "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",
      "M8.65 22c.21-.66.45-1.32.57-2", "M9 6.8a6 6 0 0 1 9 5.2v2",
    ],
  },
  key: {
    paths: [
      "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z",
    ],
    circles: [{ cx: 16.5, cy: 7.5, r: 0.5, fill: true }],
  },
  eye: {
    paths: ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"],
    circles: [{ cx: 12, cy: 12, r: 3 }],
  },
  eyeOff: {
    paths: [
      "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      "M14.084 14.158a3 3 0 0 1-4.242-4.242",
      "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      "m2 2 20 20",
    ],
  },
  delete: {
    paths: [
      "M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z",
      "m12 9 6 6", "m18 9-6 6",
    ],
  },
  download: { paths: ["M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5"] },
};

export function Icon({
  name,
  size = 22,
  color = palette.ink,
  strokeWidth = 1.75,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Solid shape instead of an outline (the starred state of `star`). */
  filled?: boolean;
}) {
  const g = G[name];
  return (
    <Svg
      // Decorative: the control around an icon carries the label.
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : "none"}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {g.circles?.map((c) => <Circle key={`${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy} r={c.r} fill={c.fill ? color : filled ? color : "none"} />)}
      {g.paths.map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
```

Existing callers keep working (`chevron`, `more`, `star`, `search`, `trade`, `wallet`, `history`, `user`).

- [ ] **Step 2: Button** — in `apps/mobile/src/theme/ui.tsx` replace `ButtonKind`, `FILL`, `INK`, `Button` and the `button`/`buttonText` styles:

```tsx
import { Icon, type IconName } from "@/ui/Icon";

type ButtonKind = "primary" | "light" | "secondary" | "text";

/** primary = money-moving action (accent); light = neutral confirm ("Done"); secondary = outlined; text = quiet link. */
const SKIN: Record<ButtonKind, { bg: string; ink: string; border: string; height: number; weight: Weight; size: number }> = {
  primary: { bg: color.accent, ink: color.onAccent, border: color.accent, height: 54, weight: 600, size: 17 },
  light: { bg: color.ink, ink: color.ground, border: color.ink, height: 54, weight: 600, size: 17 },
  secondary: { bg: "transparent", ink: color.ink, border: color.rule, height: 54, weight: 600, size: 17 },
  text: { bg: "transparent", ink: color.accentText, border: "transparent", height: 48, weight: 500, size: 16 },
};

export function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
  busy,
  testID,
  icon,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  /** Stable handle for end-to-end tests. */
  testID?: string;
  icon?: IconName;
}) {
  const s = SKIN[kind];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { minHeight: s.height, backgroundColor: s.bg, borderColor: s.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={s.ink} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={s.ink} strokeWidth={2} /> : null}
          <Txt weight={s.weight} size={s.size} color={s.ink} numberOfLines={1}>
            {label}
          </Txt>
        </>
      )}
    </Pressable>
  );
}
```

and the styles:

```tsx
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: space(2),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space(4),
  },
```

(delete the `buttonText` style; import `type Weight` is already there from Task 1). In `src/trade/BonusSheet.tsx` change `kind="up"` to `kind="primary"`. Check no other caller uses a removed kind: `grep -rn 'kind="up"\|kind="down"' $W/apps/mobile/src $W/apps/mobile/app` → no matches.

- [ ] **Step 3: Chip** — `apps/mobile/src/ui/Chip.tsx`

```tsx
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import type { Script } from "@/theme/font-families";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

/**
 * Pill choice used for expiry, quick amounts, categories, segments and the language switch. Selected = white
 * fill with ground text (blue is kept for actions that move money). A pill shorter than 44pt gets hitSlop.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  height = 40,
  figures = false,
  size = 14,
  count,
  testID,
  accessibilityLabel,
  style,
  script,
  role = "button",
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  height?: number;
  /** Martian Mono label (amounts). */
  figures?: boolean;
  size?: number;
  /** Small trailing count ("Open 0"). */
  count?: number;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  script?: Script;
  role?: "button" | "tab" | "radio";
  disabled?: boolean;
}) {
  const slop = Math.max(0, Math.ceil((44 - height) / 2));
  const ink = selected ? color.ground : color.ink2;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? (count !== undefined ? `${label}, ${count}` : label)}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop }}
      style={({ pressed }) => [
        {
          height,
          paddingHorizontal: 12,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: selected ? color.ink : color.rule,
          backgroundColor: selected ? color.ink : pressed ? color.raised : "transparent",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Txt
        font={figures ? "fig" : "ui"}
        weight={selected ? 600 : 500}
        size={size}
        tracking={figures ? -0.03 : undefined}
        color={ink}
        script={script}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {label}
      </Txt>
      {count !== undefined ? (
        <Txt font="fig" size={12} color={ink}>
          {count}
        </Txt>
      ) : null}
    </Pressable>
  );
}
```

- [ ] **Step 4: Sheet** — in `apps/mobile/src/ui/Sheet.tsx`:
  - add props to `SheetProps`: `aside?: string;` (small text right of the title, e.g. "Demo account") and `flush?: boolean;` (content spans the full width; the content pads itself; the title keeps 20pt sides);
  - destructure them in the component;
  - replace `body`, the `heading` constant and the `BottomSheetModal` styling props with:

```tsx
const body = { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 28, gap: 12 } as const;
const bodyFlush = { paddingTop: 4, paddingBottom: 0 } as const;
```

```tsx
  const heading = title ? (
    <View style={[{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }, flush ? { paddingHorizontal: 20, paddingBottom: 12 } : null]}>
      <Txt weight={600} size={20} accessibilityRole="header">
        {title}
      </Txt>
      {aside ? (
        <Txt size={14} color={color.ink3}>
          {aside}
        </Txt>
      ) : null}
    </View>
  ) : null;
```

```tsx
  const backdrop = useCallback(
    (p: BottomSheetBackdropProps) => <BottomSheetBackdrop {...p} opacity={0.62} appearsOnIndex={0} disappearsOnIndex={-1} />,
    [],
  );
```

```tsx
      backgroundStyle={{
        backgroundColor: color.surface,
        borderTopLeftRadius: radius.sheet,
        borderTopRightRadius: radius.sheet,
        borderTopWidth: 1,
        borderColor: color.rule,
      }}
      handleStyle={{ paddingTop: 10, paddingBottom: 6 }}
      handleIndicatorStyle={{ backgroundColor: color.rule, width: 40, height: 5, borderRadius: 4 }}
```

  and use `contentContainerStyle={flush ? bodyFlush : body}` / `style={flush ? bodyFlush : body}` on the scroll/view bodies. Imports: drop `Text`, add `View` from react-native, `Txt` from `@/theme/ui`, `radius` from `@/theme/tokens`.

- [ ] **Step 5: Run the Gate.**

- [ ] **Step 6: Commit**

```bash
cd $W && git add apps/mobile/src/ui apps/mobile/src/theme/ui.tsx apps/mobile/src/trade/BonusSheet.tsx
git commit -m "feat(mobile): Passbook icon set, Button kinds, Chip, restyled sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check:** open the keypad, expiry, markets, trades and bonus sheets: surface `#0f141b`, 22pt top corners, 40×5 handle, darker scrim; titles Anek 600 20. Compare chrome with A-Keypad / A-Expiry (contents restyle later).

---

### Task 4: Primitives II — Money, Stamp, Ledger, DashedRule, Tricolour, brand images

**Files:**
- Create: `apps/mobile/src/ui/Money.tsx`, `Stamp.tsx`, `Ledger.tsx`, `DashedRule.tsx`, `Tricolour.tsx`, `Brand.tsx`
- Create: `apps/mobile/assets/brand/mark.webp`, `apps/mobile/assets/brand/wordmark.webp` (cwebp)

**Interfaces:**
- Consumes: `Txt`, `TxtProps`, `color`, `radius`.
- Produces: `Money({ text, size?, weight?, color?, tracking?, ...TxtProps })` (text from `money()`); `Stamp({ label, tone: "up"|"down"|"gold"|"accent"|"muted", size?: "sm"|"md" })`; `type LedgerColumn = { width?: number; flex?: number; align?: "left"|"right" }`; `LedgerHeader({ columns, labels })`; `LedgerRow({ columns, cells, accessibilityLabel?, minHeight? })`; `DashedRule({ color? })`; `Tricolour({ fade?, width?, style? })`; `BrandMark({ width })`; `Wordmark({ width })`.

- [ ] **Step 1: Convert the brand images**

```bash
cd $W/apps/mobile/assets/brand
cp source/mark.webp mark.webp
cwebp -quiet -q 85 -m 6 -resize 750 0 ../../../web/public/brand/indianxtrade-wordmark-dark.png -o wordmark.webp
sips -g pixelWidth -g pixelHeight mark.webp wordmark.webp   # expect 175x120 and 750x245 (±1)
```

- [ ] **Step 2: The six primitives**

`apps/mobile/src/ui/Money.tsx`

```tsx
import { color } from "@/theme/tokens";
import { Txt, type TxtProps } from "@/theme/ui";

const SYMBOL = /[₹$€]/;

/**
 * A money figure: digits in Martian Mono, the currency symbol in Anek (Martian Mono has no ₹ glyph).
 * `text` comes from money() (with any "+" / "−" prefix already applied).
 */
export function Money({ text, size = 15, weight = 600, color: ink = color.ink, tracking = -0.02, ...rest }: Omit<TxtProps, "font" | "children"> & { text: string }) {
  const i = text.search(SYMBOL);
  if (i < 0) {
    return (
      <Txt {...rest} font="fig" size={size} weight={weight} color={ink} tracking={tracking}>
        {text}
      </Txt>
    );
  }
  return (
    <Txt {...rest} font="fig" size={size} weight={weight} color={ink} tracking={tracking}>
      {text.slice(0, i)}
      <Txt size={size} weight={weight} color={ink} lineHeight={rest.lineHeight}>
        {text.charAt(i)}
      </Txt>
      {text.slice(i + 1)}
    </Txt>
  );
}
```

`apps/mobile/src/ui/Stamp.tsx`

```tsx
import { View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

const TONE = { up: color.up, down: color.downText, gold: color.gold, accent: color.accentText, muted: color.ink3 } as const;

/**
 * Rubber stamp (Won, Lost, Next, Bonus): a 1.5pt border inside a 1pt outline 2pt away, uppercase Martian Mono.
 * Results are stamped, never only coloured.
 */
export function Stamp({ label, tone, size = "sm" }: { label: string; tone: keyof typeof TONE; size?: "sm" | "md" }) {
  const c = TONE[tone];
  const md = size === "md";
  return (
    <View accessible accessibilityLabel={label} style={{ borderWidth: 1, borderColor: c, borderRadius: 5, padding: 2 }}>
      <View style={{ borderWidth: 1.5, borderColor: c, borderRadius: 3, paddingHorizontal: md ? 7 : 6, paddingVertical: md ? 2 : 1 }}>
        <Txt font="fig" weight={600} size={md ? 11 : 10} tracking={md ? 0.06 : 0.08} lineHeight={md ? 14 : 13} color={c}>
          {label.toUpperCase()}
        </Txt>
      </View>
    </View>
  );
}
```

`apps/mobile/src/ui/Ledger.tsx`

```tsx
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

/** A passbook column: fixed `width`, or a `flex` share (default 1). */
export interface LedgerColumn {
  width?: number;
  flex?: number;
  align?: "left" | "right";
}

const cell = (c: LedgerColumn): ViewStyle => ({
  ...(c.width !== undefined ? { width: c.width } : { flex: c.flex ?? 1, minWidth: 0 }),
  alignItems: c.align === "right" ? "flex-end" : "flex-start",
});

/** Column captions (TIME, TRADE, RESULT). Hidden from TalkBack: every row carries its own label. */
export function LedgerHeader({ columns, labels }: { columns: LedgerColumn[]; labels: string[] }) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ flexDirection: "row", columnGap: 10, borderBottomWidth: 1, borderBottomColor: color.rule }}
    >
      {columns.map((c, i) => (
        <View key={labels[i] ?? i} style={[cell(c), { paddingVertical: 8 }]}>
          <Txt font="fig" weight={500} size={10} tracking={0.06} color={color.ink3}>
            {(labels[i] ?? "").toUpperCase()}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** One passbook line. `cells` are placed in `columns` order. */
export function LedgerRow({
  columns,
  cells,
  accessibilityLabel,
  minHeight = 52,
}: {
  columns: LedgerColumn[];
  cells: ReactNode[];
  accessibilityLabel?: string;
  minHeight?: number;
}) {
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: "row", columnGap: 10, minHeight, paddingVertical: 10, alignItems: "center", borderBottomWidth: 1, borderBottomColor: color.ruleSoft }}
    >
      {columns.map((c, i) => (
        // Columns are fixed per table, so the index is a stable key.
        <View key={i} style={[cell(c), { gap: 5 }]}>
          {cells[i]}
        </View>
      ))}
    </View>
  );
}
```

`apps/mobile/src/ui/DashedRule.tsx` (RN draws a one-sided dashed border solid on Android, so this is an SVG line)

```tsx
import { Line, Svg } from "react-native-svg";
import { color as palette } from "@/theme/tokens";

export function DashedRule({ color = palette.rule }: { color?: string }) {
  return (
    <Svg width="100%" height={1} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Line x1="0" y1="0.5" x2="100%" y2="0.5" stroke={color} strokeWidth={1} strokeDasharray="4 3" />
    </Svg>
  );
}
```

`apps/mobile/src/ui/Tricolour.tsx`

```tsx
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Defs, LinearGradient, Rect, Stop, Svg } from "react-native-svg";
import { color } from "@/theme/tokens";

/**
 * The logo's tricolour as a 2pt rule. Plain = three equal bands (header). `fade` = the login rule that fades in
 * from transparent at both ends.
 */
export function Tricolour({ fade = false, width, style }: { fade?: boolean; width?: number; style?: StyleProp<ViewStyle> }) {
  if (!fade) {
    return (
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[{ height: 2, width, flexDirection: "row" }, style]}>
        <View style={{ flex: 1, backgroundColor: color.saffron }} />
        <View style={{ flex: 1, backgroundColor: color.tricolourWhite }} />
        <View style={{ flex: 1, backgroundColor: color.indiaGreen }} />
      </View>
    );
  }
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[{ height: 2, width }, style]}>
      <Svg width="100%" height={2}>
        <Defs>
          <LinearGradient id="ixtTricolourFade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color.saffron} stopOpacity={0} />
            <Stop offset="0.18" stopColor={color.saffron} />
            <Stop offset="0.333" stopColor={color.saffron} />
            <Stop offset="0.333" stopColor={color.tricolourWhite} />
            <Stop offset="0.666" stopColor={color.tricolourWhite} />
            <Stop offset="0.666" stopColor={color.indiaGreen} />
            <Stop offset="0.82" stopColor={color.indiaGreen} />
            <Stop offset="1" stopColor={color.indiaGreen} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="2" fill="url(#ixtTricolourFade)" />
      </Svg>
    </View>
  );
}
```

`apps/mobile/src/ui/Brand.tsx`

```tsx
import { Image } from "react-native";
import markSrc from "../../assets/brand/mark.webp";
import wordmarkSrc from "../../assets/brand/wordmark.webp";

/** The IXT tricolour mark (175×120 source). Decorative: the screen title names the app. */
export function BrandMark({ width }: { width: number }) {
  return <Image source={markSrc} accessibilityIgnoresInvertColors resizeMode="contain" style={{ width, height: (width * 120) / 175 }} />;
}

/** The chrome "INDIAN X TRADE" wordmark (750×245, black ground that disappears on the #06080b ground). */
export function Wordmark({ width }: { width: number }) {
  return (
    <Image
      source={wordmarkSrc}
      accessible
      accessibilityRole="image"
      accessibilityLabel="IndianxTrade"
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={{ width, height: (width * 245) / 750 }}
    />
  );
}
```

- [ ] **Step 3: Run the Gate** (the primitives are not on screen yet; tsc/eslint/export prove they compile and the webp imports resolve).

- [ ] **Step 4: Commit**

```bash
cd $W && git add apps/mobile/src/ui apps/mobile/assets/brand
git commit -m "feat(mobile): Money, Stamp, Ledger, DashedRule, Tricolour and brand image primitives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check:** none (no screen uses them yet).

---

### Task 5: App shell — compact header, bottom nav, placeholder tabs

**Files:**
- Create: `apps/mobile/src/trade/day-total.ts`, `apps/mobile/src/trade/day-total.test.ts`
- Create: `apps/mobile/src/ui/AppHeader.tsx`, `apps/mobile/src/ui/BottomNav.tsx`
- Modify: `apps/mobile/src/trade/TopBar.tsx` (whole file)
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/(tabs)/trade.tsx` (header part), `payments.tsx`, `history.tsx`, `account.tsx`
- Modify: `apps/mobile/src/i18n/en.json`, `hi.json`

**Interfaces:**
- Consumes: `money`, `Money`, `Txt`, `BrandMark`, `Tricolour`, `Icon`, `useNow` (`src/trade/useNow.ts`), `useOfflineVisible`/`OFFLINE_BANNER_HEIGHT`.
- Produces: `dayNetMinor(trades: readonly TradeView[], nowMs: number): number | null`; `istDayStartMs(nowMs: number): number`; `AppHeader({ children })`, `HEADER_ROW = 49`; `BottomNav(props: BottomTabBarProps)`; `TopBar` / `StaleTopBar` (same props as today).

- [ ] **Step 1: Failing test** — `apps/mobile/src/trade/day-total.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { TradeView } from "@asm/contracts";
import { dayNetMinor, istDayStartMs } from "./day-total";

const sec = (ms: number) => Math.floor(ms / 1000);
const trade = (id: string, status: TradeView["status"], pnl: number, expiryMs: number): TradeView => ({
  id,
  accountId: "a",
  symbol: "BTCUSDT",
  direction: "UP",
  stake: 10_000,
  payoutPct: 93,
  entryPrice: 1,
  entryTs: sec(expiryMs) - 30,
  expiryTs: sec(expiryMs),
  exitPrice: status === "OPEN" ? null : 1.1,
  status,
  pnl,
});

// 14 Oct 2026, 17:30 IST.
const NOW = Date.UTC(2026, 9, 14, 12, 0);

describe("istDayStartMs", () => {
  it("is 00:00 IST (18:30 UTC the day before)", () => {
    expect(istDayStartMs(NOW)).toBe(Date.UTC(2026, 9, 13, 18, 30));
  });
});

describe("dayNetMinor", () => {
  it("sums the net P&L of trades settled since 00:00 IST", () => {
    const trades = [
      trade("w", "WON", 9_300, Date.UTC(2026, 9, 14, 10, 0)),
      trade("l1", "LOST", -10_000, Date.UTC(2026, 9, 14, 11, 0)),
      trade("l2", "LOST", -10_000, Date.UTC(2026, 9, 14, 11, 30)),
      trade("w2", "WON", 9_300, Date.UTC(2026, 9, 13, 18, 30)), // exactly 00:00 IST: today
      trade("old", "WON", 9_300, Date.UTC(2026, 9, 13, 18, 29)), // 23:59 IST yesterday
      trade("open", "OPEN", 0, Date.UTC(2026, 9, 14, 12, 1)),
      trade("r", "REFUNDED", 0, Date.UTC(2026, 9, 14, 9, 0)),
    ];
    expect(dayNetMinor(trades, NOW)).toBe(9_300 - 10_000 - 10_000 + 9_300);
  });
  it("is null when nothing settled today", () => {
    expect(dayNetMinor([trade("old", "WON", 9_300, Date.UTC(2026, 9, 12, 10, 0))], NOW)).toBeNull();
    expect(dayNetMinor([], NOW)).toBeNull();
  });
});
```

Run: `pnpm test -- day-total` → FAIL.

- [ ] **Step 2: Implement** — `apps/mobile/src/trade/day-total.ts`

```ts
import type { TradeView } from "@asm/contracts";

const DAY_MS = 86_400_000;
/** India has no daylight saving: IST is always UTC+05:30 (no Intl time zone support needed on Hermes). */
const IST_OFFSET_MS = 19_800_000;

export function istDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

/**
 * Net P&L (sum of `pnl`: profit on a win, −stake on a loss, 0 on a refund) of the trades that settled today
 * (IST). Only trades this device knows about count (bootstrap's recent list + this session's settlements).
 * Null when none settled today, so the header line hides instead of showing a misleading ₹0.00.
 */
export function dayNetMinor(trades: readonly TradeView[], nowMs: number): number | null {
  const from = istDayStartMs(nowMs) / 1000;
  const to = from + DAY_MS / 1000;
  let net = 0;
  let any = false;
  for (const t of trades) {
    if (t.status === "OPEN" || t.expiryTs < from || t.expiryTs >= to) continue;
    net += t.pnl;
    any = true;
  }
  return any ? net : null;
}
```

Run: `pnpm test -- day-total` → PASS.

- [ ] **Step 3: AppHeader** — `apps/mobile/src/ui/AppHeader.tsx`

```tsx
import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop, Svg } from "react-native-svg";
import { color } from "@/theme/tokens";
import { OFFLINE_BANNER_HEIGHT, useOfflineVisible } from "./OfflineBanner";
import { Tricolour } from "./Tricolour";

/** Content row height; with the 2pt tricolour the header is 51pt under the status bar. */
export const HEADER_ROW = 49;

/**
 * The tab screens' header: navy gradient running under the status bar, a soft saffron glow top-right, one 49pt
 * row of content and the tricolour hairline. Static (no animation) so it never costs the chart frames.
 */
export function AppHeader({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const offline = useOfflineVisible();
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ paddingTop: insets.top + (offline ? OFFLINE_BANNER_HEIGHT : 0), overflow: "hidden" }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="ixtHeader" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.headerTop} />
              <Stop offset="1" stopColor={color.headerBottom} />
            </LinearGradient>
            <RadialGradient id="ixtGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color.saffron} stopOpacity={0.18} />
              <Stop offset="0.7" stopColor={color.saffron} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#ixtHeader)" />
          {/* Canvas: a 160×140 glow at right −40, top −60 of the header box. */}
          {width > 0 ? <Ellipse cx={width - 40} cy={10} rx={80} ry={70} fill="url(#ixtGlow)" /> : null}
        </Svg>
      </View>
      <View style={{ height: HEADER_ROW, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>{children}</View>
      <Tricolour />
    </View>
  );
}
```

- [ ] **Step 4: TopBar** — `apps/mobile/src/trade/TopBar.tsx` (whole file)

```tsx
import { router } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import type { TradeView } from "@asm/contracts";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { AppHeader } from "@/ui/AppHeader";
import { BrandMark } from "@/ui/Brand";
import { Icon } from "@/ui/Icon";
import { Money } from "@/ui/Money";
import { toast } from "@/ui/Toast";
import type { AppAccount } from "./accounts";
import { dayNetMinor } from "./day-total";
import { useNow } from "./useNow";

const TYPES = ["DEMO", "LIVE"] as const;
const NO_TRADES: readonly TradeView[] = [];

const switchBox = {
  flexDirection: "row",
  padding: 2,
  borderRadius: radius.pill,
  backgroundColor: "rgba(6, 8, 11, 0.55)",
  borderWidth: 1,
  borderColor: color.switchRule,
} as const;

/** "+₹186.00 today": net of today's settled trades on this account; ticks once a minute for the day boundary. */
function TodayLine({ accountId, currency }: { accountId: string; currency: string }) {
  const { t } = useTranslation();
  const trades = useSocket((s) => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const now = useNow(60_000);
  const net = useMemo(() => dayNetMinor(trades, now), [trades, now]);
  if (net === null) return null;
  const amount = `${net > 0 ? "+" : ""}${money(net, currency)}`;
  return (
    <Money
      text={t("trade.today", { amount })}
      size={10}
      weight={500}
      lineHeight={12}
      color={net > 0 ? color.up : net < 0 ? color.downText : color.ink3}
    />
  );
}

/**
 * Mark, Demo/Live switch, the active account's balance (with today's result above it) and a square Deposit
 * button. Live is greyed (and says why when tapped) unless the user has live access and a live account.
 */
export function TopBar({
  account,
  liveEnabled,
  onSelectType,
}: {
  account: AppAccount;
  liveEnabled: boolean;
  onSelectType: (type: AppAccount["type"]) => void;
}) {
  const { t } = useTranslation();
  const bal = useSocket((s) => s.trades.balances[account.id]) ?? account;
  const text = money(Math.round(bal.realBalance + bal.bonusBalance), account.currency);
  return (
    <AppHeader>
      <BrandMark width={34} />
      <View accessibilityRole="radiogroup" style={switchBox}>
        {TYPES.map((type) => {
          const selected = account.type === type;
          const blocked = type === "LIVE" && !liveEnabled;
          return (
            <Pressable
              key={type}
              testID={`account-${type.toLowerCase()}`}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: blocked }}
              onPress={() => (blocked ? toast(t("trade.liveLocked")) : onSelectType(type))}
              hitSlop={{ top: 7, bottom: 7 }}
              style={{
                height: 30,
                minWidth: 44,
                paddingHorizontal: 11,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? color.ink : "transparent",
                opacity: blocked ? 0.45 : 1,
              }}
            >
              <Txt weight={600} size={13} lineHeight={16} color={selected ? color.ground : color.switchInk}>
                {type === "DEMO" ? t("trade.demo") : t("trade.live")}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1, alignItems: "flex-end", minWidth: 0 }}>
        <TodayLine accountId={account.id} currency={account.currency} />
        <Money
          text={text}
          size={16}
          weight={600}
          tracking={-0.04}
          lineHeight={19}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={`${t("trade.balance")}: ${text}`}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("trade.deposit")}
        // The real deposit flow arrives with the payments work; until then this opens the Payments tab.
        onPress={() => router.navigate("/payments")}
        hitSlop={2}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          borderRadius: radius.md,
          backgroundColor: color.accent,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon name="plus" size={20} strokeWidth={2.25} color={color.onAccent} />
      </Pressable>
    </AppHeader>
  );
}

/**
 * The header from the resume cache, shown until bootstrap arrives: the last known balance, dimmed, with the
 * account type but no controls (the switch and deposit need live account data). The screen-reader label says the
 * figure is saved data, so it never reads as current money. A balance the store already received (`live`) is
 * shown at full strength and without that wording.
 */
export function StaleTopBar({
  totalMinor,
  type,
  currency,
  live = false,
}: {
  totalMinor: number;
  type: AppAccount["type"];
  currency: string;
  live?: boolean;
}) {
  const { t } = useTranslation();
  const text = money(totalMinor, currency);
  return (
    <AppHeader>
      <BrandMark width={34} />
      <View style={switchBox}>
        <View style={{ height: 30, paddingHorizontal: 11, justifyContent: "center" }}>
          <Txt weight={600} size={13} lineHeight={16} color={color.switchInk}>
            {type === "DEMO" ? t("trade.demo") : t("trade.live")}
          </Txt>
        </View>
      </View>
      <View style={{ flex: 1, alignItems: "flex-end", minWidth: 0 }}>
        <Money
          text={text}
          size={16}
          weight={600}
          tracking={-0.04}
          lineHeight={19}
          numberOfLines={1}
          adjustsFontSizeToFit
          color={live ? color.ink : color.ink2}
          accessibilityLabel={live ? `${t("trade.balance")}: ${text}` : `${t("trade.balance")}: ${text}. ${t("trade.stale")}`}
        />
      </View>
    </AppHeader>
  );
}
```

- [ ] **Step 5: Trade screen header block** — in `apps/mobile/app/(tabs)/trade.tsx`:
  - `<Screen>` → `<Screen bleedTop>`;
  - add imports `import { AppHeader } from "@/ui/AppHeader";` and `import { BrandMark } from "@/ui/Brand";`;
  - replace the whole header ternary (from `{boot && account ? (` down to the skeleton `</View>` `)}`) with:

```tsx
      {boot && account ? (
        <TopBar account={account} liveEnabled={canUseLive(boot.accounts, boot.liveAccess)} onSelectType={selectAccountType} />
      ) : !bootFailed && stale ? (
        <StaleTopBar totalMinor={stale.totalMinor} type={stale.type} currency={stale.currency} live={stale.live} />
      ) : (
        <AppHeader>
          <BrandMark width={34} />
          <View style={{ flex: 1 }} />
          {bootFailed ? null : <Skeleton height={20} width={120} />}
        </AppHeader>
      )}
      {/* With a resume cache the chart is still showing, so the error is a strip; without one, see below. */}
      {!boot && bootFailed && symbol ? <BootError compact onRetry={retry} /> : null}
```

  (`stale` is already null whenever `bootFailed`, so the precedence matches the old code.)

- [ ] **Step 6: BottomNav** — `apps/mobile/src/ui/BottomNav.tsx`

```tsx
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon, type IconName } from "./Icon";

const ICONS: Record<string, IconName> = { trade: "trade", payments: "wallet", history: "history", account: "user" };

/** 48pt bottom nav (canvas): active tab = blue pill behind the icon + bold label. Adds the bottom safe-area inset. */
export function BottomNav({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 8),
        borderTopWidth: 1,
        borderTopColor: color.ruleSoft,
        backgroundColor: color.ground,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const title = descriptors[route.key]?.options.title;
        const label = typeof title === "string" ? title : route.name;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            style={{ flex: 1, height: 48, alignItems: "center", justifyContent: "center", gap: 2 }}
          >
            <View
              style={{
                width: 64,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: focused ? color.accentDim : "transparent",
              }}
            >
              <Icon name={ICONS[route.name] ?? "trade"} size={20} color={focused ? color.accentText : color.ink3} />
            </View>
            <Txt size={12} weight={focused ? 600 : 400} lineHeight={16} color={focused ? color.ink : color.ink3} numberOfLines={1}>
              {label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
```

In `apps/mobile/app/(tabs)/_layout.tsx`: change the import to `import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";`, delete `icon`/`tabIcons` and the `Icon`/`IconName`/`color` imports, add `import { BottomNav } from "@/ui/BottomNav";` and at module level:

```tsx
const renderTabBar = (props: BottomTabBarProps) => <BottomNav {...props} />;
```

and replace the `<Tabs screenOptions=…>` props with:

```tsx
    <Tabs tabBar={renderTabBar} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="trade" options={{ title: t("tabs.trade") }} />
      <Tabs.Screen name="payments" options={{ title: t("tabs.payments") }} />
      <Tabs.Screen name="history" options={{ title: t("tabs.history") }} />
      <Tabs.Screen name="account" options={{ title: t("tabs.account") }} />
    </Tabs>
```

(If `BottomTabBarProps` is not exported from `expo-router/js-tabs` in this SDK, import it from `expo-router/build/layouts/Tabs` is NOT allowed (deep import); instead type the parameter as `Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0]` and export that alias from `BottomNav.tsx`.)

- [ ] **Step 7: Placeholder tabs** — `payments.tsx` and `history.tsx` (same shape; key differs):

```tsx
import { useTranslation } from "react-i18next";
import { color } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";

export default function Payments() {
  const { t } = useTranslation();
  return (
    <Screen style={{ paddingHorizontal: 20, paddingTop: 24, gap: 8 }}>
      <Txt weight={600} size={24} accessibilityRole="header">
        {t("tabs.payments")}
      </Txt>
      <Txt size={15} color={color.ink2}>
        {t("tabs.soon")}
      </Txt>
    </Screen>
  );
}
```

(`history.tsx`: `History` / `t("tabs.history")`.) `account.tsx`: same title + body, then `<Button label={t("account.logout")} kind="secondary" onPress={() => void signOut()} />` below the body text (keep the existing comment about testers).

- [ ] **Step 8: Strings** — add to `en.json` / `hi.json`:

| key | en | hi |
|---|---|---|
| `tabs.soon` | `This screen arrives in the next update.` | `यह स्क्रीन अगले अपडेट में आएगी।` |
| `trade.today` | `{{amount}} today` | `आज {{amount}}` |

- [ ] **Step 9: Run the Gate.**

- [ ] **Step 10: Commit**

```bash
cd $W && git add apps/mobile/src/trade/day-total.ts apps/mobile/src/trade/day-total.test.ts apps/mobile/src/ui/AppHeader.tsx apps/mobile/src/ui/BottomNav.tsx apps/mobile/src/trade/TopBar.tsx "apps/mobile/app/(tabs)" apps/mobile/src/i18n
git commit -m "feat(mobile): compact Passbook header with today's result, 48pt bottom nav, placeholder tabs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (Main):** header = one 51pt row under the status bar with the gradient behind the status bar; mark 34 wide; Demo/Live switch (white selected pill); balance Martian 16 right-aligned with green "+₹… today" after a settled win today; 40×40 blue square "+". Bottom nav 48 + inset with the blue pill on Trade. Offline: the strip sits under the status bar and the header row moves below it. Cold start before bootstrap: dimmed cached balance, no "+".

---

### Task 6: Up/Down buttons with the engraved bull and bear (Skia overlay blend)

**Files:**
- Create: `apps/mobile/assets/art/bull-b3@2x.webp`, `bull-b3@3x.webp`, `bear-r1@2x.webp`, `bear-r1@3x.webp`
- Create: `apps/mobile/src/ui/gradient.ts`, `apps/mobile/src/ui/gradient.test.ts`
- Create: `apps/mobile/src/trade/beast-frame.ts`, `apps/mobile/src/trade/beast-frame.test.ts`
- Create: `apps/mobile/src/trade/TradeButton.tsx`
- Modify: `apps/mobile/src/trade/Dock.tsx` (the Buy/Sell row only), `PositionStrip.tsx`, `TradesSheet.tsx` (`trade.buy/sell` → `trade.up/down`)
- Modify: `en.json`, `hi.json`

**Interfaces:**
- Consumes: `gradient`, `color`, `radius`, `Txt`, `Icon`, `money`.
- Produces: `cssGradientPoints(angleDeg, w, h): { start: {x,y}; end: {x,y} }`; `BUTTON_H = 62`, `BEAST_OPACITY = 1`, `bullFrame(buttonW)`, `bearFrame(buttonW)` → `{ x, y, w, h }`; `TradeButton({ direction: "UP"|"DOWN", label, sub: string|null, disabled, busy, onPress, testID, accessibilityLabel })`; i18n `trade.up`, `trade.down`, `trade.win`.

- [ ] **Step 1: Export the art at 2x/3x** (the button draws the bull 88pt tall and the bear 59pt wide, 79pt tall before the 68pt box crops it)

```bash
cd $W/apps/mobile/assets/art
cwebp -quiet -q 80 -alpha_q 90 -m 6 -resize 0 264 source/bull-b3-bust.webp -o bull-b3@3x.webp
cwebp -quiet -q 80 -alpha_q 90 -m 6 -resize 0 176 source/bull-b3-bust.webp -o bull-b3@2x.webp
cwebp -quiet -q 80 -alpha_q 90 -m 6 -resize 0 238 source/bear-r1-swipe.webp -o bear-r1@3x.webp
cwebp -quiet -q 80 -alpha_q 90 -m 6 -resize 0 159 source/bear-r1-swipe.webp -o bear-r1@2x.webp
ls -l *.webp   # expect four files, each under ~30 KB (bull@3x was 26.8 KB in a dry run)
```

- [ ] **Step 2: Failing tests**

`apps/mobile/src/ui/gradient.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { cssGradientPoints } from "./gradient";

describe("cssGradientPoints", () => {
  it("180deg runs top to bottom through the centre", () => {
    const p = cssGradientPoints(180, 100, 50);
    expect(p.start.x).toBeCloseTo(50);
    expect(p.start.y).toBeCloseTo(0);
    expect(p.end.x).toBeCloseTo(50);
    expect(p.end.y).toBeCloseTo(50);
  });
  it("135deg on a square runs corner to corner", () => {
    const p = cssGradientPoints(135, 100, 100);
    expect(p.start.x).toBeCloseTo(0);
    expect(p.start.y).toBeCloseTo(0);
    expect(p.end.x).toBeCloseTo(100);
    expect(p.end.y).toBeCloseTo(100);
  });
  it("135deg on a wide button keeps the CSS gradient-line length (w + h)·√½", () => {
    const p = cssGradientPoints(135, 176, 62);
    expect(Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y)).toBeCloseTo((176 + 62) * Math.SQRT1_2);
  });
});
```

`apps/mobile/src/trade/beast-frame.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { bearFrame, bullFrame } from "./beast-frame";

describe("bullFrame", () => {
  it("sits where the owner put it on the 176pt canvas button", () => {
    const f = bullFrame(176);
    expect(f.x).toBeCloseTo(105);
    expect(f.y).toBe(-3);
    expect(f.h).toBe(88);
    expect(f.w).toBeCloseTo((88 * 380) / 513);
  });
  it("is anchored to the button's right edge, so every phone width keeps the head uncropped", () => {
    for (const w of [161, 176, 206]) {
      const f = bullFrame(w);
      expect(f.x + f.w).toBeCloseTo(w - 5.8);
    }
  });
});

describe("bearFrame", () => {
  it("fills the canvas's 59×68 box (right −1, bottom −5, cover crop at object-position 49.58% 73.22%)", () => {
    for (const w of [161, 176, 206]) {
      const f = bearFrame(w);
      expect(f.w).toBe(59);
      expect(f.h).toBeCloseTo(79.18);
      expect(f.y).toBeCloseTo(-9.19);
      expect(f.x + f.w).toBeCloseTo(w + 1);
    }
  });
});
```

Run: `pnpm test -- gradient beast-frame` → FAIL.

- [ ] **Step 3: Implement the helpers**

`apps/mobile/src/ui/gradient.ts`

```ts
export interface GradientPoints {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Start/end of a CSS `linear-gradient(<angle>deg, …)` across a w×h box (CSS: 0deg points up, 90deg right; the
 * gradient line passes through the centre and is |w·sin a| + |h·cos a| long), so Skia/SVG gradients match the canvas.
 */
export function cssGradientPoints(angleDeg: number, w: number, h: number): GradientPoints {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return {
    start: { x: w / 2 - dx * half, y: h / 2 - dy * half },
    end: { x: w / 2 + dx * half, y: h / 2 + dy * half },
  };
}
```

`apps/mobile/src/trade/beast-frame.ts`

```ts
/** Up/Down button height (canvas). */
export const BUTTON_H = 62;
/** Owner set the engraved art to 100% (overlay blend). */
export const BEAST_OPACITY = 1;
const BULL = { w: 380, h: 513, drawH: 88, rightGap: 5.8, top: -3 };
const BEAR = { w: 380, h: 510, drawW: 59, right: -1, top: -9.19 };

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bull "B3 bust": anchored to the button's right edge so narrow and wide phones all keep the head uncropped. x = 105 at the 176pt canvas width. */
export function bullFrame(buttonW: number): Frame {
  const w = (BULL.drawH * BULL.w) / BULL.h; // 65.2
  return { x: buttonW - BULL.rightGap - w, y: BULL.top, w, h: BULL.drawH };
}

/** Bear "R1 swipe": the canvas box is 59×68 at right −1, bottom −5 with object-fit cover and object-position 49.58% 73.22%. */
export function bearFrame(buttonW: number): Frame {
  const w = BEAR.drawW; // 59
  const h = (BEAR.drawW * BEAR.h) / BEAR.w; // 79.18: cover scale max(59/380, 68/510) = 0.15526; the button clips the 68pt box
  return { x: buttonW - BEAR.drawW - BEAR.right, y: BEAR.top, w, h }; // y = −1 − 11.18 × 0.7322 = −9.19
}
```

Run: `pnpm test -- gradient beast-frame` → PASS.

- [ ] **Step 4: TradeButton** — `apps/mobile/src/trade/TradeButton.tsx`

```tsx
import { Canvas, Group, Image as SkImage, LinearGradient, Rect, rect, rrect, useImage, vec } from "@shopify/react-native-skia";
import { memo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import bearArt from "../../assets/art/bear-r1.webp";
import bullArt from "../../assets/art/bull-b3.webp";
import { color, gradient, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { cssGradientPoints } from "@/ui/gradient";
import { Icon } from "@/ui/Icon";
import { BEAST_OPACITY, BUTTON_H, bearFrame, bullFrame } from "./beast-frame";

/**
 * Up/Down button. RN 0.86 has `mixBlendMode`, but Android only applies it from API 29 and minSdk is 26, so the gradient and the engraved art share one Skia canvas and the
 * art is drawn with blendMode "overlay" (the same W3C formula the design canvas used). Text and arrow are RN on
 * top. Until the art decodes the plain gradient shows.
 */
export const TradeButton = memo(function TradeButton({
  direction,
  label,
  sub,
  disabled,
  busy,
  onPress,
  testID,
  accessibilityLabel,
}: {
  direction: "UP" | "DOWN";
  label: string;
  /** "win ₹1,930", or null while the amount is invalid / payout unknown. */
  sub: string | null;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
}) {
  const up = direction === "UP";
  const [w, setW] = useState(0);
  // Both hooks run every render (rules-of-hooks); only one image is drawn.
  const bull = useImage(bullArt);
  const bear = useImage(bearArt);
  const art = up ? bull : bear;
  const g = up ? gradient.up : gradient.down;
  const p = cssGradientPoints(135, w, BUTTON_H);
  const frame = up ? bullFrame(w) : bearFrame(w);
  const ink = up ? color.upInk : color.downInk;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={({ pressed }) => ({
        flex: 1,
        height: BUTTON_H,
        borderRadius: radius.md,
        overflow: "hidden",
        justifyContent: "center",
        gap: 1,
        paddingLeft: 16,
        paddingRight: up ? 30 : 16,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {w > 0 ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Canvas style={{ flex: 1 }}>
            <Group clip={rrect(rect(0, 0, w, BUTTON_H), radius.md, radius.md)}>
              <Rect x={0} y={0} width={w} height={BUTTON_H}>
                <LinearGradient start={vec(p.start.x, p.start.y)} end={vec(p.end.x, p.end.y)} colors={[...g.colors]} positions={[...g.positions]} />
              </Rect>
              {art ? (
                <SkImage image={art} x={frame.x} y={frame.y} width={frame.w} height={frame.h} fit="fill" blendMode="overlay" opacity={BEAST_OPACITY} />
              ) : null}
              <Rect x={0} y={0} width={w} height={1} color={g.highlight} />
            </Group>
          </Canvas>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={up ? "arrowUp" : "arrowDown"} size={18} strokeWidth={2.25} color={ink} />
        <Txt weight={600} size={20} lineHeight={24} color={ink}>
          {label}
        </Txt>
        {busy ? <ActivityIndicator size="small" color={ink} /> : null}
      </View>
      {sub ? (
        <Txt font="fig" weight={500} size={12} tracking={-0.02} lineHeight={15} color={ink}>
          {sub}
        </Txt>
      ) : null}
    </Pressable>
  );
});
```

(Metro resolves `bull-b3.webp` to the `@2x`/`@3x` files by density; Skia's `useImage` accepts the asset id.)

- [ ] **Step 5: Wire it into the Dock and rename Buy/Sell** — in `apps/mobile/src/trade/Dock.tsx` replace the whole `{(["UP", "DOWN"] as const).map(...)}` row (`<View style={{ flexDirection: "row", gap: space(2) }}>` … `</View>` that contains `testID={up ? "buy" : "sell"}`) with:

```tsx
      <View style={{ flexDirection: "row", gap: 10 }}>
        {(["UP", "DOWN"] as const).map((dir) => {
          const up = dir === "UP";
          const label = up ? t("trade.up") : t("trade.down");
          const payoutText = payoutPct !== null ? t("trade.payout", { pct: payoutPct }) : "";
          // What comes back on a win: the stake plus the profit (the canvas shows "win ₹1,930" for ₹1,000 at 93%).
          const win = check.ok && profit !== null ? t("trade.win", { amount: money(grossReturnMinor(check.minor, profit), currency, { trim: true }) }) : null;
          return (
            <TradeButton
              key={dir}
              direction={dir}
              testID={up ? "buy" : "sell"}
              label={label}
              sub={win}
              accessibilityLabel={[label, payoutText, win ?? ""].filter(Boolean).join(", ")}
              disabled={blocked}
              busy={busy}
              onPress={() => void submit(dir)}
            />
          );
        })}
      </View>
```

and add `grossReturnMinor` to the `@asm/client-core` import and `import { TradeButton } from "./TradeButton";`. In `PositionStrip.tsx` and `TradesSheet.tsx` replace `t("trade.buy")` → `t("trade.up")` and `t("trade.sell")` → `t("trade.down")`. Then:

```bash
cd $W/apps/mobile && grep -rn '"trade.buy"\|"trade.sell"\|trade\.buy\b\|trade\.sell\b' src app ; echo "left=$?"   # expect left=1
```

- [ ] **Step 6: Strings** — delete `trade.buy` and `trade.sell` from both files; add:

| key | en | hi |
|---|---|---|
| `trade.up` | `Up` | `ऊपर` |
| `trade.down` | `Down` | `नीचे` |
| `trade.win` | `win {{amount}}` | `जीत {{amount}}` |

- [ ] **Step 7: Run the Gate.**

- [ ] **Step 8: Commit**

```bash
cd $W && git add apps/mobile/assets/art apps/mobile/src/ui/gradient.ts apps/mobile/src/ui/gradient.test.ts apps/mobile/src/trade apps/mobile/src/i18n
git commit -m "feat(mobile): Up/Down buttons with engraved bull and bear (Skia overlay blend), Buy/Sell renamed Up/Down

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (Main, Up/Down buttons):** 62pt gradient buttons, bull bust on the right of Up with its head fully visible, bear swiping in on Down, lines brightened by the overlay (not grey paste-on); "↑ Up / win ₹1,930" dark ink on green, "↓ Down" white on red; pressed state dims; disabled at 50%; e2e `buy`/`sell` still tappable. Check at 360dp width too (bull must not be cut at the right edge).

---

### Task 7: Dock, amount keypad (with words), trade length sheet

**Files:**
- Modify: `apps/mobile/src/trade/Dock.tsx` (whole file), `KeypadSheet.tsx` (whole file), `ExpirySheet.tsx` (whole file)
- Modify: `en.json`, `hi.json`

**Interfaces:**
- Consumes: `Chip`, `Money`, `DashedRule`, `Button kind="light"`, `Icon "delete"`, `money`, `groupTyped`, `amountInWords`, `TradeButton`, `useNow`, `Sheet aside/flush`.
- Produces: `KeypadSheet` props `{ currency, accountType: "DEMO"|"LIVE", payoutPct: number|null, value, onKey, onPreset, onDone }`; `ExpirySheet` props unchanged.

- [ ] **Step 1: Dock** — `apps/mobile/src/trade/Dock.tsx` (whole file; logic identical to today, layout from the canvas)

```tsx
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { EXPIRY_CHIPS, currencySymbol, formatDuration, grossReturnMinor, isChipExpiry, minStakeMinor, profitForStake } from "@asm/client-core";
import type { Bootstrap } from "@asm/contracts";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { Money } from "@/ui/Money";
import type { SheetRef } from "@/ui/Sheet";
import { ExpirySheet } from "./ExpirySheet";
import { KeypadSheet } from "./KeypadSheet";
import { payoutPctFor, type AppAsset } from "./markets";
import { prefsFor } from "./prefs-model";
import { MAX_STAKE_MINOR, resolveExpiry, stakeAfterKey, stakeAmountOpts, stakeDisplay, stakeFor, validateStake, withStake } from "./stake-input";
import { TradeButton } from "./TradeButton";
import { useTradePrefs, useUserPrefs } from "./trade-prefs";
import { useTradeSubmit } from "./useTradeSubmit";

/**
 * Amount, trade length and Up/Down. The bottom nav below already adds the bottom safe-area inset, so the dock has
 * none. Expiry and the stake (kept separately for each currency) are saved per user. The stake is checked against
 * the account's real + bonus balance, as the server does, and keypad presses are applied to the latest saved stake.
 */
export function Dock({ boot, accountId, asset }: { boot: Bootstrap; accountId: string; asset: AppAsset }) {
  const { t } = useTranslation();
  const prefs = useUserPrefs(boot.userId);
  const account = boot.accounts.find((a) => a.id === accountId);
  const bal = useSocket((s) => s.trades.balances[accountId]) ?? account;
  const livePayout = useSocket((s) => (s.chart.symbol === asset.symbol ? s.chart.payoutPct : null));
  const payoutPct = payoutPctFor(asset, livePayout);

  const currency = account?.currency ?? "USD";
  const expirySec = resolveExpiry(prefs.expirySec);
  // Each currency keeps its own stake, so switching DEMO <-> LIVE never reads ₹5,000 as $5,000.
  const stake = stakeFor(prefs.stakeByCurrency, currency);

  const { set } = prefs;
  // Keypad presses build on the saved stakes as they are NOW, not the copy this render closed over.
  const latestStakes = () => prefsFor(useTradePrefs.getState().byUser, boot.userId).stakeByCurrency;

  const available = bal ? bal.realBalance + bal.bonusBalance : 0;
  const check = validateStake(stake, currency, available);
  const { submit, busy } = useTradeSubmit({ accountId, symbol: asset.symbol, stakeMinor: check.ok ? check.minor : null, durationSec: expirySec });
  const keypad = useRef<SheetRef>(null);
  const expiry = useRef<SheetRef>(null);

  if (!account) return null;
  const profit = check.ok ? profitForStake(check.minor, payoutPct) : null;
  const blocked = !check.ok || busy;

  const problem = !check.ok
    ? check.reason === "min"
      ? t("trade.minStake", { amount: money(minStakeMinor(currency), currency) })
      : check.reason === "max"
        ? t("trade.maxStake", { amount: money(MAX_STAKE_MINOR, currency) })
        : check.reason === "balance"
          ? t("trade.insufficient")
          : null
    : null;

  const stakeLabel = check.ok ? money(check.minor, currency) : stake === "" ? "—" : `${currencySymbol(currency)}${stakeDisplay(stake, currency)}`;
  const moreSelected = !isChipExpiry(expirySec);

  return (
    <View style={{ paddingTop: 10, paddingHorizontal: 14, paddingBottom: 8, gap: 10, borderTopWidth: 1, borderTopColor: color.ruleSoft, backgroundColor: color.dock }}>
      <Pressable
        testID="stake-tile"
        accessibilityRole="button"
        accessibilityLabel={t("trade.stakeButton", { amount: stakeLabel })}
        onPress={() => keypad.current?.present()}
        style={({ pressed }) => ({
          minHeight: 44,
          paddingTop: 8,
          paddingBottom: 7,
          paddingHorizontal: 12,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: problem ? color.downText : color.rule,
          backgroundColor: pressed ? color.raised : color.ground,
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
        })}
      >
        <Txt size={13} color={color.ink3}>
          {t("trade.amount")}
        </Txt>
        <Money text={stakeLabel} size={22} weight={600} tracking={-0.03} lineHeight={28} color={problem ? color.downText : color.ink} />
      </Pressable>

      {problem ? (
        <Txt accessibilityLiveRegion="polite" size={12} color={color.downText}>
          {problem}
        </Txt>
      ) : null}

      <View style={{ flexDirection: "row", gap: 6 }}>
        {EXPIRY_CHIPS.map((c) => (
          <Chip
            key={c.sec}
            testID={`expiry-${c.sec}`}
            label={formatDuration(c.sec)}
            accessibilityLabel={t("trade.expiryOption", { label: formatDuration(c.sec) })}
            selected={expirySec === c.sec}
            onPress={() => set({ expirySec: c.sec })}
            style={{ flex: 1, paddingHorizontal: 4 }}
          />
        ))}
        <Chip
          label={moreSelected ? formatDuration(expirySec) : t("trade.more")}
          accessibilityLabel={moreSelected ? t("trade.expiryOption", { label: formatDuration(expirySec) }) : t("trade.more")}
          selected={moreSelected}
          onPress={() => expiry.current?.present()}
          style={{ flex: 1, paddingHorizontal: 4 }}
        />
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        {(["UP", "DOWN"] as const).map((dir) => {
          const up = dir === "UP";
          const label = up ? t("trade.up") : t("trade.down");
          const payoutText = payoutPct !== null ? t("trade.payout", { pct: payoutPct }) : "";
          // What comes back on a win: the stake plus the profit (the canvas shows "win ₹1,930" for ₹1,000 at 93%).
          const win = check.ok && profit !== null ? t("trade.win", { amount: money(grossReturnMinor(check.minor, profit), currency, { trim: true }) }) : null;
          return (
            <TradeButton
              key={dir}
              direction={dir}
              testID={up ? "buy" : "sell"}
              label={label}
              sub={win}
              accessibilityLabel={[label, payoutText, win ?? ""].filter(Boolean).join(", ")}
              disabled={blocked}
              busy={busy}
              onPress={() => void submit(dir)}
            />
          );
        })}
      </View>

      <KeypadSheet
        ref={keypad}
        currency={currency}
        accountType={account.type}
        payoutPct={payoutPct}
        value={stake}
        onKey={(key) => set({ stakeByCurrency: stakeAfterKey(latestStakes(), currency, key, stakeAmountOpts(currency)) })}
        onPreset={(text) => set({ stakeByCurrency: withStake(latestStakes(), currency, text) })}
        onDone={() => keypad.current?.dismiss()}
      />
      <ExpirySheet
        ref={expiry}
        value={expirySec}
        onPick={(sec) => {
          set({ expirySec: sec });
          expiry.current?.dismiss();
        }}
      />
    </View>
  );
}
```

(If `account.type` is not typed `"DEMO" | "LIVE"` on the bootstrap account, use `account.type === "LIVE" ? "LIVE" : "DEMO"`.)

- [ ] **Step 2: KeypadSheet** — `apps/mobile/src/trade/KeypadSheet.tsx` (whole file)

```tsx
import * as Haptics from "expo-haptics";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { currencySymbol, grossReturnMinor, profitForStake, stakePresets, stakeToMinor } from "@asm/client-core";
import { money } from "@/money/format";
import { amountInWords } from "@/money/words";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { DashedRule } from "@/ui/DashedRule";
import { Icon } from "@/ui/Icon";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { stakeAmountOpts, stakeDisplay } from "./stake-input";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "back"],
] as const;

const light = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

/**
 * Cheque-style amount: the figure, the amount in words (INR), quick amounts, what a win pays, a ledger keypad
 * and a white Done (blue is kept for actions that move money). It only reports presses: the owner applies each one
 * to the LATEST saved stake (`stakeAfterKey`), never to the `value` it rendered, so fast presses cannot drop a digit.
 */
export const KeypadSheet = forwardRef<
  SheetRef,
  {
    currency: string;
    accountType: "DEMO" | "LIVE";
    payoutPct: number | null;
    value: string;
    onKey: (key: string) => void;
    onPreset: (text: string) => void;
    onDone: () => void;
  }
>(function KeypadSheet({ currency, accountType, payoutPct, value, onKey, onPreset, onDone }, ref) {
  const { t, i18n } = useTranslation();
  const opts = stakeAmountOpts(currency);
  const minor = stakeToMinor(value);
  const profit = profitForStake(minor, payoutPct);
  const figure = `${currencySymbol(currency)} ${stakeDisplay(value, currency)}`;
  const words = currency === "INR" ? amountInWords(Math.floor(minor / 100), i18n.language.startsWith("hi") ? "hi" : "en") : "";

  const press = (key: string) => {
    light();
    onKey(key);
  };

  return (
    <Sheet ref={ref} title={t("trade.amount")} aside={t(accountType === "LIVE" ? "trade.liveAccount" : "trade.demoAccount")} flush>
      <View style={{ paddingHorizontal: 20, gap: 4 }}>
        <Txt
          font="fig"
          weight={600}
          size={46}
          tracking={-0.05}
          lineHeight={56}
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={`${t("trade.amount")}: ${figure}`}
          accessibilityLiveRegion="polite"
        >
          {figure}
        </Txt>
        {words ? (
          <>
            <DashedRule />
            <Txt size={16} color={color.ink2} style={{ paddingTop: 2 }}>
              {words}
            </Txt>
          </>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 16 }}>
        {stakePresets(currency).map((amount) => (
          <Chip
            key={amount}
            figures
            label={money(stakeToMinor(String(amount)), currency, { trim: true })}
            selected={value === String(amount)}
            onPress={() => {
              light();
              onPreset(String(amount));
            }}
            style={{ flex: 1, paddingHorizontal: 4 }}
          />
        ))}
      </View>

      {payoutPct !== null ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
          <Txt size={15} color={color.ink2}>
            {t("trade.ifYouWin", { pct: payoutPct })}
          </Txt>
          {profit !== null ? (
            <Money text={money(grossReturnMinor(minor, profit), currency)} size={15} weight={600} color={color.up} />
          ) : (
            <Txt font="fig" size={15} color={color.ink3}>
              —
            </Txt>
          )}
        </View>
      ) : (
        <View style={{ height: 16 }} />
      )}

      <View style={{ borderTopWidth: 1, borderTopColor: color.ruleSoft }}>
        {ROWS.map((row) => (
          <View key={row.join("")} style={{ flexDirection: "row" }}>
            {row.map((key, col) => {
              const cell = {
                flex: 1,
                height: 56,
                borderBottomWidth: 1,
                borderLeftWidth: col === 1 ? 1 : 0,
                borderRightWidth: col === 1 ? 1 : 0,
                borderColor: color.ruleSoft,
                alignItems: "center",
                justifyContent: "center",
              } as const;
              if (key === "." && !opts.decimals) return <View key={key} style={cell} />;
              const isBack = key === "back";
              return (
                <Pressable
                  key={key}
                  testID={`key-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={isBack ? t("trade.delete") : key === "." ? t("trade.point") : key}
                  onPress={() => press(key)}
                  onLongPress={isBack ? () => onPreset("") : undefined}
                  style={({ pressed }) => [cell, pressed ? { backgroundColor: color.raised } : null]}
                >
                  {isBack ? (
                    <Icon name="delete" size={26} color={color.ink2} />
                  ) : (
                    <Txt weight={500} size={27} lineHeight={34} color={key === "." ? color.ink3 : color.ink}>
                      {key}
                    </Txt>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}>
        <Button testID="keypad-done" kind="light" label={t("common.done")} onPress={onDone} />
      </View>
    </Sheet>
  );
});
```

- [ ] **Step 3: ExpirySheet** — `apps/mobile/src/trade/ExpirySheet.tsx` (whole file)

```tsx
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { clockTime, formatDuration } from "@asm/client-core";
import { TRADE_DURATIONS_SEC } from "@asm/contracts";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { useNow } from "./useNow";

/** The clock time a trade placed now would end at; the only part that re-renders each second. */
function EndsAt({ sec }: { sec: number }) {
  const now = useNow(1000);
  return (
    <Txt font="fig" weight={600} size={16} tracking={-0.02} accessibilityLiveRegion="none">
      {clockTime(Math.floor(now / 1000) + sec)}
    </Txt>
  );
}

/** Every trade length the server offers, plus the exact end time. The parent applies the pick and closes the sheet. */
export const ExpirySheet = forwardRef<SheetRef, { value: number; onPick: (sec: number) => void }>(function ExpirySheet({ value, onPick }, ref) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t("trade.tradeLength")} flush>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 8, paddingHorizontal: 20 }}>
        {TRADE_DURATIONS_SEC.map((sec) => {
          const label = formatDuration(sec);
          return (
            <Chip
              key={sec}
              label={label}
              height={44}
              size={15}
              selected={sec === value}
              accessibilityLabel={t("trade.expiryOption", { label })}
              onPress={() => onPick(sec)}
              style={{ width: "23%" }}
            />
          );
        })}
      </View>
      <View
        style={{
          marginTop: 16,
          borderTopWidth: 1,
          borderTopColor: color.ruleSoft,
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 28,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <Txt size={15} color={color.ink2} style={{ flexShrink: 1 }}>
          {t("trade.endsAt")}
        </Txt>
        <EndsAt sec={value} />
      </View>
    </Sheet>
  );
});
```

- [ ] **Step 4: Strings** — add (both files); change the en value of `trade.stakeButton` to `Amount {{amount}}. Tap to change.` (hi already says राशि):

| key | en | hi |
|---|---|---|
| `trade.amount` | `Amount` | `राशि` |
| `trade.demoAccount` | `Demo account` | `डेमो खाता` |
| `trade.liveAccount` | `Live account` | `लाइव खाता` |
| `trade.ifYouWin` | `If you win ({{pct}}%)` | `जीतने पर ({{pct}}%)` |
| `trade.tradeLength` | `Trade length` | `ट्रेड की अवधि` |
| `trade.endsAt` | `A trade placed now ends at` | `अभी लगाया गया ट्रेड इस समय खत्म होगा` |

- [ ] **Step 5: Run the Gate.**

- [ ] **Step 6: Commit**

```bash
cd $W && git add apps/mobile/src/trade/Dock.tsx apps/mobile/src/trade/KeypadSheet.tsx apps/mobile/src/trade/ExpirySheet.tsx apps/mobile/src/i18n
git commit -m "feat(mobile): Passbook dock, cheque-style amount keypad with words, trade length sheet with end time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (Main dock, A-Keypad, A-Expiry):** dock on `#0b0f14` with the amount box, 5 pill chips (white selected) and the Up/Down pair; keypad sheet: "Amount · Demo account", `₹ 2,500` in Martian 46, dashed rule, "Two thousand five hundred rupees only" (Hindi: "दो हज़ार पाँच सौ रुपये मात्र"), 5 quick amounts fitting one row at 360dp, "If you win (93%) ₹4,825.00", ledger keypad, white Done. No words anywhere on the Trade screen itself. Trade length: 4-column chips, end time ticking.

---

### Task 8: Trade chrome — overlay row, bonus stamp, status line, chart colours, position strip

**Files:**
- Modify: `apps/mobile/src/trade/MarketPill.tsx`, `ChartTools.tsx`, `StatusRow.tsx` (whole file), `PositionStrip.tsx` (whole file)
- Modify: `apps/mobile/app/(tabs)/trade.tsx` (overlay, status line, strip props)
- Modify: `apps/mobile/src/chart/Chart.tsx` (colours, price tag, trade tag, Skia font, OHLC position)
- Modify: `en.json`, `hi.json`

**Interfaces:**
- Consumes: `Stamp`, `Money`, `Txt`, `Icon chevronDown/more`, `money`.
- Produces: `ChartTools` gains `trailing?: ReactNode`; `StatusRow.tsx` exports `StatusLine({ snapshot, symbol, timeframe })` and `BonusStamp({ pct, onPress })` (no more `StatusRow`); `PositionStrip` props `{ accountId, accountType: "DEMO"|"LIVE", assets, currency }` (accountType is passed through to `TradesSheet` in Task 9 — until then it is unused, prefix the destructured name with `_` if eslint complains).

- [ ] **Step 1: MarketPill** — replace the `<Pressable …>…</Pressable>` in `MarketPill.tsx` with:

```tsx
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("trade.selectMarket", { name })}
        onPress={() => sheet.current?.present()}
        hitSlop={2}
        style={({ pressed }) => ({
          height: 40,
          maxWidth: 220,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          borderRadius: radius.pill,
          backgroundColor: pressed ? color.raised : color.overlayPill,
          borderWidth: 1,
          borderColor: color.rule,
        })}
      >
        <Txt weight={600} size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Txt>
        {payout !== null ? (
          <Txt font="fig" weight={500} size={13} color={color.up}>
            {t("trade.payout", { pct: payout })}
          </Txt>
        ) : null}
        <Icon name="chevronDown" size={16} strokeWidth={2} color={color.ink3} />
      </Pressable>
```

(imports: drop `Text`/`space`, add `Txt`, `Icon`.)

- [ ] **Step 2: ChartTools** — in `ChartTools.tsx`:
  - delete the local `Chip` function and import `Chip` from `@/ui/Chip`;
  - add prop `trailing?: ReactNode` (doc: "pushed to the row's right edge, e.g. the bonus stamp");
  - the outer View gets `style={{ alignSelf: "stretch", alignItems: "flex-start", gap: space(1) }}`; the row View becomes `style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8 }}` and renders `{leading}`, the tools button, `<View style={{ flex: 1 }} />`, `{trailing}`;
  - the tools button style: `width: 40, height: 40, borderRadius: 20, backgroundColor: open ? color.raised : color.overlayPill, borderWidth: 1, borderColor: open ? color.accentText : color.rule`, `hitSlop={2}`, icon `<Icon name="more" size={18} color={open ? color.ink : color.ink2} />`;
  - the expanded panel: `backgroundColor: color.surface, borderRadius: radius.md, borderWidth: 1, borderColor: color.rule, padding: 8, gap: 8`, each row `flexDirection: "row", flexWrap: "wrap", gap: 6`, chips `<Chip key={type} label={t(\`trade.${type}\`)} height={36} size={13} selected={chartType === type} onPress={() => onChartType(type)} />` and `<Chip key={tf} figures label={tf} height={36} size={13} selected={timeframe === tf} onPress={() => onTimeframe(tf)} />`.

- [ ] **Step 3: StatusRow.tsx → StatusLine + BonusStamp** (whole file)

```tsx
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { clockTime } from "@asm/client-core";
import type { Timeframe } from "@asm/contracts";
import type { ResumeSnapshot } from "@/cache/codec";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Stamp } from "@/ui/Stamp";
import { chartSource } from "./chart-source";
import { useNow } from "./useNow";

/** Green while the engine socket is authenticated, red otherwise. Re-renders only when that flips. */
function LiveDot() {
  const live = useSocket((s) => s.phase === "authed");
  return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: live ? color.up : color.downText }} />;
}

/** The only part of the line that re-renders each second. */
function Clock() {
  const now = useNow();
  return (
    <Txt font="fig" size={11} color={color.ink3}>
      {clockTime(Math.floor(now / 1000))}
    </Txt>
  );
}

/** "Saved data — updating…" only while the candles on screen really are the resume snapshot's. */
function StaleNote({ snapshot, symbol, timeframe }: { snapshot: ResumeSnapshot | null; symbol: string | null; timeframe: Timeframe }) {
  const { t } = useTranslation();
  const showing = useSocket((s) => symbol !== null && chartSource({ symbol, timeframe, chart: s.chart, snapshot }) === "snapshot");
  if (!showing) return null;
  return (
    <Txt accessibilityLiveRegion="polite" numberOfLines={1} size={11} color={color.gold} style={{ flexShrink: 1 }}>
      {t("trade.stale")}
    </Txt>
  );
}

/** Quiet status line at the chart's bottom-left: connection dot, clock, stale-data note. */
export const StatusLine = memo(function StatusLine({
  snapshot,
  symbol,
  timeframe,
}: {
  /** The resume snapshot, or null once live candles have arrived (it is then never shown again). */
  snapshot: ResumeSnapshot | null;
  symbol: string | null;
  timeframe: Timeframe;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <LiveDot />
      <Clock />
      <StaleNote snapshot={snapshot} symbol={symbol} timeframe={timeframe} />
    </View>
  );
});

/** Gold "+100% BONUS" stamp in the chart's overlay row; opens the bonus sheet. Bonus appears on /trade only. */
export function BonusStamp({ pct, onPress }: { pct: number; onPress: () => void }) {
  const { t } = useTranslation();
  const label = t("trade.bonus", { pct });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}>
      <Stamp label={label} tone="gold" size="md" />
    </Pressable>
  );
}
```

- [ ] **Step 4: Trade screen wiring** — in `app/(tabs)/trade.tsx`:
  - import `{ BonusStamp, StatusLine }` from `@/trade/StatusRow` instead of `StatusRow`; delete the `<StatusRow … />` line;
  - overlay container: `style={{ position: "absolute", top: 10, left: 12, right: 12 }}` and pass `trailing={bonus?.pct ? <BonusStamp pct={bonus.pct} onPress={openBonus} /> : null}` to `<ChartTools>`;
  - inside the chart `<View style={{ flex: 1 }}>`, after `<SentimentBar />`, add:

```tsx
        <View pointerEvents="none" style={{ position: "absolute", left: 12, bottom: 8, right: 120 }}>
          <StatusLine snapshot={candleSnapshot} symbol={symbol} timeframe={timeframe} />
        </View>
```

  - pass `accountType={account.type}` to `<PositionStrip>`.

- [ ] **Step 5: PositionStrip** (whole file)

```tsx
import { memo, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Circle, Svg } from "react-native-svg";
import { RING_LENGTH, ringOffset, soonestOpen } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color, radius } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Money } from "@/ui/Money";
import type { SheetRef } from "@/ui/Sheet";
import type { AppAsset } from "./markets";
import { countdownText } from "./countdown-text";
import { TradesSheet } from "./TradesSheet";
import { useLiveTrade } from "./useLiveTrade";

const NO_TRADES: readonly TradeView[] = [];

/**
 * A pending passbook entry. Ticks on its own each second (and with the price), so the chart and dock around it
 * never re-render for it. Keyed by trade id by the parent, so the frozen figure resets when the soonest trade changes.
 */
const StripBody = memo(function StripBody({
  trade,
  more,
  name,
  precision,
  currency,
  onOpen,
}: {
  trade: TradeView;
  more: number;
  name: string;
  precision: number;
  currency: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const live = useLiveTrade(trade);
  const { remainingSec, totalSec, pnl } = live;
  const up = trade.direction === "UP";
  const dirColor = up ? color.up : color.downText;
  const side = up ? t("trade.up") : t("trade.down");
  const stake = money(trade.stake, currency);
  const time = countdownText(live, t("trade.settling"));
  const label =
    (live.expired ? t("trade.positionLabelSettling", { side, name, stake }) : t("trade.positionLabel", { side, name, stake, time })) +
    (more > 0 ? ` ${t("trade.moreOpen", { n: more })}` : "");
  const detail = t("trade.at", { stake, price: trade.entryPrice.toFixed(precision) }) + (more > 0 ? ` · ${t("trade.moreOpen", { n: more })}` : "");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onOpen}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.ruleSoft,
        backgroundColor: pressed ? color.raised : color.surface,
      })}
    >
      <Svg width={34} height={34} viewBox="0 0 34 34" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={17} cy={17} r={14} fill="none" strokeWidth={4} stroke={color.rule} />
        <Circle
          cx={17}
          cy={17}
          r={14}
          fill="none"
          strokeWidth={4}
          stroke={dirColor}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={ringOffset(remainingSec, totalSec)}
        />
      </Svg>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt weight={600} size={15} numberOfLines={1}>
          <Txt weight={600} size={15} color={dirColor}>
            {side}
          </Txt>
          {` ${name} `}
          <Txt font="fig" weight={500} size={12} color={color.ink2}>
            {time}
          </Txt>
        </Txt>
        <Txt font="fig" size={12} tracking={-0.02} color={color.ink3} numberOfLines={1}>
          {detail}
        </Txt>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {pnl === null ? (
          <Txt font="fig" weight={600} size={15} color={color.ink3}>
            —
          </Txt>
        ) : (
          <Money text={`${pnl.sign}${money(pnl.amountMinor, currency)}`} size={15} weight={600} color={pnl.tone === "up" ? color.up : color.downText} />
        )}
        <Txt size={12} color={color.ink3}>
          {t("trade.ifClosedNow")}
        </Txt>
      </View>
    </Pressable>
  );
});

/**
 * The soonest-expiring open trade on the selected account (countdown ring, direction, stake at entry price,
 * "if it ends now"), with "+N more" when others are open; tapping it opens the trades sheet. Hidden when nothing
 * is open. The sheet stays mounted either way so it does not vanish under the user when the last open trade settles.
 */
export function PositionStrip({
  accountId,
  accountType,
  assets,
  currency,
}: {
  accountId: string;
  accountType: "DEMO" | "LIVE";
  assets: readonly AppAsset[];
  currency: string;
}) {
  const trades = useSocket((s) => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const soonest = useMemo(() => soonestOpen(trades), [trades]);
  const sheet = useRef<SheetRef>(null);
  const openSheet = useCallback(() => sheet.current?.present(), []);
  const asset = soonest ? assets.find((a) => a.symbol === soonest.trade.symbol) : undefined;
  return (
    <>
      {soonest ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
          <StripBody
            key={soonest.trade.id}
            trade={soonest.trade}
            more={soonest.more}
            name={asset?.displayName ?? soonest.trade.symbol}
            precision={asset?.precision ?? 5}
            currency={currency}
            onOpen={openSheet}
          />
        </View>
      ) : null}
      <TradesSheet ref={sheet} accountId={accountId} accountType={accountType} assets={assets} currency={currency} />
    </>
  );
}
```

Until Task 9 adds `accountType` to `TradesSheet`, add it there now as an accepted-but-unused optional prop: in `TradesSheet.tsx` extend the `forwardRef` props type with `accountType?: "DEMO" | "LIVE"` (Task 9 makes it required and uses it).

- [ ] **Step 6: Chart colours, tags, font** — in `apps/mobile/src/chart/Chart.tsx`:
  - imports: add `DashPathEffect`, `RoundedRect`, `useFont` to the Skia import; add `import { MartianMono_600SemiBold } from "@expo-google-fonts/martian-mono/600SemiBold";`;
  - `SeriesLayer`: every `color.down` → `color.downText` (canvas candles are `#ff7468`); `color.brand` (line/area) → `color.accent`;
  - font: replace `const font = useMemo(() => matchFont({ fontFamily: "sans-serif", fontSize: 11 }), []);` with

```tsx
  const fallbackFont = useMemo(() => matchFont({ fontFamily: "sans-serif", fontSize: 11 }), []);
  // Martian Mono (bundled) for prices on the canvas; the system font until it has loaded.
  const figFont = useFont(MartianMono_600SemiBold, 11);
  const font = figFont ?? fallbackFont;
```

  - `TradeLine`: add a `side: string` prop (the translated "Up"/"Down"); body:

```tsx
  const tone = direction === "UP" ? color.up : color.downText;
  const tri = useSkPath(
    direction === "UP" ? `M6 ${y - 4} L14 ${y - 4} L10 ${y - 11} Z` : `M6 ${y - 11} L14 ${y - 11} L10 ${y - 4} Z`,
  );
  const text = `${side} ${label}`;
  const tagW = font.getTextWidth(text) + 12;
  return (
    <Group>
      <Line p1={vec(0, y)} p2={vec(plotW, y)} color={color.accent} strokeWidth={1.5} />
      {tri ? <Path path={tri} color={tone} /> : null}
      <RoundedRect x={plotW - tagW - 4} y={y - 11} width={tagW} height={22} r={4} color={color.accent} />
      <SkText x={plotW - tagW + 2} y={y + 4} text={text} font={font} color={color.onAccent} />
    </Group>
  );
```

    and pass `side={tr.direction === "UP" ? t("trade.up") : t("trade.down")}` where `<TradeLine>` is rendered;
  - price line: `<Line p1={vec(0, priceY)} p2={vec(plotW, priceY)} color={color.ink3} strokeWidth={1}><DashPathEffect intervals={[4, 3]} /></Line>`;
  - price tag: replace the `Rect` + `SkText` pair with

```tsx
                    <RoundedRect x={plotW + 2} y={priceY - 11} width={PRICE_AXIS - 4} height={22} r={4} color={color.ink} />
                    <SkText x={plotW + 6} y={priceY + 4} text={fmt(lastPrice)} font={font} color={color.ground} />
```

  - crosshair line stays `color.ink2`;
  - OHLC strip: `top: 58` (below the overlay row), `backgroundColor: color.surface`, `borderWidth: 1, borderColor: color.rule`, text `<Txt font="fig" size={11}>` (replace the RN `Text`);
  - "Live" (back to live) button: `backgroundColor: color.accent`, label `<Txt weight={600} size={14} color={color.onAccent}>{t("trade.backToLive")} ›</Txt>`.

  If `SkFont.getTextWidth` is missing in 2.6.2 typings, use `font.measureText(text).width`.

- [ ] **Step 7: Strings** — add `trade.at`; change the values of `trade.ifClosedNow`:

| key | en | hi |
|---|---|---|
| `trade.at` | `{{stake}} at {{price}}` | `{{price}} पर {{stake}}` |
| `trade.ifClosedNow` (value change) | `if it ends now` | `अभी खत्म हो तो` |

- [ ] **Step 8: Run the Gate.**

- [ ] **Step 9: Commit**

```bash
cd $W && git add apps/mobile/src/trade apps/mobile/src/chart/Chart.tsx "apps/mobile/app/(tabs)/trade.tsx" apps/mobile/src/i18n
git commit -m "feat(mobile): Passbook trade chrome: overlay pills, bonus stamp, status line, chart tags, pending-entry strip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (Main):** overlay row: market pill + tools button + gold double-ruled "+100% BONUS" stamp at the right; tapping the stamp opens the bonus sheet; candles green/`#ff7468`; dashed grey last-price line with a white price tag (Martian); an open trade draws a blue 1.5pt line with a blue "Down 0:08" tag; status line bottom-left (dot + clock); the strip reads "Down BTC/USDT 0:08 / ₹100.00 at 94,553.62 / +₹193.00 if it ends now" with the ring. OHLC strip (long-press the chart) sits below the pills.

---

### Task 9: Trade sheets — Markets, Your trades (ledger), Deposit bonus

**Files:**
- Modify: `apps/mobile/src/trade/markets.ts`, `markets.test.ts` (category helpers)
- Modify: `apps/mobile/src/trade/closed-stamp.ts`, `closed-stamp.test.ts` (`ledgerStamp`)
- Modify: `apps/mobile/src/trade/MarketSheet.tsx`, `TradesSheet.tsx`, `BonusSheet.tsx` (whole files)
- Modify: `en.json`, `hi.json`

**Interfaces:**
- Consumes: `Chip`, `Stamp`, `LedgerHeader`, `LedgerRow`, `LedgerColumn`, `Money`, `money`, `dayNetMinor`, `Button`.
- Produces: `type MarketCategory = "all" | "starred" | "CRYPTO" | "INDEX" | "FOREX" | "COMMODITY"`; `categoriesFor(assets, favourites): MarketCategory[]`; `inCategory(asset, category, favourites): boolean`; `ledgerStamp(expiryTs, nowMs): { time: string; date: string | null }`; `TradesSheet` props `{ accountId, accountType: "DEMO"|"LIVE", assets, currency }`.

- [ ] **Step 1: Failing tests** — append to `markets.test.ts`:

```ts
import { categoriesFor, inCategory } from "./markets";

const a = (symbol: string, assetClass: string) => ({ symbol, displayName: symbol, precision: 2, payoutPct: 93, assetClass });

describe("market categories", () => {
  const assets = [a("BTCUSDT", "CRYPTO"), a("NIFTY50", "INDEX"), a("EURUSD", "FOREX")];
  it("lists All, Starred (when any) and the classes present, in canvas order", () => {
    expect(categoriesFor(assets, [])).toEqual(["all", "CRYPTO", "INDEX", "FOREX"]);
    expect(categoriesFor([...assets, a("XAUUSD", "COMMODITY")], ["EURUSD"])).toEqual(["all", "starred", "CRYPTO", "INDEX", "FOREX", "COMMODITY"]);
  });
  it("filters by class or by star", () => {
    expect(inCategory(a("BTCUSDT", "CRYPTO"), "CRYPTO", [])).toBe(true);
    expect(inCategory(a("BTCUSDT", "CRYPTO"), "INDEX", [])).toBe(false);
    expect(inCategory(a("BTCUSDT", "CRYPTO"), "starred", ["BTCUSDT"])).toBe(true);
    expect(inCategory(a("BTCUSDT", "CRYPTO"), "all", [])).toBe(true);
  });
});
```

(merge the import into the file's existing import from `./markets`.) Append to `closed-stamp.test.ts`:

```ts
import { ledgerStamp } from "./closed-stamp";

describe("ledgerStamp", () => {
  const now = new Date(2026, 9, 14, 18, 30).getTime();
  it("is HH:MM for today", () => {
    expect(ledgerStamp(new Date(2026, 9, 14, 18, 10, 42).getTime() / 1000, now)).toEqual({ time: "18:10", date: null });
  });
  it("adds dd/mm for an earlier day", () => {
    expect(ledgerStamp(new Date(2026, 9, 12, 9, 5).getTime() / 1000, now)).toEqual({ time: "09:05", date: "12/10" });
  });
});
```

Run: `pnpm test -- markets closed-stamp` → FAIL.

- [ ] **Step 2: Implement** — append to `markets.ts`:

```ts
export type MarketCategory = "all" | "starred" | "CRYPTO" | "INDEX" | "FOREX" | "COMMODITY";
const CLASS_ORDER = ["CRYPTO", "INDEX", "FOREX", "COMMODITY"] as const;

/** Chips for the markets sheet: All, Starred (if any are starred), then the asset classes present. */
export function categoriesFor(assets: readonly { assetClass: string }[], favourites: readonly string[]): MarketCategory[] {
  const present = new Set(assets.map((x) => x.assetClass));
  return ["all", ...(favourites.length > 0 ? (["starred"] as const) : []), ...CLASS_ORDER.filter((c) => present.has(c))];
}

export function inCategory(asset: { symbol: string; assetClass: string }, category: MarketCategory, favourites: readonly string[]): boolean {
  if (category === "all") return true;
  if (category === "starred") return favourites.includes(asset.symbol);
  return asset.assetClass === category;
}
```

append to `closed-stamp.ts`:

```ts
/** Ledger time column: "HH:MM", plus "dd/mm" when the trade closed on an earlier day (device time zone). */
export function ledgerStamp(expiryTs: number, nowMs: number): { time: string; date: string | null } {
  const d = new Date(expiryTs * 1000);
  const n = new Date(nowMs);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, date: sameDay ? null : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` };
}
```

Run: `pnpm test -- markets closed-stamp` → PASS.

- [ ] **Step 3: MarketSheet** (whole file)

```tsx
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { color, radius } from "@/theme/tokens";
import { Txt, useUiFamily } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { Icon } from "@/ui/Icon";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { categoriesFor, filterMarkets, inCategory, type AppAsset, type MarketCategory } from "./markets";

const SNAP_POINTS = ["75%", "92%"];
const CATEGORY_KEY: Record<MarketCategory, string> = {
  all: "trade.catAll",
  starred: "trade.catStarred",
  CRYPTO: "trade.catCrypto",
  INDEX: "trade.catIndex",
  FOREX: "trade.catForex",
  COMMODITY: "trade.catCommodity",
};
const CLASS_KEY: Record<string, string> = {
  CRYPTO: "trade.catCrypto",
  INDEX: "trade.catIndex",
  FOREX: "trade.catForex",
  COMMODITY: "trade.catCommodity",
};

function Row({
  asset,
  active,
  starred,
  onPick,
  onToggleFavourite,
}: {
  asset: AppAsset;
  active: boolean;
  starred: boolean;
  onPick: (symbol: string) => void;
  onToggleFavourite: (symbol: string) => void;
}) {
  const { t } = useTranslation();
  const classKey = CLASS_KEY[asset.assetClass];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: color.ruleSoft, backgroundColor: active ? color.raised : "transparent" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => onPick(asset.symbol)}
        style={{ flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingLeft: 20 }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight={600} size={16} numberOfLines={1}>
            {asset.displayName}
          </Txt>
          <Txt size={13} color={color.ink3} numberOfLines={1}>
            {classKey ? t(classKey) : asset.symbol}
          </Txt>
        </View>
        <Txt font="fig" weight={600} size={14} color={color.up} style={{ width: 44, textAlign: "right" }}>
          {t("trade.payout", { pct: asset.payoutPct })}
        </Txt>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(starred ? "trade.removeFavourite" : "trade.addFavourite", { name: asset.displayName })}
        onPress={() => onToggleFavourite(asset.symbol)}
        style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="star" filled={starred} color={starred ? color.gold : color.ink3} />
      </Pressable>
    </View>
  );
}

/** Searchable market list with category chips; starred markets first. Picking a row reports the symbol. */
export const MarketSheet = forwardRef<
  SheetRef,
  {
    assets: AppAsset[];
    activeSymbol: string | null;
    favourites: string[];
    onPick: (symbol: string) => void;
    onToggleFavourite: (symbol: string) => void;
  }
>(function MarketSheet({ assets, activeSymbol, favourites, onPick, onToggleFavourite }, ref) {
  const { t } = useTranslation();
  const family = useUiFamily(400);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketCategory>("all");
  const reset = useCallback(() => {
    setQuery("");
    setCategory("all");
  }, []);
  const { favourites: starred, rest } = filterMarkets(assets, query, favourites);
  const shown = [...starred.map((a) => ({ a, star: true })), ...rest.map((a) => ({ a, star: false }))].filter(({ a }) => inCategory(a, category, favourites));
  return (
    <Sheet ref={ref} title={t("trade.markets")} snapPoints={SNAP_POINTS} scroll flush onDismiss={reset}>
      <View style={{ paddingHorizontal: 20 }}>
        <View style={{ height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.rule, backgroundColor: color.ground, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}>
          <Icon name="search" size={18} color={color.ink3} />
          <BottomSheetTextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("trade.search")}
            placeholderTextColor={color.ink3}
            accessibilityLabel={t("trade.search")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{ flex: 1, height: 46, color: color.ink, fontSize: 16, fontFamily: family }}
          />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 12 }}>
        {categoriesFor(assets, favourites).map((c) => (
          <Chip key={c} label={t(CATEGORY_KEY[c])} selected={category === c} onPress={() => setCategory(c)} style={{ paddingHorizontal: 16 }} size={15} />
        ))}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: color.ruleSoft }}>
        {shown.map(({ a, star }) => (
          <Row key={a.symbol} asset={a} active={a.symbol === activeSymbol} starred={star} onPick={onPick} onToggleFavourite={onToggleFavourite} />
        ))}
        {shown.length === 0 ? (
          <Txt color={color.ink2} style={{ textAlign: "center", paddingVertical: 24 }}>
            {t("trade.noMarkets")}
          </Txt>
        ) : null}
      </View>
    </Sheet>
  );
});
```

(`AppAsset` must expose `assetClass`; it is in `AppAssetSchema`. If `markets.ts`'s `AppAsset` type omits it, add `assetClass: string` there.)

- [ ] **Step 4: TradesSheet** (whole file)

```tsx
import { forwardRef, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { closedRowDisplay } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";
import { money } from "@/money/format";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Chip } from "@/ui/Chip";
import { LedgerHeader, LedgerRow, type LedgerColumn } from "@/ui/Ledger";
import { Money } from "@/ui/Money";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Stamp } from "@/ui/Stamp";
import { ledgerStamp } from "./closed-stamp";
import { countdownText } from "./countdown-text";
import { dayNetMinor } from "./day-total";
import type { AppAsset } from "./markets";
import { useLiveTrade } from "./useLiveTrade";

const SNAP_POINTS = ["60%", "90%"];
const NO_TRADES: readonly TradeView[] = [];
const COLS: LedgerColumn[] = [{ width: 54 }, { flex: 1 }, { width: 104, align: "right" }];

type Tab = "open" | "closed";

const STAMP: Record<Exclude<TradeView["status"], "OPEN">, { key: "trade.statusWon" | "trade.statusLost" | "trade.statusRefund"; tone: "up" | "down" | "muted" }> = {
  WON: { key: "trade.statusWon", tone: "up" },
  LOST: { key: "trade.statusLost", tone: "down" },
  REFUNDED: { key: "trade.statusRefund", tone: "muted" },
};

function assetOf(assets: readonly AppAsset[], symbol: string) {
  return assets.find((a) => a.symbol === symbol);
}

function TradeCell({ name, side, up, detail }: { name: string; side: string; up: boolean; detail: string }) {
  return (
    <>
      <Txt weight={600} size={15} numberOfLines={1}>
        {`${name} `}
        <Txt weight={600} size={15} color={up ? color.up : color.downText}>
          {side}
        </Txt>
      </Txt>
      <Txt font="fig" size={11} tracking={-0.03} color={color.ink3} numberOfLines={1}>
        {detail}
      </Txt>
    </>
  );
}

/** Ticks on its own each second, so settled rows and the rest of the sheet never re-render for it. */
const OpenRow = memo(function OpenRow({ trade, assets, currency }: { trade: TradeView; assets: readonly AppAsset[]; currency: string }) {
  const { t } = useTranslation();
  const live = useLiveTrade(trade);
  const { pnl } = live;
  const asset = assetOf(assets, trade.symbol);
  const name = asset?.displayName ?? trade.symbol;
  const up = trade.direction === "UP";
  const side = up ? t("trade.up") : t("trade.down");
  const time = countdownText(live, t("trade.settling"));
  const pnlText = pnl === null ? "—" : `${pnl.sign}${money(pnl.amountMinor, currency)}`;
  return (
    <LedgerRow
      columns={COLS}
      accessibilityLabel={`${name} ${side}, ${time}, ${pnlText}`}
      cells={[
        <Txt key="time" font="fig" size={13} color={color.ink}>
          {time}
        </Txt>,
        <TradeCell key="trade" name={name} side={side} up={up} detail={`${money(trade.stake, currency, { trim: true })} · ${trade.entryPrice.toFixed(asset?.precision ?? 5)}`} />,
        pnl === null ? (
          <Txt key="result" font="fig" size={14} color={color.ink3}>
            —
          </Txt>
        ) : (
          <Money key="result" text={pnlText} size={14} weight={600} color={pnl.tone === "up" ? color.up : color.downText} />
        ),
      ]}
    />
  );
});

const ClosedRow = memo(function ClosedRow({ trade, assets, currency, nowMs }: { trade: TradeView; assets: readonly AppAsset[]; currency: string; nowMs: number }) {
  const { t } = useTranslation();
  const display = closedRowDisplay(trade);
  const asset = assetOf(assets, trade.symbol);
  const name = asset?.displayName ?? trade.symbol;
  const precision = asset?.precision ?? 5;
  const up = trade.direction === "UP";
  const side = up ? t("trade.up") : t("trade.down");
  const when = ledgerStamp(trade.expiryTs, nowMs);
  const prices =
    trade.exitPrice !== null
      ? t("trade.priceRange", { from: trade.entryPrice.toFixed(precision), to: trade.exitPrice.toFixed(precision) })
      : trade.entryPrice.toFixed(precision);
  const amount = `${display.sign}${money(display.amountMinor, currency)}`;
  const stamp = trade.status === "OPEN" ? null : STAMP[trade.status];
  const amountColor = display.sign === "+" ? color.up : display.sign === "−" ? color.downText : color.ink2;
  return (
    <LedgerRow
      columns={COLS}
      accessibilityLabel={`${when.time} ${name} ${side}, ${amount}${stamp ? `, ${t(stamp.key)}` : ""}`}
      cells={[
        <View key="time">
          <Txt font="fig" size={13} color={color.ink2}>
            {when.time}
          </Txt>
          {when.date ? (
            <Txt font="fig" size={10} color={color.ink3}>
              {when.date}
            </Txt>
          ) : null}
        </View>,
        <TradeCell key="trade" name={name} side={side} up={up} detail={`${money(trade.stake, currency, { trim: true })} · ${prices}`} />,
        <View key="result" style={{ alignItems: "flex-end", gap: 5 }}>
          <Money text={amount} size={14} weight={600} color={amountColor} />
          {stamp ? <Stamp label={t(stamp.key)} tone={stamp.tone} /> : null}
        </View>,
      ]}
    />
  );
});

/** Mounted only while the sheet is presented, so the store subscription and the row clocks exist only then. */
function TradesBody({ accountId, accountType, assets, currency }: { accountId: string; accountType: "DEMO" | "LIVE"; assets: readonly AppAsset[]; currency: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("open");
  // The store only ever holds live data (bootstrap + socket), never the resume snapshot's stale trades.
  const trades = useSocket((s) => s.trades.tradesByAccount[accountId]) ?? NO_TRADES;
  const { open, closed } = useMemo(
    () => ({
      open: trades.filter((x) => x.status === "OPEN").sort((a, b) => a.expiryTs - b.expiryTs),
      closed: trades.filter((x) => x.status !== "OPEN").sort((a, b) => b.expiryTs - a.expiryTs),
    }),
    [trades],
  );
  const nowMs = Date.now();
  const net = dayNetMinor(trades, nowMs);
  const shown = tab === "open" ? open : closed;
  return (
    <View>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 10 }}>
        <Chip role="tab" label={t("trade.open")} count={open.length} selected={tab === "open"} onPress={() => setTab("open")} size={15} style={{ paddingHorizontal: 16 }} />
        <Chip role="tab" label={t("trade.closed")} count={closed.length} selected={tab === "closed"} onPress={() => setTab("closed")} size={15} style={{ paddingHorizontal: 16 }} />
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <LedgerHeader columns={COLS} labels={[t("trade.colTime"), t("trade.colTrade"), t("trade.colResult")]} />
        {shown.length === 0 ? (
          <Txt color={color.ink2} style={{ textAlign: "center", paddingVertical: 32 }}>
            {t("trade.noTrades")}
          </Txt>
        ) : (
          shown.map((x) =>
            tab === "open" ? (
              <OpenRow key={x.id} trade={x} assets={assets} currency={currency} />
            ) : (
              <ClosedRow key={x.id} trade={x} assets={assets} currency={currency} nowMs={nowMs} />
            ),
          )
        )}
      </View>
      {net !== null ? (
        <View style={{ marginTop: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, borderTopWidth: 1, borderTopColor: color.rule, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Txt size={15} color={color.ink2}>
            {t("trade.todayAccount", { account: accountType === "LIVE" ? t("trade.live") : t("trade.demo") })}
          </Txt>
          <Money
            text={`${net > 0 ? "+" : ""}${money(net, currency)}`}
            size={16}
            weight={600}
            color={net > 0 ? color.up : net < 0 ? color.downText : color.ink2}
          />
        </View>
      ) : (
        <View style={{ height: 28 }} />
      )}
    </View>
  );
}

/** The selected account's trades as a small passbook: Open (live countdown) and Closed (stamped), with today's total. */
export const TradesSheet = forwardRef<SheetRef, { accountId: string; accountType: "DEMO" | "LIVE"; assets: readonly AppAsset[]; currency: string }>(function TradesSheet(
  { accountId, accountType, assets, currency },
  ref,
) {
  const { t } = useTranslation();
  return (
    <Sheet ref={ref} title={t("trade.yourTrades")} snapPoints={SNAP_POINTS} scroll flush>
      <TradesBody accountId={accountId} accountType={accountType} assets={assets} currency={currency} />
    </Sheet>
  );
});
```

`DirMark` is gone; confirm nothing imports it: `grep -rn "DirMark" $W/apps/mobile/src $W/apps/mobile/app` → no matches.

- [ ] **Step 5: BonusSheet** (whole file)

```tsx
import { router } from "expo-router";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { color } from "@/theme/tokens";
import { Button, Txt } from "@/theme/ui";
import { LedgerHeader, LedgerRow, type LedgerColumn } from "@/ui/Ledger";
import { Sheet, type SheetRef } from "@/ui/Sheet";
import { Stamp } from "@/ui/Stamp";
import { nextBonus } from "./markets";

const COLS: LedgerColumn[] = [{ flex: 1 }, { width: 80, align: "right" }, { width: 96, align: "right" }];

/** The bonus rules as a small table, gold only on the next tier; the withdrawal rule stays in words above the button. */
export const BonusSheet = forwardRef<SheetRef, { completedDeposits: number }>(function BonusSheet({ completedDeposits }, ref) {
  const { t } = useTranslation();
  const inner = useRef<SheetRef>(null);
  useImperativeHandle(ref, () => ({
    present: () => inner.current?.present(),
    dismiss: () => inner.current?.dismiss(),
  }));
  const { pct, tiers } = nextBonus(completedDeposits);
  return (
    <Sheet ref={inner} title={t("bonus.title")}>
      <Txt size={15} color={color.ink2}>
        {t("bonus.subtitle", { n: tiers.length })}
      </Txt>
      <View accessibilityRole="list">
        <LedgerHeader columns={COLS} labels={[t("bonus.colDeposit"), t("bonus.colBonus"), t("bonus.colStatus")]} />
        {tiers.map((tier) => {
          const nth = t(`bonus.nth${tier.n}`, { defaultValue: t("bonus.nthN", { n: tier.n }) });
          const state = t(`bonus.${tier.state}`);
          const next = tier.state === "next";
          return (
            <LedgerRow
              key={tier.n}
              columns={COLS}
              accessibilityLabel={`${nth}, ${tier.pct}%, ${state}`}
              cells={[
                <Txt key="n" weight={600} size={16} color={tier.state === "claimed" ? color.ink3 : color.ink}>
                  {nth}
                </Txt>,
                <Txt key="pct" font="fig" weight={next ? 600 : 500} size={15} color={next ? color.gold : tier.state === "claimed" ? color.ink3 : color.ink}>
                  {`${tier.pct}%`}
                </Txt>,
                next ? (
                  <Stamp key="state" label={state} tone="gold" />
                ) : tier.state === "claimed" ? (
                  <Stamp key="state" label={state} tone="muted" />
                ) : (
                  <Txt key="state" size={14} color={color.ink3}>
                    {state}
                  </Txt>
                ),
              ]}
            />
          );
        })}
      </View>
      <Txt size={14} color={color.ink2}>
        {t("bonus.note")}
      </Txt>
      {pct > 0 ? (
        <Button
          label={t("trade.deposit")}
          onPress={() => {
            inner.current?.dismiss();
            router.navigate("/payments");
          }}
        />
      ) : (
        <Txt color={color.ink2} style={{ textAlign: "center" }}>
          {t("bonus.allUsed")}
        </Txt>
      )}
    </Sheet>
  );
});
```

- [ ] **Step 6: Strings** — add (both files); change the value of `bonus.note`:

| key | en | hi |
|---|---|---|
| `trade.catAll` | `All` | `सभी` |
| `trade.catStarred` | `Starred` | `पसंदीदा` |
| `trade.catCrypto` | `Crypto` | `क्रिप्टो` |
| `trade.catIndex` | `India` | `भारत` |
| `trade.catForex` | `Forex` | `फ़ॉरेक्स` |
| `trade.catCommodity` | `Commodities` | `कमोडिटी` |
| `trade.yourTrades` | `Your trades` | `आपके ट्रेड` |
| `trade.colTime` | `Time` | `समय` |
| `trade.colTrade` | `Trade` | `ट्रेड` |
| `trade.colResult` | `Result` | `नतीजा` |
| `trade.priceRange` | `{{from}} to {{to}}` | `{{from}} से {{to}}` |
| `trade.todayAccount` | `Today, {{account}}` | `आज, {{account}}` |
| `bonus.colDeposit` | `Deposit` | `डिपॉज़िट` |
| `bonus.colBonus` | `Bonus` | `बोनस` |
| `bonus.colStatus` | `Status` | `स्थिति` |
| `bonus.note` (value change) | `The bonus is added when your deposit is credited. It is for trading only; only your real balance can be withdrawn.` | `डिपॉज़िट जमा होते ही बोनस जुड़ जाता है। यह सिर्फ़ ट्रेडिंग के लिए है; केवल आपका असली बैलेंस निकाला जा सकता है।` |

- [ ] **Step 7: Run the Gate.**

- [ ] **Step 8: Commit**

```bash
cd $W && git add apps/mobile/src/trade apps/mobile/src/i18n
git commit -m "feat(mobile): Passbook trade sheets: market categories, trades ledger with stamps and day total, bonus table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (A-Markets, A-Trades, A-Bonus):** markets: search box, category chips scroll horizontally, rows with name/category/payout/star (no price column — expected); trades: Open/Closed pills with counts, TIME/TRADE/RESULT ledger, WON/LOST stamps, "Today, Demo" total (true net); bonus: Deposit/Bonus/Status table with the gold NEXT stamp and a blue "Deposit" button.

---

### Task 10: Auth screens — brand login, labelled fields, language switch

**Files:**
- Create: `apps/mobile/src/ui/sparkline-path.ts`, `sparkline-path.test.ts`, `apps/mobile/src/ui/Sparkline.tsx`, `apps/mobile/src/ui/LanguageSwitch.tsx`
- Create: `apps/mobile/src/i18n/locale-pref.ts`
- Modify: `apps/mobile/src/i18n/keys.ts`, `apps/mobile/src/i18n/parity.test.ts` (resolveLocale tests)
- Modify: `apps/mobile/src/ui/form.tsx` (whole file)
- Modify: `apps/mobile/app/(auth)/login.tsx`, `register.tsx`, `forgot.tsx` (whole files), `apps/mobile/app/_layout.tsx` (saved locale)
- Modify: `en.json`, `hi.json`

**Interfaces:**
- Consumes: `Wordmark`, `Tricolour`, `Chip`, `Icon eye/eyeOff`, `Button`, `Txt`, `useUiFamily`, `setLocale` (`src/i18n/index.ts`), `openMmkv`.
- Produces: `sparkline(seed, w, h, n): { line: string; fill: string; lastX: number; lastY: number }`; `Sparkline({ seed?, height? })`; `resolveLocale(saved: string | null, deviceTags: string[]): Locale`; `loadLocale(): string | null`; `saveLocale(locale: Locale): void`; `LanguageSwitch()`; `Field({ label, trailing?, ...TextInputProps })`, `PasswordField`, `FormScroll({ children, top? })`, `TextLink({ href, label })`.

- [ ] **Step 1: Failing tests** — `apps/mobile/src/ui/sparkline-path.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { sparkline } from "./sparkline-path";

describe("sparkline", () => {
  it("is deterministic for a seed (no Math.random)", () => {
    expect(sparkline(7, 386, 128, 70)).toEqual(sparkline(7, 386, 128, 70));
    expect(sparkline(7, 386, 128, 70).line).not.toEqual(sparkline(8, 386, 128, 70).line);
  });
  it("spans the width and stays inside the box", () => {
    const s = sparkline(7, 386, 128, 70);
    expect(s.line.startsWith("M0.0 ")).toBe(true);
    expect(s.lastX).toBeCloseTo(386);
    const ys = [...s.line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...ys)).toBeLessThanOrEqual(128 - 32);
    expect(s.fill.endsWith(`L0 128 Z`)).toBe(true);
  });
  it("needs two points", () => {
    expect(sparkline(7, 100, 50, 1).line).toBe("");
  });
});
```

Append to `apps/mobile/src/i18n/parity.test.ts`:

```ts
import { resolveLocale } from "./keys";

describe("resolveLocale", () => {
  it("prefers the language the user picked", () => {
    expect(resolveLocale("hi", ["en-IN"])).toBe("hi");
    expect(resolveLocale("en", ["hi-IN"])).toBe("en");
  });
  it("falls back to the device language for nothing or junk", () => {
    expect(resolveLocale(null, ["hi-IN"])).toBe("hi");
    expect(resolveLocale("fr", ["en-IN"])).toBe("en");
  });
});
```

(merge `resolveLocale` into the existing `./keys` import.) Run: `pnpm test -- sparkline parity` → FAIL.

- [ ] **Step 2: Implement**

`apps/mobile/src/ui/sparkline-path.ts` (port of the canvas's `area()`; a seeded LCG, never `Math.random`)

```ts
export interface SparklinePath {
  line: string;
  fill: string;
  lastX: number;
  lastY: number;
}

/** A decorative market-like line (no real data). Same seed, same shape. */
export function sparkline(seed: number, w: number, h: number, n: number): SparklinePath {
  if (n < 2) return { line: "", fill: "", lastX: 0, lastY: 0 };
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let p = 100;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    p = p + (rand() - 0.46) * 2.2 + Math.sin(i / 9 + seed) * 0.3;
    pts.push(p);
  }
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const step = w / (n - 1);
  const span = hi - lo || 1;
  const xy = pts.map((v, i) => [i * step, 8 + ((hi - v) / span) * (h - 40)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = xy[xy.length - 1] ?? [0, 0];
  return { line, fill: `${line} L${lastX.toFixed(1)} ${h} L0 ${h} Z`, lastX, lastY };
}
```

`apps/mobile/src/ui/Sparkline.tsx`

```tsx
import { useState } from "react";
import { View } from "react-native";
import { Circle, Defs, LinearGradient, Path, Stop, Svg } from "react-native-svg";
import { color } from "@/theme/tokens";
import { sparkline } from "./sparkline-path";

/** The login screen's market line. Decorative: no price, no market name (no real quote is available signed out). */
export function Sparkline({ seed = 7, height = 128 }: { seed?: number; height?: number }) {
  const [width, setWidth] = useState(0);
  const s = width > 0 ? sparkline(seed, width - 4, height, 70) : null;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ height }}
    >
      {s ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="ixtLoginArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color.up} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color.up} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={s.fill} fill="url(#ixtLoginArea)" />
          <Path d={s.line} fill="none" stroke={color.up} strokeWidth={1.8} strokeLinejoin="round" />
          <Circle cx={s.lastX} cy={s.lastY} r={3.5} fill={color.up} />
        </Svg>
      ) : null}
    </View>
  );
}
```

`apps/mobile/src/i18n/keys.ts` — append:

```ts
/** The language the user picked on the login screen wins over the device language. */
export function resolveLocale(saved: string | null, deviceTags: string[]): Locale {
  return saved === "en" || saved === "hi" ? saved : localeFromDevice(deviceTags);
}
```

`apps/mobile/src/i18n/locale-pref.ts`

```ts
import { openMmkv } from "@/cache/mmkv";
import type { Locale } from "./keys";

/** In the prefs store (not the resume store), so the choice survives sign-out. Best effort both ways. */
const KEY = "locale";

export function loadLocale(): string | null {
  try {
    return openMmkv("ixt-prefs")?.getString(KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveLocale(locale: Locale): void {
  try {
    openMmkv("ixt-prefs")?.set(KEY, locale);
  } catch {
    // The switch still applies for this session.
  }
}
```

In `apps/mobile/app/_layout.tsx` change the init line to:

```tsx
initI18n(resolveLocale(loadLocale(), getLocales().map((l) => l.languageTag ?? "")));
```

with `import { initI18n, resolveLocale } from "@/i18n";` (export `resolveLocale` from `src/i18n/index.ts`: change its last line to `export { localeFromDevice, resolveLocale, type Locale } from "./keys";`) and `import { loadLocale } from "@/i18n/locale-pref";`. (`openMmkv` never throws, so calling it at module scope is safe.)

`apps/mobile/src/ui/LanguageSwitch.tsx`

```tsx
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { setLocale, type Locale } from "@/i18n";
import { saveLocale } from "@/i18n/locale-pref";
import { Chip } from "./Chip";

/** English / हिन्दी on the first screen; many users read Hindi first. Each label is set in its own script. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  const current: Locale = i18n.language.startsWith("hi") ? "hi" : "en";
  const pick = (locale: Locale) => {
    saveLocale(locale);
    void setLocale(locale);
  };
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: "row", justifyContent: "center", gap: 6, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28 }}>
      <Chip role="radio" label={t("lang.en")} script="latin" height={36} selected={current === "en"} onPress={() => pick("en")} style={{ paddingHorizontal: 16 }} />
      <Chip role="radio" label={t("lang.hi")} script="devanagari" size={15} height={36} selected={current === "hi"} onPress={() => pick("hi")} style={{ paddingHorizontal: 16 }} />
    </View>
  );
}
```

Run: `pnpm test -- sparkline parity` → PASS.

- [ ] **Step 3: form.tsx** (whole file)

```tsx
import { Link, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { color, radius } from "@/theme/tokens";
import { Txt, useUiFamily } from "@/theme/ui";
import { Icon } from "./Icon";

/** Text input with its label above (visible while typing). Focus: blue border + 3pt ring. */
// A caller's `style` is overridden by ours (set after the spread): every field looks the same.
export function Field({ label, trailing, onFocus, onBlur, ...rest }: TextInputProps & { label: string; trailing?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const family = useUiFamily(400);
  return (
    <View style={{ gap: 6 }}>
      <Txt size={14} weight={500} color={color.ink2}>
        {label}
      </Txt>
      <View style={{ margin: -3, borderWidth: 3, borderRadius: radius.md + 3, borderColor: focused ? color.accentDim : "transparent" }}>
        <TextInput
          {...rest}
          accessibilityLabel={label}
          placeholderTextColor={color.ink3}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={{
            height: 52,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: focused ? color.accent : color.rule,
            backgroundColor: color.surface,
            color: color.ink,
            paddingLeft: 14,
            paddingRight: trailing ? 48 : 14,
            fontSize: 16,
            fontFamily: family,
          }}
        />
        {trailing ? <View style={{ position: "absolute", right: 4, top: 4 }}>{trailing}</View> : null}
      </View>
    </View>
  );
}

/** Password field with a show/hide eye. */
export function PasswordField(props: Omit<TextInputProps, "secureTextEntry"> & { label: string }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <Field
      {...props}
      secureTextEntry={!shown}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shown ? t("auth.hidePassword") : t("auth.showPassword")}
          onPress={() => setShown((v) => !v)}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name={shown ? "eyeOff" : "eye"} size={20} color={color.ink3} />
        </Pressable>
      }
    />
  );
}

/**
 * Height of the soft keyboard (0 when hidden). Android 15 edge-to-edge ignores `adjustResize`, so
 * the window no longer shrinks; screens that hold inputs must make room themselves.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** Keyboard-friendly column for the auth screens; shrinks above the keyboard. `top`: brand-first layout (login). */
export function FormScroll({ children, top = false }: { children: ReactNode; top?: boolean }) {
  const keyboard = useKeyboardHeight();
  return (
    <View style={{ flex: 1, paddingBottom: keyboard }}>
      <ScrollView contentContainerStyle={top ? styles.top : styles.wrap} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {children}
      </ScrollView>
    </View>
  );
}

/** Text link with a 44pt+ touch target. */
export function TextLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={label} style={styles.link}>
        <Txt size={14} color={color.accentText}>
          {label}
        </Txt>
      </Pressable>
    </Link>
  );
}

export const formStyles = StyleSheet.create({
  error: { color: color.downText },
  /** Room for two lines of message so the layout below does not move when one appears. */
  messageSlot: { minHeight: 40 },
  links: { marginTop: 8 },
});

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, padding: 20, gap: 14, justifyContent: "center" },
  top: { flexGrow: 1, paddingTop: 12 },
  link: { minHeight: 44, justifyContent: "center" },
});
```

- [ ] **Step 4: Login** (whole file; logic unchanged)

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { LoginSchema } from "@asm/contracts";
import { api } from "@/api/client";
import { signInWithGoogle } from "@/auth/google";
import { TokenResult, finishSignIn } from "@/auth/finish-sign-in";
import { errorText, validationKey } from "@/auth/messages";
import { appConfig } from "@/config";
import { color } from "@/theme/tokens";
import { Button, Screen, Txt } from "@/theme/ui";
import { Wordmark } from "@/ui/Brand";
import { Field, FormScroll, PasswordField, TextLink } from "@/ui/form";
import { LanguageSwitch } from "@/ui/LanguageSwitch";
import { Sparkline } from "@/ui/Sparkline";
import { Tricolour } from "@/ui/Tricolour";

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const googleEnabled = appConfig().googleWebClientId !== "";

  async function submit() {
    if (busy) return;
    const parsed = LoginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) return setError(t(validationKey(parsed.error.issues)));
    setBusy(true);
    setError(null);
    try {
      const out = await api("/api/auth/login", { method: "POST", body: parsed.data, schema: TokenResult, auth: false });
      await finishSignIn(out.token, out.userId);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await signInWithGoogle();
      if (session) await finishSignIn(session.token, session.userId);
    } catch (e) {
      setError(errorText(e, t, "auth.googleFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <FormScroll top>
        <View style={{ paddingHorizontal: 20 }}>
          <Wordmark width={250} />
          <Tricolour fade width={250} style={{ marginTop: 2 }} />
        </View>
        <View style={{ marginTop: 10 }}>
          <Sparkline />
        </View>
        <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 14 }}>
          <Txt weight={600} size={28} tracking={-0.01} accessibilityRole="header">
            {t("auth.login")}
          </Txt>
          <Field
            testID="login-email"
            label={t("auth.email")}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <PasswordField testID="login-password" label={t("auth.password")} autoComplete="password" value={password} onChangeText={setPassword} onSubmitEditing={submit} />
          {error ? (
            <Txt accessibilityRole="alert" size={14} color={color.downText}>
              {error}
            </Txt>
          ) : null}
          <View style={{ marginTop: 4, gap: 10 }}>
            <Button testID="login-submit" label={t("auth.login")} onPress={submit} busy={busy} />
            {googleEnabled ? <Button label={t("auth.google")} kind="secondary" onPress={google} disabled={busy} /> : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
            <TextLink href="/forgot" label={t("auth.forgot")} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Txt size={14} color={color.ink2}>
                {t("auth.newHere")}
              </Txt>
              <TextLink href="/register" label={t("auth.register")} />
            </View>
          </View>
        </View>
        <View style={{ flex: 1 }} />
        <LanguageSwitch />
      </FormScroll>
    </Screen>
  );
}
```

- [ ] **Step 5: Register and Forgot** — same building blocks.

`register.tsx` render (logic unchanged; imports: `View`, `color`, `Wordmark`, `Tricolour`, `Field`, `PasswordField`, `FormScroll`, `TextLink`):

```tsx
  return (
    <Screen>
      <FormScroll top>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          <View>
            <Wordmark width={200} />
            <Tricolour fade width={200} style={{ marginTop: 2 }} />
          </View>
          <Txt weight={600} size={28} tracking={-0.01} accessibilityRole="header">
            {t("auth.register")}
          </Txt>
          <Field label={t("auth.name")} autoComplete="name" autoCapitalize="words" value={name} onChangeText={setName} />
          <Field label={t("auth.email")} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <PasswordField label={t("auth.password")} autoComplete="new-password" value={password} onChangeText={setPassword} onSubmitEditing={submit} />
          <Txt size={13} color={color.ink3}>
            {t("auth.passwordHint")}
          </Txt>
          {error ? (
            <Txt accessibilityRole="alert" size={14} color={color.downText}>
              {error}
            </Txt>
          ) : null}
          <Button label={t("auth.register")} onPress={submit} busy={busy} />
          <TextLink href="/login" label={t("auth.haveAccount")} />
        </View>
      </FormScroll>
    </Screen>
  );
```

`forgot.tsx` render:

```tsx
  return (
    <Screen>
      <FormScroll top>
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          <View>
            <Wordmark width={200} />
            <Tricolour fade width={200} style={{ marginTop: 2 }} />
          </View>
          <Txt weight={600} size={28} tracking={-0.01} accessibilityRole="header">
            {t("auth.forgotTitle")}
          </Txt>
          {sent ? (
            <Txt accessibilityRole="alert" size={16} color={color.ink2}>
              {t("auth.resetSent")}
            </Txt>
          ) : (
            <>
              <Field
                label={t("auth.email")}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={submit}
              />
              {error ? (
                <Txt accessibilityRole="alert" size={14} color={color.downText}>
                  {error}
                </Txt>
              ) : null}
              <Button label={t("auth.sendReset")} onPress={submit} busy={busy} />
            </>
          )}
          <TextLink href="/login" label={t("auth.backToLogin")} />
        </View>
      </FormScroll>
    </Screen>
  );
```

- [ ] **Step 6: Strings** — add (both files; `lang.*` are identical in both); `auth.noAccount` becomes unused (left for the Task 13 sweep):

| key | en | hi |
|---|---|---|
| `auth.newHere` | `New here?` | `नए हैं?` |
| `auth.showPassword` | `Show password` | `पासवर्ड दिखाएँ` |
| `auth.hidePassword` | `Hide password` | `पासवर्ड छिपाएँ` |
| `lang.en` | `English` | `English` |
| `lang.hi` | `हिन्दी` | `हिन्दी` |

- [ ] **Step 7: Run the Gate.**

- [ ] **Step 8: Commit**

```bash
cd $W && git add apps/mobile/src/ui apps/mobile/src/i18n "apps/mobile/app/(auth)" apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): Passbook sign-in screens: wordmark, decorative market line, labelled fields, saved language switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (A-Login):** wordmark 250 wide with the fading tricolour; green area line (no number, no market name — expected); "Log in" 28; labels above 52pt inputs; focus = blue border + soft ring; eye toggles the password; blue Log in; links row; English/हिन्दी pills at the bottom; switching to हिन्दी re-renders in Anek Devanagari and survives an app restart. Register/forgot: same field style. Keyboard: every control reachable (FormScroll shrinks).

---

### Task 11: Lock, lock setup, PIN boxes and ledger PIN pad

**Files:**
- Create: `apps/mobile/src/lock/PinBoxes.tsx`
- Modify: `apps/mobile/src/lock/PinPad.tsx` (whole file), `apps/mobile/app/lock.tsx`, `apps/mobile/app/lock-setup.tsx` (whole files)
- Modify: `apps/mobile/src/cache/resume-cache.ts` (nickname), `apps/mobile/app/(tabs)/trade.tsx` (save nickname)
- Modify: `en.json`, `hi.json`

**Interfaces:**
- Consumes: `BrandMark`, `Icon fingerprint/key/delete/chevron`, `Button kind="text"`, `Txt`.
- Produces: `PinBoxes({ length, error?, idle?, label? })`; `PinPad({ value, onChange, disabled?, leftKey? })` (keypad only; boxes are separate); `saveLastNickname(name: string | null)`, `loadLastNickname(): string | null`.

- [ ] **Step 1: PinBoxes** — `apps/mobile/src/lock/PinBoxes.tsx`

```tsx
import { View } from "react-native";
import { color } from "@/theme/tokens";

/**
 * One bank-form box per PIN digit (60×70). Filled = a dot; the next box = blue border + ring; `error` turns the
 * filled boxes red while a wrong-PIN message shows; `idle` = no active box (the lock-setup preview).
 */
export function PinBoxes({ length, error = false, idle = false, label }: { length: number; error?: boolean; idle?: boolean; label?: string }) {
  return (
    <View
      accessible={label !== undefined}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? "no-hide-descendants" : "auto"}
      style={{ flexDirection: "row", gap: 12, justifyContent: "center" }}
    >
      {[0, 1, 2, 3].map((i) => {
        const filled = i < length;
        const active = !idle && i === length;
        return (
          <View key={i} style={{ margin: -3, borderWidth: 3, borderRadius: 13, borderColor: active ? color.accentDim : "transparent" }}>
            <View
              style={{
                width: 60,
                height: 70,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: active ? color.accent : filled ? (error ? color.downText : color.ink3) : color.rule,
                backgroundColor: color.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {filled ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color.ink }} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: PinPad (ledger keypad)** — `apps/mobile/src/lock/PinPad.tsx` (whole file)

```tsx
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { Icon, type IconName } from "@/ui/Icon";

const DELETE = "delete";
const LEFT = "left";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", LEFT, "0", DELETE] as const;

/** Full-width ledger keypad (no grey tiles). `leftKey` fills the bottom-left cell (fingerprint on the lock screen). */
export function PinPad({
  value,
  onChange,
  disabled,
  leftKey,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  leftKey?: { icon: IconName; label: string; onPress: () => void };
}) {
  const { t } = useTranslation();

  function press(k: string) {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (k === DELETE) onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderTopColor: color.ruleSoft }}>
      {KEYS.map((k, i) => {
        const col = i % 3;
        const cell = {
          width: "33.333%",
          height: 64,
          borderBottomWidth: 1,
          borderLeftWidth: col === 1 ? 1 : 0,
          borderRightWidth: col === 1 ? 1 : 0,
          borderColor: color.ruleSoft,
          alignItems: "center",
          justifyContent: "center",
        } as const;
        if (k === LEFT) {
          return leftKey ? (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={leftKey.label}
              onPress={leftKey.onPress}
              style={({ pressed }) => [cell, pressed ? { backgroundColor: color.raised } : null]}
            >
              <Icon name={leftKey.icon} size={26} color={color.accentText} />
            </Pressable>
          ) : (
            <View key={k} style={cell} />
          );
        }
        return (
          <Pressable
            key={k}
            testID={`pin-${k}`}
            accessibilityRole="button"
            accessibilityLabel={k === DELETE ? t("lock.delete") : k}
            accessibilityState={{ disabled: !!disabled }}
            onPress={() => press(k)}
            style={({ pressed }) => [cell, { opacity: disabled ? 0.5 : 1 }, pressed ? { backgroundColor: color.raised } : null]}
          >
            {k === DELETE ? (
              <Icon name="delete" size={26} color={color.ink2} />
            ) : (
              <Txt weight={500} size={27} lineHeight={34}>
                {k}
              </Txt>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 3: Cached nickname** — append to `apps/mobile/src/cache/resume-cache.ts` (same MMKV store as the snapshots, so `clearResume()` on sign-out wipes it):

```ts
const NICKNAME_KEY = "lastNickname";

/** The lock screen greets the last signed-in user by nickname. Best effort; null removes it. */
export function saveLastNickname(name: string | null): void {
  try {
    const s = store();
    if (!s) return;
    if (name) s.set(NICKNAME_KEY, name);
    else s.remove(NICKNAME_KEY);
  } catch {
    // Best effort, see above.
  }
}

export function loadLastNickname(): string | null {
  try {
    return store()?.getString(NICKNAME_KEY) ?? null;
  } catch {
    return null;
  }
}
```

In `app/(tabs)/trade.tsx` import `saveLastNickname` with `loadLastUserId`/`saveLastUserId` and add next to the `saveLastUserId` effect:

```tsx
  const nickname = boot?.profile.nickname ?? null;
  const booted = boot !== undefined;
  useEffect(() => {
    if (booted) saveLastNickname(nickname);
  }, [booted, nickname]);
```

- [ ] **Step 4: Lock screen** — `apps/mobile/app/lock.tsx`: keep every hook, callback and handler exactly as today (`promptBiometric`, the biometric effect, `onPin`, `forgot`, `message`); replace the imports of `StyleSheet`/`formStyles`/`styles` and the returned JSX with:

```tsx
import { loadLastNickname } from "@/cache/resume-cache";
import { color } from "@/theme/tokens";
import { BrandMark } from "@/ui/Brand";
import { PinBoxes } from "@/lock/PinBoxes";
```

```tsx
  // Read once per mount: the greeting never changes while the lock is up.
  const [name] = useState(() => loadLastNickname());

  return (
    <Screen style={{ paddingBottom: insets.bottom }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 22, paddingHorizontal: 20 }}>
        <View style={{ alignItems: "center", gap: 10 }}>
          <BrandMark width={72} />
          <Txt weight={600} size={24} accessibilityRole="header" numberOfLines={1} style={{ textAlign: "center" }}>
            {name ? t("lock.welcomeName", { name }) : t("lock.welcome")}
          </Txt>
          {method === "pin" ? (
            <Txt size={15} color={color.ink2}>
              {t("lock.enterPin")}
            </Txt>
          ) : null}
        </View>
        {method === "pin" ? (
          <>
            <PinBoxes length={value.length} error={message !== ""} label={t("lock.pinEntered", { count: value.length })} />
            {/* Fixed height (not minHeight): a two-line message must not push the pad down mid-entry. */}
            <Txt
              testID="lock-message"
              accessibilityRole={message ? "alert" : undefined}
              numberOfLines={2}
              size={15}
              color={color.downText}
              style={{ height: 40, textAlign: "center" }}
            >
              {message}
            </Txt>
          </>
        ) : method === "biometric" ? (
          <View style={{ alignSelf: "stretch" }}>
            <Button label={t("lock.useBiometric")} icon="fingerprint" onPress={promptBiometric} busy={bioBusy} />
          </View>
        ) : (
          // The lock settings could not be read: the only way on is to sign in again.
          <Txt size={15} color={color.downText} style={{ textAlign: "center" }}>
            {t("lock.unavailable")}
          </Txt>
        )}
      </View>
      {method === "pin" ? <PinPad value={value} onChange={onPin} disabled={busy} /> : null}
      <View style={{ marginBottom: 16 }}>
        <Button kind="text" label={t("lock.forgotPin")} onPress={forgot} />
      </View>
    </Screen>
  );
```

(add `View` to the react-native import and `useState` is already imported; drop the `styles` constant.)

- [ ] **Step 5: Lock setup** — `apps/mobile/app/lock-setup.tsx`: keep state, effects and handlers (`useBiometric`, `skip`, `onPin`) unchanged; add the `OptionRow` component above the screen and replace the returned JSX:

```tsx
function OptionRow({
  icon,
  tone,
  title,
  hint,
  onPress,
  disabled,
  testID,
  last,
}: {
  icon: IconName;
  tone: "accent" | "muted";
  title: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  last?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hint}`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: color.ruleSoft,
        backgroundColor: pressed ? color.raised : "transparent",
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: tone === "accent" ? color.accentDim : color.raised }}>
        <Icon name={icon} size={22} color={tone === "accent" ? color.accentText : color.ink2} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight={600} size={17}>
          {title}
        </Txt>
        <Txt size={14} color={color.ink3}>
          {hint}
        </Txt>
      </View>
      <Icon name="chevron" size={18} strokeWidth={2} color={color.ink3} />
    </Pressable>
  );
}
```

```tsx
  if (step === "choose") {
    return (
      <Screen style={{ paddingHorizontal: 20, paddingBottom: 28 + insets.bottom }}>
        <View style={{ flex: 1, justifyContent: "center", gap: 30 }}>
          <PinBoxes length={0} idle />
          <View style={{ gap: 8 }}>
            <Txt weight={600} size={28} lineHeight={32} accessibilityRole="header">
              {t("lock.setupTitle")}
            </Txt>
            <Txt size={16} color={color.ink2}>
              {t("lock.setupBody")}
            </Txt>
          </View>
          {error ? (
            <Txt accessibilityRole="alert" size={15} color={color.downText}>
              {error}
            </Txt>
          ) : null}
          <View style={{ borderWidth: 1, borderColor: color.ruleSoft, borderRadius: radius.lg, backgroundColor: color.surface, overflow: "hidden" }}>
            {biometric ? (
              <OptionRow icon="fingerprint" tone="accent" title={t("lock.fingerprint")} hint={t("lock.fingerprintHint")} onPress={useBiometric} disabled={busy} />
            ) : null}
            <OptionRow testID="lock-set-pin" icon="key" tone="muted" title={t("lock.setPin")} hint={t("lock.pinHint")} onPress={() => setStep("pin")} disabled={busy} last />
          </View>
        </View>
        <Button kind="text" label={t("lock.skip")} onPress={skip} disabled={busy} />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingBottom: insets.bottom }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 22, paddingHorizontal: 20 }}>
        <Txt weight={600} size={24} accessibilityRole="header" style={{ textAlign: "center" }}>
          {step === "pin" ? t("lock.setPin") : t("lock.confirmPin")}
        </Txt>
        <PinBoxes length={value.length} error={!!error} label={t("lock.pinEntered", { count: value.length })} />
        {/* Reserved slot: the pad does not jump when the message appears. */}
        <Txt accessibilityRole={error ? "alert" : undefined} numberOfLines={2} size={15} color={color.downText} style={{ height: 40, textAlign: "center" }}>
          {error}
        </Txt>
      </View>
      <PinPad value={value} onChange={onPin} disabled={busy} />
      <View style={{ height: 16 }} />
    </Screen>
  );
```

(imports: `Pressable`, `View` from react-native; `color`, `radius` from tokens; `Icon`, `type IconName`; `PinBoxes`; drop `formStyles`/`space`.) `useBiometric` is a plain function named like a hook; if `react-hooks/rules-of-hooks` flags passing it, rename it `chooseBiometric` (and its call sites) — no behaviour change.

- [ ] **Step 6: Strings** — add (both files):

| key | en | hi |
|---|---|---|
| `lock.welcome` | `Welcome back` | `फिर से स्वागत है` |
| `lock.welcomeName` | `Welcome back, {{name}}` | `फिर से स्वागत है, {{name}}` |
| `lock.enterPin` | `Enter your PIN` | `अपना PIN डालें` |
| `lock.setupBody` | `Lock IndianxTrade so only you can open it. You unlock it when you open the app and after 5 minutes away.` | `IndianxTrade को लॉक करें ताकि सिर्फ़ आप इसे खोल सकें। ऐप खोलने पर और 5 मिनट दूर रहने के बाद इसे अनलॉक करना होगा।` |
| `lock.fingerprint` | `Use fingerprint` | `फ़िंगरप्रिंट इस्तेमाल करें` |
| `lock.fingerprintHint` | `Fastest. Recommended` | `सबसे तेज़। सुझाया गया` |
| `lock.pinHint` | `Works on every phone` | `हर फ़ोन पर चलता है` |

- [ ] **Step 7: Run the Gate.**

- [ ] **Step 8: Commit**

```bash
cd $W && git add apps/mobile/src/lock apps/mobile/app/lock.tsx apps/mobile/app/lock-setup.tsx apps/mobile/src/cache/resume-cache.ts "apps/mobile/app/(tabs)/trade.tsx" apps/mobile/src/i18n
git commit -m "feat(mobile): Passbook lock and lock setup: PIN boxes, ledger PIN pad, greeting by name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (A-Lock, A-LockSetup):** setup: four empty boxes, "Protect your account" + body, card with fingerprint row (if enrolled) and "Set a 4-digit PIN" row, quiet "Not now"; PIN step: boxes fill with dots, the next box glows blue, mismatch message in its fixed slot. Lock: mark 72, "Welcome back, <nickname>" (after one bootstrap), boxes, wrong PIN → red message "Wrong PIN. N tries left." without the pad moving, full-width ledger pad, "Forgot PIN? Log in again" text button. e2e `lock.yaml` still passes (pin-N ids, lock-message digits).

---

### Task 12: Gate screens, offline strip, toasts

**Files:**
- Modify: `apps/mobile/src/ui/GateScreen.tsx` (whole file), `apps/mobile/app/blocked.tsx`, `maintenance.tsx`, `update-required.tsx`
- Modify: `apps/mobile/src/ui/OfflineBanner.tsx` (styles), `apps/mobile/src/ui/Toast.tsx` (ToastRow + styles)
- Modify: `en.json`, `hi.json`

**Interfaces:**
- Produces: `GateScreen({ title, body, info?: { label: string; value: string; strong?: boolean }[], children?, testID? })`.

- [ ] **Step 1: GateScreen** (whole file)

```tsx
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, radius } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";
import { BrandMark } from "./Brand";

/**
 * Shared layout for the full-screen gates (maintenance, VPN block, forced update): what happened, an optional
 * facts card, and one action at the bottom.
 */
export function GateScreen({
  title,
  body,
  info,
  children,
  testID,
}: {
  title: string;
  body: string;
  info?: { label: string; value: string; strong?: boolean }[];
  children?: ReactNode;
  /** Stable handle for end-to-end tests, on the title. */
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Screen style={{ paddingHorizontal: 20, paddingBottom: 28 + insets.bottom }}>
      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        <BrandMark width={76} />
        <Txt weight={600} size={28} lineHeight={32} accessibilityRole="header" testID={testID}>
          {title}
        </Txt>
        <Txt size={16} color={color.ink2}>
          {body}
        </Txt>
        {info && info.length > 0 ? (
          <View style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: color.ruleSoft, backgroundColor: color.surface, gap: 8 }}>
            {info.map((row) => (
              <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Txt size={15} color={color.ink3}>
                  {row.label}
                </Txt>
                <Txt font="fig" size={15} weight={row.strong ? 600 : 400}>
                  {row.value}
                </Txt>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}
```

- [ ] **Step 2: The three gates**
  - `maintenance.tsx`: unchanged except it keeps `testID="gate-maintenance"` (already passes title/body).
  - `blocked.tsx`: unchanged (Retry button stays the child).
  - `update-required.tsx`: pass the versions and the icon:

```tsx
  const needed = cfg?.minVersion;
  return (
    <GateScreen
      title={t("gate.updateTitle")}
      body={t("gate.updateBody")}
      info={needed ? [{ label: t("gate.youHave"), value: appConfig().version }, { label: t("gate.needed"), value: needed, strong: true }] : undefined}
    >
      <Button label={t("gate.update")} icon="download" onPress={() => void Linking.openURL(target).catch(() => {})} />
    </GateScreen>
  );
```

(`cfg?.minVersion` is the app-config field the Gatekeeper already reads; `appConfig().version` is the running version.)

- [ ] **Step 3: Offline strip** — `src/theme/ui.tsx` imports `OfflineBanner.tsx`, so the banner must **not** import `Txt` (import cycle). Keep its RN `Text` and give it the bundled family directly: `const { t, i18n } = useTranslation();` and `style={[styles.text, { fontFamily: uiFamily(500, scriptFor(i18n.language)) }]}` with `import { scriptFor, uiFamily } from "@/theme/font-families";`; set `text: { fontSize: 12, lineHeight: 16, color: color.ink }` and `borderBottomColor: color.downText` (keep `backgroundColor: color.warnBg`, height and positioning unchanged).

- [ ] **Step 4: Toasts** — in `Toast.tsx` replace `ToastRow`'s return and the styles:

```tsx
  const bar = item.tone === "up" ? color.up : item.tone === "down" ? color.downText : color.rule;
  return (
    <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={styles.toast}>
      <View style={[styles.bar, { backgroundColor: bar }]} />
      <Txt testID="toast" weight={500} size={14} style={{ flex: 1 }}>
        {item.message}
      </Txt>
    </Animated.View>
  );
```

```tsx
const styles = StyleSheet.create({
  host: { position: "absolute", left: 16, right: 16, gap: 8 },
  toast: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: color.raised,
    borderWidth: 1,
    borderColor: color.rule,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  bar: { width: 3, borderRadius: 2, alignSelf: "stretch" },
});
```

(imports: drop `Text`, add `Txt`; the `toast()` API, queue length and 3.5 s timeout are unchanged.)

- [ ] **Step 5: Strings** — add `gate.youHave` / `gate.needed`; change the update copy to the canvas wording:

| key | en | hi |
|---|---|---|
| `gate.youHave` | `You have` | `आपके पास` |
| `gate.needed` | `Needed` | `ज़रूरी` |
| `gate.updateTitle` (value change) | `Update to keep trading` | `ट्रेडिंग जारी रखने के लिए अपडेट करें` |
| `gate.updateBody` (value change) | `This version of IndianxTrade is no longer supported. Your balance is not affected.` | `IndianxTrade का यह वर्ज़न अब सपोर्टेड नहीं है। आपके बैलेंस पर कोई असर नहीं पड़ा है।` |

- [ ] **Step 6: Run the Gate.**

- [ ] **Step 7: Commit**

```bash
cd $W && git add apps/mobile/src/ui apps/mobile/app/blocked.tsx apps/mobile/app/maintenance.tsx apps/mobile/app/update-required.tsx apps/mobile/src/i18n
git commit -m "feat(mobile): Passbook gate screens, offline strip and toasts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (N-Update pattern):** maintenance (local `MAINTENANCE_MODE=1`), VPN block and update-required (raise min version) screens: mark 76, 28pt title, grey body, update shows the "You have / Needed" card and a blue "Update now" with a download icon. Toasts: dark raised card with a green/red bar, e2e `toast` text "<market> · Won ₹…". Offline strip red-ruled under the status bar.

---

### Task 13: Consistency sweep — remove legacy tokens, stray text styles and unused strings

**Files:**
- Modify: `apps/mobile/src/theme/tokens.ts` (delete aliases and `font`), any file tsc then flags
- Modify: `apps/mobile/src/i18n/en.json`, `hi.json` (delete unused keys)
- Modify: `apps/mobile/app.config.ts` (splash / adaptive-icon background)

**Interfaces:**
- Produces: final token set = the palette table only (+ `warnBg`, `scrim`, `overlayPill`).

- [ ] **Step 1: Delete the deprecated aliases** — remove `panel`, `tile`, `tileHi`, `brand`, `brandInk`, `brandFill`, `brandDim`, `caution` from `color` and the `font` export from `tokens.ts` (keep `tokens` without `font`). Run `cd $W/apps/mobile && pnpm typecheck` and migrate every error with this map: `panel → surface`, `tile → raised`, `tileHi → raised`, `brand → accentText` (text/icons/lines) or `accent` (fills), `brandInk → onAccent`, `brandFill → accent`, `brandDim → accentDim`, `caution → gold`, `font.number` → use `<Txt font="fig">` / `<Money>`. Expected leftovers: `src/chart/Chart.tsx` (crosshair/back-to-live), `src/trade/SentimentBar.tsx`, `src/trade/TradeChart.tsx`, `src/ui/OfflineBanner.tsx`, `app/(tabs)/trade.tsx` (`BootError`).

- [ ] **Step 2: No raw RN `Text` or `fontWeight` left in restyled code**

```bash
cd $W/apps/mobile
grep -rn "from \"react-native\"" src app | grep -n "\bText\b" | grep -v "TextInput" ; echo "text-imports=$?"
grep -rn "fontWeight" src app | grep -v "src/theme/" ; echo "fontWeight=$?"
grep -rn "#[0-9a-fA-F]\{6\}\b" src app --include=*.tsx | grep -v "src/theme/tokens.ts" ; echo "hex=$?"
```

Expected: no hits except `src/theme/ui.tsx` (the `Txt` implementation) and `src/ui/OfflineBanner.tsx` (cannot import `Txt`, see Task 12) — convert any other hit (e.g. `BootError` in `trade.tsx`) to `<Txt>`; `fontWeight=1`; `hex=1` (the Skia `SkText` in Chart.tsx is not an RN `Text` and may stay).

- [ ] **Step 3: Remove unused strings** — find keys no code references and delete them from both files:

```bash
cd $W/apps/mobile && node -e '
const en=require("./src/i18n/en.json");
const flat=(o,p="")=>Object.entries(o).flatMap(([k,v])=>typeof v==="object"?flat(v,p+k+"."):[p+k]);
const {execSync}=require("child_process");
const src=execSync("cat $(git ls-files src app | grep -E \"\\.(ts|tsx)$\")",{encoding:"utf8",maxBuffer:1e8});
for(const k of flat(en)){const base=k.replace(/_(one|other)$/,"");const dyn=/^bonus\.(nth\d|claimed|next|upcoming)$|^trade\.(candles|line|area|bars)$/.test(base);if(!dyn&&!src.includes(`"${base}"`))console.log(k)}'
```

Delete each printed key (expected: `trade.stake`, `trade.expiry`, `trade.stakeKeypad`, `trade.trades`, `trade.tabCount`, `auth.noAccount`, `bonus.depositNow`, `lock.title`; keep any key the script flags but a grep shows is built dynamically). `pnpm test -- parity` must still pass.

- [ ] **Step 4: Native backgrounds** — in `app.config.ts` set the splash plugin `backgroundColor` and `adaptiveIcon.backgroundColor` to `"#06080b"` (takes effect on the next native build; no runtime change).

- [ ] **Step 5: Run the Gate** and the e2e flows' selectors check:

```bash
cd $W/apps/mobile && for id in login-email login-password login-submit lock-set-pin lock-message pin-1 account-demo stake-tile key-0 key-1 key-back keypad-done expiry-30 buy sell toast gate-maintenance; do grep -rq "\"$id\"\|\`$id\|$id" src app || echo "MISSING $id"; done; echo done
```

Expected: only `done` (the `pin-${k}`, `key-${key}`, `expiry-${c.sec}`, `account-${…}` ids are template strings and match the loose grep).

- [ ] **Step 6: Commit**

```bash
cd $W && git add apps/mobile
git commit -m "refactor(mobile): drop legacy theme aliases and unused strings after the Passbook restyle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Device check (all artboards, en + hi, 360dp and 412dp widths):** Main, A-Keypad, A-Expiry, A-Trades, A-Markets, A-Bonus, A-Login, A-LockSetup, A-Lock, N-Update pattern (maintenance / blocked / update). Then run the Maestro flows (`e2e/login-trade.yaml`, `e2e/lock.yaml`, `e2e/maintenance.yaml`) if Maestro is installed.

---

## PR notes (for the controller's PR body)

Flag for owner confirmation (accepted on the canvas, confirm before merge):
1. **Indian digit grouping** (₹9,99,600.00) on INR amounts in the app; USD keeps Western grouping.
2. **Bundled fonts**: Anek Latin 400/500/600, Anek Devanagari 400/600, Martian Mono 400/500/600 ≈ **1.31 MB raw** (Devanagari ≈ 0.83 MB of that) instead of the ~300 KB first estimated. Option: drop Anek Devanagari and use the system Hindi font.
3. **"Up/Down"** replaces "Buy/Sell" (buttons, strip, trades sheet, chart tags). The website still says Buy/Sell.

Also call out: the header's "today" figure is the true net P&L (the canvas sample added gross wins); login line is decorative; markets sheet has no price/change/closed columns (no data yet); keypad quick amounts unchanged (₹250 not ₹5,000); accent blue darkened from `#3f6ff2` to `#3d6cf0` (4.56:1 with white) and `ink3` from `#737d8c` to `#7c8695` so every text pair passes AA; white on the lightest corner of the Down gradient is 3.6:1 for the 12pt "win" line, owner's colour, noted; the lock screen shows the cached nickname to whoever holds the phone.

## Self-review

- Spec coverage: tokens + fonts (T1), Indian grouping + words (T2), primitives incl. ledger/stamp for P3 (T3/T4), header with today's result + 48pt nav (T5), B3/R1 art at opacity 1.0 with the owner's offsets (T6), dock/keypad/expiry with words only on the keypad (T7), trade chrome/strip (T8), sheets (T9), auth (T10), lock/PIN (T11), gates/offline/toasts (T12), cleanup (T13). Every task ends with the Gate and a device-check list.
- Types used across tasks: `money()`, `Money{text}`, `Chip{figures,count,role,script}`, `Sheet{aside,flush}`, `TradesSheet{accountType}`, `PositionStrip{accountType}`, `KeypadSheet{accountType,payoutPct}`, `PinPad{leftKey}`, `PinBoxes{idle}` are defined in the task that first produces them and consumed with the same names later.
