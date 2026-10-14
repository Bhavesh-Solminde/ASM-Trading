# Mobile P2 restyle ("Passbook") — plan amendments (pre-flight review, 2026-10-14)

These override `2026-10-14-mobile-p2-restyle.md` where they conflict. Controller: pass each task's section (plus
"All tasks") to that task's implementer and reviewer. They are the corrections from the pre-flight review
(`.superpowers/sdd/restyle-preflight.md`, 2 Blockers, 7 Should-fix, 7 Minor). The design-judgment calls below were made by the
controller while the owner was away; they are conservative, keep the look of the snapshot
(`docs/design/passbook-canvas-2026-10-14/`, `Main.dc.html` is current) and are reversible. "P<n>" is a line of the restyle plan as written
at 9e33c36 (use the quoted text to find it if lines have moved). The plan now has **15 tasks**: Task 8 splits into 8a/8b and
Task 10 into 10a/10b (see those sections); task numbers 9, 11, 12, 13 are unchanged.

## Already on the branch (build on it, never revert it)
- Fix round E: `7e9734f` (privacy cover: `app/_layout.tsx` wraps everything in `<PrivacyShield>`, `src/ui/PrivacyCover.tsx`,
  `src/gate/Gatekeeper.tsx` using `onAppStateChange` + `useBelowMin()` from `src/gate/use-below-min.ts`, `lock-store`) and `b77ab5e`
  (`stakeTileLabel` in `src/trade/stake-input.ts`, used by `Dock.tsx:59`). Also `69d8a9e` (the stake tile keeps its currency symbol).
- Start Task 1 only once E's review has passed. If review sends E back, rebase Task 1 onto the fixed E before starting.
- Every edit the plan makes to `_layout.tsx`, `Gatekeeper.tsx`, `Dock.tsx` and `stake-input.ts` is an edit **of the current file**, not a
  whole-file replacement from the plan text that would drop E's changes.

