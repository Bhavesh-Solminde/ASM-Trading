# Up/Down button art (owner's final pick, 2026-10-14)

White-on-transparent engraving art, generated with Higgsfield (marketing-studio/image) and blended into the
Up/Down gradient buttons with `mix-blend-mode: overlay` at opacity 1.0 (see Main.dc.html).

| File | Canvas blob | Use |
|---|---|---|
| bull-b3-bust.webp | /_blob/546c8b56a4498f5d7373702ecfc9b839 | Up button (bull head-and-shoulders, B3) |
| bear-r1-swipe.webp | /_blob/93906df2a5f21946cbfb1e9bf0884851 | Down button (bear swiping down, claws out, R1) |

React Native has no CSS blend modes: emulate overlay (e.g. Skia `Image` with `blendMode="overlay"` over the gradient)
or pre-composite per button colour. Compress further for the APK if needed.
