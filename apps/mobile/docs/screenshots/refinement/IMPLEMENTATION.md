# Compact mobile terminal

Approved design: Figma file FKOYMF8qihz9OG9qKrrIzJ, frame 71:1247.
Branch: codex/trading-screen-refinement.

The execution panel is approximately 200 logical pixels high with an open trade:
44 selected summary + 44 amount/duration + 28 protection/profit + 56 buttons,
with 4px gaps and 8px outer vertical padding. Large text or validation/retry states
can require more space. The original bull/bear artwork is retained.

The selected entry line is green and labelled directly on the line. The current
market price line has its own inline label. Expiry markers track actual trade
timestamps; the selected marker is emphasized. Live appears after panning and
resets both time following and the manual price range. Multiple trades use one
summary row and a scrolling selector, including market selection.

Validation on 2026-11-09:
- 1,538 mobile tests passed; TypeScript and targeted ESLint passed.
- Android debug APK built with JDK 17 and the installed NDK 27.1.
- Emulator fixture checks: open-trade sheet, panning, Live reset, fullscreen,
  account/controls retained in fullscreen, selecting a different open trade. See the implemented PNGs here.
- Screenshot fixtures disable trade/payment actions. These checks do not verify
  real settlement or production orders, iOS, or actual browser/device FPS.

Chart checklist: retained candle history/viewport handling and existing transport;
no changes to market simulation, order matching, or settlement. Countdown updates
remain in chart/card leaves; the surrounding screen does not subscribe to ticks.
No new animation dependency or timer was added.