## All tasks
- Every commit ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Palette corrections (override the plan's Task 1 values and every later use):**
  - `accent` is **`#3d6cf0`** (was `#3f6ff2`), `brandFill` alias the same. White on it is **4.56:1** (AA 4.5 for normal text; the old
    4.41 failed for the 17px/600 labels because that size is not WCAG "large text"). Against `ground` it is 4.39:1, fine for
    non-text (focus borders, the Deposit square, lines: 3:1). It is visually the same blue. `accentText`, `accentDim` unchanged.
  - `ink3` is **`#7c8695`** (was `#737d8c`): 5.44 on `ground`, **5.02 on `surface`**, **4.60 on `raised`** (the old value was 4.44 /
    4.06 on the pairs the plan uses everywhere). `ink3` on `headerTop` is only 3.93, so **never use `ink3` text on the header**.
  - `color.down` (`#d63a30`) is a **fill/stroke/border colour only** (4.30 on ground, 3.97 on surface as text). Any `down`-coloured text
    uses `color.downText` (`#ff7468`, 7.00 on surface).
  - Everything else in the Task 1 table stays (`upInk`/`downInk` on the buttons pass 4.5).
- **Figures with ₹ or Devanagari.** Martian Mono has neither glyph. Never put a string that can contain `₹` or Hindi words into `<Txt font="fig">`. Use `<Money>` / `<FigText>` (Task 4, rule below) for every figure-bearing string. Pure
  ASCII digit strings (times, counts, prices without a symbol, the OHLC strip) stay `font="fig"`.
- **Chart-tag rule** (Task 8b): every Skia tag is sized with `font.measureText(text).width`, never a fixed width, and never with
  `getTextWidth` (deprecated in Skia 2.6.2).
- Keep the money rules, e2e testIDs (`login-*`, `lock-set-pin`, `lock-message`, `pin-N`, `account-demo`, `stake-tile`, `key-*`,
  `keypad-done`, `expiry-30`, `buy`, `toast`, `gate-maintenance`) and existing behaviour exactly as the plan has them.
- Rationale text that says "React Native has no mix-blend-mode" is wrong (P40, the TradeButton comment at P2117, PR notes). Write instead:
  "RN 0.86 has `mixBlendMode` (new arch), but Android only applies it from API 29 and minSdk is 26. Skia gives the same overlay on every device."
- Touch targets (≥ 44pt through `minHeight` or `hitSlop`) and the earlier `2026-10-14-mobile-p2-amendments.md` "All tasks" rules still apply.

## T1 (palette, fonts, `Txt`)
- Step 5 (`tokens.ts`): `ink3: "#7c8695"`, `accent: "#3d6cf0"`, `brandFill: "#3d6cf0"`. Update the Passbook-tokens `toEqual` (P403) to those two values.
- Step 5 tests (replace P408-423):
  - keep the existing AA cases and **add**: `contrast(color.ink3, color.surface)`, `contrast(color.ink3, color.raised)` both `>= 4.5`;
    `contrast(color.onAccent, color.accent)` `>= 4.5`; `contrast(color.switchInk, color.headerTop)` `>= 4.5` (6.64).
  - **delete** the "documents the one owner-chosen pair just under AA (4.41:1)" test (P421-423) and the matching sentence in the PR notes
    (P4762, replace with: "accent blue darkened from `#3f6ff2` to `#3d6cf0` (4.56:1 with white) and `ink3` from `#737d8c` to `#7c8695`
    so every text pair passes AA; white on the lightest corner of the Down gradient is 3.6:1 for the 12pt \"win\" line, owner's colour, noted").
  - Also update the Canvas-reference table rows for accent (P92) and ink3 (P91).
- Step 8 (fonts): `useFonts` goes at the **top of the existing `RootLayout`**, above the JSX; `<PrivacyShield>` stays the outermost wrapper
  (inside `QueryClientProvider`, as 7e9734f has it). Render `<Gatekeeper fontsReady={fontsLoaded || fontError !== null} />` in the place the
  existing `<Gatekeeper />` is. In `Gatekeeper.tsx` only add the `fontsReady` prop and `&& fontsReady` on the `settled` line
  (currently `Gatekeeper.tsx:70`); do not touch `onAppStateChange`/`useBelowMin()`.
- Optional, same task: `src/ui/PrivacyCover.tsx` may use `color.ground` as its background (Task 13 Step 4 already moves the splash colour to
  `#06080b`, so the cover and splash stay consistent). No other change to it.
- Verification of ₹: in Step 9 also run a fontTools check that Anek Latin (`AnekLatin_400Regular.ttf`) has U+20B9
  (`python3 -c "from fontTools.ttLib import TTFont as T;print(0x20B9 in T('<path>').getBestCmap())"`). If not, ₹ falls back to the system font; say so in the PR and
  leave the rule as is.
- Add to Step 9: one release-build check (note for the owner, not blocking) that `useImage(require("…@3x.webp"))` resolves; release Android
  serves drawable resources, not file URIs.

## T2 (Indian grouping and words) — Blocker 1
- Task 2 now has to cover `stakeTileLabel` (added by b77ab5e after the plan was written). **Do not** list "Dock.tsx `stakeDisplay(stake)`" as a
  caller (P833): Dock calls `stakeTileLabel(stake, currency)` (`Dock.tsx:59`) and must keep doing so.
- Step 3, `src/trade/stake-input.ts`:
  - `stakeDisplay(text: string, currency: string): string` returns `groupTyped(text, currency)` (as the plan has it).
  - `stakeTileLabel(text, currency)` becomes: `""`-trim → `"—"`; `Number.isInteger(minor)` → `money(minor, currency)` (swap `formatMinor` for
    `money`); **otherwise (non-finite stake such as `"1e308"`) return the raw text as typed, with the symbol**:
    `` `${currencySymbol(currency)}${text.trim()}` `` (import `currencySymbol` from `@asm/client-core`). Reason: `groupTyped("1e308","INR")`
    strips the `e` and shows `1,308`, a wrong number on a money tile. Keep the "does not throw" behaviour.
  - Callers of `stakeDisplay` to update: `KeypadSheet.tsx:37` and `:41` only → `stakeDisplay(value, currency)`.
- Step 1/3 tests in `stake-input.test.ts`:
  - `:125` → `expect(stakeTileLabel("1005010", "INR")).toBe("₹10,05,010.00")`. The other `stakeTileLabel` rows become `"₹1,000.00"` and
    `"₹50.00"` (unchanged: below 1 lakh Indian and Western grouping agree), `"₹100.00"`, `"$12.34"` unchanged.
  - `:139-140` → `expect(() => stakeTileLabel("1e308", "INR")).not.toThrow(); expect(stakeTileLabel("1e308", "INR")).toBe("₹1e308");`
  - the `stakeDisplay` block takes the currency (as the plan has it); `:139` area no longer calls `stakeDisplay("1e308")`.
- Step 4: the swap `formatMinor` → `money` list also includes `src/trade/stake-input.ts`. The `grep formatMinor` check must still print `left=1`.
- Website unaffected: do not edit `@asm/client-core` `formatMinor`/`deposit-limits.ts` (they keep Western grouping).

## T4 (Money, Stamp, Ledger, brand images) — glyph rule
- Replace the plan's `Money` implementation (P1250-1270). Add a pure helper in `src/ui/fig-runs.ts` (with `fig-runs.test.ts`) and a `FigText`/`Money`
  built on it:
  - `splitFigRuns(text): { text: string; ui: boolean }[]`: a character with code point **> 0x7F** (₹, Devanagari, `−`, `·`, …) is `ui`; every other
    character is `fig`; whitespace joins the run before it; adjacent same-kind characters merge.
  - Rendering: one outer `<Txt font="fig">` holding nested `<Txt font="ui">` for each `ui` run (the nested `Txt` is script-aware, so Hindi picks
    Anek Devanagari and ₹ picks Anek Latin). Same `size`/`weight`/`color`/`tracking`/`lineHeight` on every run.
  - `Money` is `FigText` with `weight` default 600; keep its public props (`text`, `size`, `weight`, `color`, `tracking`, rest).
  - Tests: `"₹1,930"` → `[₹ ui][1,930 fig]`; `"आज +₹93"` → `[आज ui][+ fig][₹ ui][93 fig]`; `"$12.00"` → one `fig` run; `"12:30"` → one `fig` run.
- `Stamp` and `LedgerHeader` (P1291, P1330): `font={i18n.language.startsWith("hi") ? "ui" : "fig"}` (use `scriptFor(i18n.language) === "devanagari"` as `Txt` does). Hindi has no case, so keep
  `.toUpperCase()` as is; in Hindi the ui family is used, not Martian.
- `LedgerHeader` text colour `ink3` is now `#7c8695`, which passes on `surface`; nothing else to change.
- Add `FigText` to the exports list in the Interfaces section of the task.

## T5 (app shell) — "today" line
- `TodayLine` (P1655-1670) and `dayNetMinor` (Task 5's `day-total.ts`):
  - **Zero net** uses `color.switchInk`, not `color.ink3` (3.93:1 on `headerTop` fails). Positive `color.up`, negative `color.downText` unchanged.
  - Keep `trade.today` as `"today {{amount}}"`/`"आज {{amount}}"` and keep passing the interpolated string to `<Money text={…}>`: `Money` now
    sets the Hindi word and the ₹ in the ui family (Task 4), so only the zero colour changes here.
  - **Data source (decision: fetch for the selected account, hide when coverage is unproven).**
    - Bootstrap's `recentTrades` is only the default **DEMO** account's last 50. When the selected account is not the bootstrap default
      (LIVE, or any other), fetch `GET /api/trades?accountId=<id>` (`apps/web/src/app/api/trades/route.ts:86-110`, last 50) with the existing
      `api()` client and merge with client-core `withFetchedTrades`, as `bootstrap-merge.ts:29` does. Re-fetch on account switch. Socket settlements
      keep merging in as today.
    - **Coverage guard** in `dayNetMinor(trades, now)` (return `null` = hide the line unless the list provably covers the IST day): the list
      has **fewer than 50** rows, **or** its oldest `expiryTs` is before `istDayStartMs(now)`. Otherwise return `null`. While the fetch for a
      non-default account is in flight the line is hidden (never show the bootstrap account's figure under another account).
    - The line stays hidden when nothing settled today, as the plan has it. Net (not gross) stays; keep the PR flag that rows show gross on wins.
  - Tests in `day-total.test.ts` (add): a 50-row list whose oldest row is today → `null`; a 50-row list whose oldest row is before IST midnight →
    the sum; a 12-row list → the sum; an empty list → `null`; an account switch does not reuse the previous account's list.

## T6 (Up/Down buttons) — Blocker 2 and bull
- Step 1 (art export): the bear is now drawn into a **59×68** box with a cover crop. Re-export it at `-resize 0 238` (@3x) and `-resize 0 159`
  (@2x) (it was 252/168). The bull exports (264/176) are unchanged.
- Fix the provenance text P19 ("fetched … at 21:07") to say the canvas was refreshed in 2495f9a/0f9871d, and P35 (bear values) to the new numbers.
- `beast-frame.ts` replacement constants and functions (override P2077-2097):

```ts
const BULL = { w: 380, h: 513, drawH: 88, rightGap: 5.8, top: -3 };
const BEAR = { w: 380, h: 510, drawW: 59, right: -1, top: -9.19 };

/** Bull "B3 bust": anchored to the button's right edge so narrow and wide phones all keep the head uncropped. 105 at the 176pt canvas width. */
export function bullFrame(buttonW: number): Frame {
  const w = (BULL.drawH * BULL.w) / BULL.h; // 65.2
  return { x: buttonW - BULL.rightGap - w, y: BULL.top, w, h: BULL.drawH };
}

/** Bear "R1 swipe": the canvas box is 59×68 at right −1, bottom −5 with object-fit cover and object-position 49.58% 73.22%. */
export function bearFrame(buttonW: number): Frame {
  const w = BEAR.drawW; // 59
  const h = (BEAR.drawW * BEAR.h) / BEAR.w; // 79.18
  return { x: buttonW - BEAR.drawW - BEAR.right, y: BEAR.top, w, h }; // x = W − 58, y = −9.19
}
```

  (Cover crop: `scale = max(59/380, 68/510) = 0.15526`, drawn `59 × 79.18`; vertical overflow `11.18 × 0.7322 = 8.19`. The 68pt box spans
  `y = −1 … 67` on the button, so the image top is `−1 − 8.19 = −9.19`. Clip to the button as the plan already does; the box clip is redundant.)
  `bearFrame` drops its optional `buttonH` parameter; fix its caller.
- `beast-frame.test.ts` (override P2020-2036 and P2031-2036):
  - bull at 176: `x ≈ 105` (`toBeCloseTo(105)`), `y = -3`, `h = 88`, `w ≈ 65.2`; **for any W (161, 176, 206): `x + w ≈ W − 5.8`** (replaces the "left offset scales with width" test).
  - bear: `w = 59`, `h ≈ 79.18` (`toBeCloseTo`), `y ≈ -9.19`, `x + w ≈ W + 1` for W in (161, 176, 206).
- The bull `object-position` change in the canvas needs no code change; opacity 1.0 and the overlay blend are already right.
- Step 3 (TradeButton), glyphs: the `sub` line ("win ₹1,930" / "जीत ₹1,930", P2195) is not `font="fig"` any more. Render
  `<FigText text={sub} …>` (Task 4) so ₹ and Hindi use Anek and the digits use Martian.
- Task 6 Step 5 edits the Dock's Buy/Sell row, which Task 7 then rewrites: keep it (Task 6 deletes `trade.buy`/`trade.sell`, so Dock must compile), and
  see T7 below.

## T7 (Dock, keypad, trade length) — Blocker 1
- Step 1 does **not** replace `Dock.tsx` from the plan text. Apply the plan's layout changes onto the current file and keep, exactly as on the branch:
  `import { …, stakeTileLabel, … } from "./stake-input"` (not `stakeDisplay`, not `currencySymbol`) and `const stakeLabel = stakeTileLabel(stake, currency);`.
  The Dock **already uses `TradeButton`** (Task 6 Step 5); do not re-add Buy/Sell text buttons.
- Stake tile: `<Money text={stakeLabel} …>` (the label contains `₹`; `Money` now handles the glyphs). The `"—"` and raw fallback (`₹1e308`) go through the same path.
- The stake-problem line sits between the amount box and the chips (P2368): reserve its height (`minHeight` of one line) so Up/Down do not jump when it
  appears, or note the jump as accepted in the PR. Decision: reserve the height.
- Keypad figure (`"₹ 2,500"`, P2504) and the preset chips (P2530): `<Money>`/`<FigText>`, not `font="fig"`. In `Chip`, a `figures` label renders through `FigText`.
- Hindi: the quick-amount chip strings stay Latin digits (decision 5 of the plan).

## T8 → split into 8a and 8b
Run 8a first, then 8b. Each gets its own Gate and commit; the Task 8 commit message becomes two commits.

### T8a (chrome: pill, tools, status line, bonus stamp, wiring, position strip, strings)
Steps 1–5 and 7 of the plan's Task 8.
- New file `apps/mobile/src/trade/chart-overlay.ts`:

```ts
/** The pill / ⋯ overlay row sits at top 10, 40 high; the chart readout starts 8 below it. */
export const OVERLAY_TOP = 10;
export const OVERLAY_ROW_HEIGHT = 40;
export const CHART_OVERLAY_BOTTOM = OVERLAY_TOP + OVERLAY_ROW_HEIGHT + 8; // 58
```

  `app/(tabs)/trade.tsx` uses these constants for the overlay row (`top`/`height`) and passes `topInset={CHART_OVERLAY_BOTTOM}` and
  `hideReadout={toolsOpen}` to `TradeChart` (8b adds the props). If the ChartTools expanded state is local to `ChartTools`, add an
  `onOpenChange?: (open: boolean) => void` prop and keep `toolsOpen` in `trade.tsx`.
- `PositionStrip.tsx` (whole file, P2846): the detail line ("₹100.00 at …", P2941) and "if it ends now" use `<FigText>`/`<Money>`; `ink3` text
  is fine on `surface` with the new `ink3`. `color.down` text → `color.downText` (`PositionStrip.tsx:39`, `:92`).
- The "Settling…" label fix for the strip is already `countdownText(live, t("trade.settling"))`; keep it.
- Accepted differences from `Main.dc.html` (list in the PR for the device verifier): `SentimentBar` stays though it is not on the canvas; the nav pill is 30 high with a 2pt
  gap (canvas 32/4) so the 48pt nav fits.

### T8b (Chart.tsx: colours, font, tags, readout, trade line)
Step 6 of the plan's Task 8, with these replacements.
- `Chart` props: add `topInset: number` (default `0`), `hideReadout?: boolean`, and `labelFor?: (trade: ChartTrade, nowSec: number) => string`
  (default: `shortCountdown`, keeps `src/chart` free of trade imports). `TradeChart.tsx` passes
  `labelFor={(tr, now) => countdownText({ expired: now >= tr.expiryTs, remainingSec: Math.max(0, tr.expiryTs - now) }, t("trade.settling"))}`.
  Stale-snapshot mode already passes `nowSec = savedAt` (`TradeChart.tsx:53`), so a trade cached after expiry reads "Settling…".
- Trade-line tag (override P3017-3036): `const label = labelFor(tr, nowSec); const text = \`${side} ${label}\`;`
  `const tagW = font.measureText(text).width + 12;` rect `x = plotW - tagW - 4`, text `x = plotW - tagW + 2`. **No triangle** and the line starts at the
  entry candle (see below). White-on-accent text is now AA (4.56:1) at 11px Martian 600.
- Price tag (override P3041-3042): `const text = fmtPrice(lastPrice); const w = font.measureText(text).width + 12; const x = plotW + PRICE_AXIS - 4 - w;`
  rect at `x`, text at `x + 6`; it may overlap the plot, as the canvas does (`Main.dc.html:45`). Text colour `color.ground` on `color.ink`.
- Prices are comma-grouped like the canvas (`94,553.62`): new pure `fmtPrice(n, precision)` in `src/chart/format-price.ts` (Western grouping,
  not Indian: these are market prices) with a test (`94553.62` → `"94,553.62"`, `0.12345` at 5 → `"0.12345"`, `-1234.5` at 1 → `"-1,234.5"`). Use it for the price
  tag, the last-price axis labels and the OHLC strip.
- OHLC readout (override P3046): `position: absolute; top: topInset; left: 6; right: PRICE_AXIS + 6`, `numberOfLines={1}` with `adjustsFontSizeToFit`
  and `minimumFontScale={0.75}`, `<Txt font="fig" size={11}>` (ASCII only, so Martian is right), `backgroundColor: color.surface`, `borderWidth: 1, borderColor: color.rule`.
  Not rendered while `hideReadout` is true (the tools panel is open). Device check at **360dp with the tools panel open and a crosshair active**:
  strip must not overlap the pill, the ⋯ button, the panel or the price tags.
- Entry line (canvas `:46-47`): starts at the entry candle's x (clamped to `0`; use the chart's existing time → x mapping for the trade's
  entry time) and ends a filled 8px-diameter accent dot at that point; the dot replaces the triangle. Colour `color.accent`, width 1.5.
- Grid: three horizontal rules in `color.ruleSoft`, as the canvas (`:38-40`), evenly spaced over the plot height, drawn under the candles.
- "Live ›" back-to-live button (P3047): `backgroundColor: color.accent`, label `<Txt weight={600} size={14} color={color.onAccent}>`, now AA.
- `color.down` text uses are gone from the chart (`downText` for text, `down` for candle fill/stroke).
- Until `useFont(MartianMono_600SemiBold, 11)` resolves, the system fallback font measures the tag; it re-measures when `font` changes (the width is computed per render).

## T9 (sheets: markets, trades ledger, deposit bonus)
- Trades-row detail (P3344), option hints (P4459), Markets subtitles (13px): `<FigText>`/`<Money>` where they hold ₹ or Hindi; plain `ui` `Txt` for words.
- Sheet `aside` "Demo account" (P3317) and ledger text on `raised` (pressed rows) use `ink3` only on `surface`/`raised` with the new `#7c8695` (5.02 / 4.60); on pressed rows
  that is fine. No other change.
- `TradesSheet.tsx:22`, `:74`, `:92`: `color.down` text → `color.downText`.

## T10 → split into 10a and 10b
Each gets its own Gate and commit.

### T10a (form primitives, locale pref, language switch, root layout)
`form.tsx` (whole file, Step 3), `locale-pref` with `resolveLocale`, `LanguageSwitch`, the strings it needs, and the `initI18n` edit in `app/_layout.tsx` (current
`initI18n(localeFromDevice(...))` line, which has moved since the plan; edit in place, keep `PrivacyShield` and `DismissSheetsOnLock`).
- `form.tsx:65` `formStyles.error`: `color.down` text → `color.downText`.
- Sparkline and `sparkline-path.ts` (+ test) go in 10b (they are only used by Login).

### T10b (login, register, forgot, sparkline)
Steps 1-2 (sparkline path + component), 4 (Login), 5 (Register, Forgot), 6 (strings left), 7-8 (Gate, commit). The Google button stays hidden when
`appConfig().googleWebClientId` is empty (earlier amendment). Primary `Button` (accent, 17px/600, white) is AA with the new accent.

## T11 (lock, PIN)
- No change beyond "All tasks". The lock greeting and the `lock-message` tries digit are unchanged.

## T12 (gate screens, offline strip, toasts)
- Step 2 (update screen, P4635): replace the sentence "`cfg?.minVersion` is the app-config field the Gatekeeper already reads" with: "the Gatekeeper decides
  with `useBelowMin()` (`src/gate/use-below-min.ts`); the update screen reads `appConfig().version` and the store link target only." Do not touch
  `Gatekeeper.tsx` here.

## T13 (consistency sweep)
- Step 2 (after the alias-map migration) add: `rg "color\.down\b" apps/mobile/src apps/mobile/app` must show only fills, strokes and borders; every
  `down`-coloured **text** (`form.tsx`, `Dock.tsx`, `TradesSheet.tsx`, `PositionStrip.tsx`) uses `downText`. Fix any leftover.
- Step 5 (e2e selector check, replace the loop at P4737): check the literal ids and the template prefixes separately.

```bash
cd $W/apps/mobile
for id in login-email login-password login-submit lock-set-pin lock-message stake-tile keypad-done buy sell toast gate-maintenance; do
  grep -rq "\"$id\"" src app || echo "MISSING $id"
done
for pre in 'pin-\${' 'key-\${' 'expiry-\${' 'account-\${'; do
  grep -rq "$pre" src app || echo "MISSING prefix $pre"
done; echo done
```

  Expected: only `done`. (`pin-1`, `key-0`, `key-1`, `key-back`, `expiry-30`, `account-demo` exist only as template literals.)
  Also confirm `login-*` really are the ids `.maestro` flows use before running it.
- Also assert the final state with: `pnpm test` (all), including `tokens.test.ts` with the amended `accent`/`ink3` and the new contrast cases.

## Findings the controller could not settle
- None blocking. Reversible calls for the owner to confirm in the PR: `accent #3d6cf0` (from `#3f6ff2`), `ink3 #7c8695`, "+₹x today" hidden unless the day is
  provably covered, and bear/bull art positions from the refreshed canvas.
