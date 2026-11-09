# Trading screen refinement — awaiting design review

Editable Figma board: https://www.figma.com/design/FKOYMF8qihz9OG9qKrrIzJ/IndianxTrade-Mobile-redesign-review?node-id=66-1124

- `figma-review-r6.png`: verified export of editable before/after, fullscreen, and account-selector designs.
- `website-desktop.png` and `website-phone.png`: rendered local components with synthetic market/account fixtures. These are UI evidence, not production account data or browser frame-rate measurements.

Implementation work is local on `codex/trading-screen-refinement`. The user asked to edit and approve the Figma design before any further implementation. Review the final Figma version and reconcile differences after they confirm it is ready.

Before the design pause: all 1,536 mobile unit tests passed; mobile and website type checks and targeted lint passed; 7 relevant website tests passed. An Android debug build succeeded and loaded on the emulator. End-to-end gesture, settlement and actual-device frame-rate validation remain pending.
