# Subtle Diwali treatment — implementation plan
Updated November 8, 2026 (Asia/Kolkata). Planning deliverable only.

## Goal and current state
Keep IndianxTrade recognisable: existing navy/blue backgrounds, typography, logo,
spacing, chart colours and controls. Add restrained warm lights, small diya
details and short fireworks with synchronized sound.

The approved 13-second first-visit video is already pushed on
codex/diwali-first-visit (3d70761). Pushed does not mean merged or deployed.
Its first-visit persistence and end-of-video dismissal remain separate from
ambient decorations. Never reset its seen key to introduce seasonal lights.
The user removed /diwali-preview; do not recreate that route.

Uncommitted local drafts exist in SeasonalDiwali.tsx, SeasonalDiwali.module.css,
DiwaliCelebration.tsx, sound.ts and shared headers/landing components. They are
a starting point, not verified shipped functionality. Inspect current diffs
before reuse; keep unrelated work out of the implementation branch.

Interpret “bomb light” as small festive string bulbs and a brief firecracker
spark detail. Avoid introducing a large animated explosive illustration.

## 1. Art direction and placement
Base colours remain existing design tokens: ground #080E16, panel #0E1820,
brand blue #2F81F7, white #F4F7FB. Seasonal highlights use warm amber #E9BD72
and pale gold #FFE4A1. Profit/loss and order colours retain their current meaning.

| Placement | Proposed change | Limits |
| --- | --- | --- |
| Landing navigation | Fine warm string lights along its upper edge | 7–9 small bulbs on desktop, 4–5 compact; no header height change |
| Landing hero | Small diya + Happy Diwali greeting above existing content; faint warm corner glow | No replacement hero, background, logo or CTA |
| Trading header | Sparse upper-edge lights and one small diya entry | Balance, market/account controls and deposit retain priority |
| Compact navigation | Celebrate Diwali entry inside existing menu | Avoid adding a floating button over the trade ticket |
| Landing footer | Small warm wish and one diya | Only where existing footer space permits |
| Result notification | Brief fireworks around a confirmed positive result | Keep the amount and result text unobscured |

The lighting can fade in over roughly 600 ms, then remain steady. If a gentle
twinkle is retained, run a short introduction once, then settle. No permanent
blinking, full-screen brightness pulses, falling objects or animated shadows
across price data. Use existing layout space and decorative absolute layers.

## 2. Behaviour
Three distinct experiences:
1. Existing welcome video: first eligible visit, once per browser; unchanged.
2. Ambient decoration: visible on eligible pages throughout the campaign.
3. Fireworks: explicit Celebrate action or a newly confirmed winning result.

Manual celebration: tap the diya/menu item to open the existing compact seasonal
panel, then choose Celebrate with sound or Play quietly. One 2.5–3-second sequence;
5-second cooldown from launch; repeated clicks do not stack or queue.

Win celebration: use the existing live result-notification path, after the server
confirms final settlement with positive net P&L. Trigger once per trade ID.
No celebration on pending/optimistic results, zero/negative P&L, historical rows,
initial history hydration, reconnection replay, or notification remounts.
Use bounded recent-ID storage and the notification lifecycle; verify refresh
deduplication. Do not subscribe separately to price ticks or settlement streams.
Coalesce simultaneous eligible wins into one brief visual/audio sequence;
each result notification remains intact. Prefer a compact 1.5–2-second burst
in the notification's decoration zone. Do not open a celebration modal after wins.

A single page controller arbitrates celebrations: welcome dialog wins priority;
manual/win bursts are suppressed while it is open or another blocking flow is
active. No delayed burst after the visitor dismisses a modal. Focus mode and
hidden tabs suppress/cancel fireworks, without stopping market processing.
A missed or suppressed celebration is not replayed later.

## 3. Fireworks choreography
Use restrained gold with a smaller blue-white accent. Desktop initial budget:
36 particles total (3 bursts of 12); compact: 24 total. Add at most 3 launch trails.
Adjust only if actual quality/performance review justifies it.

Manual sequence:
- 0.00–0.35 s: short rising trail; gentle hiss.
- 0.40 s: first gold burst with a soft pop.
- 0.85 s: second burst, slightly smaller.
- 1.30 s: blue-white accent and quiet crackle.
- By 3.00 s: all trails and sound have faded.

For wins, use fewer bursts and a shorter tail. Screen-edge space may be used
on the landing page; trading effects remain in the notification/panel region.
Decorations are aria-hidden and pointer-events:none; chart gestures and controls
remain accessible. Do not spread particles across prices, market selection,
order entry or deposit/withdraw controls.

## 4. Sound approach
Use the user's selected recording already extracted into
artifacts/diwali/audio-reference/extracted-original.m4a. Extract clean short
pop/crackle/hiss segments locally with FFmpeg, checking they contain no speech,
music, interface clicks or excessive peaks. Do not play the entire 13-second
video sound for each win. Save only final short web assets under public/festive.

Reuse the existing shared Web Audio infrastructure in lib/sound.ts:
- Decode each short sample once on demand and cache the AudioBuffer.
- Schedule burst visuals and sound from the shared sequence specification.
- Use short gain ramps, conservative volume and a separate festive gain node.
- Keep synthesis as a fallback only if a clean sample cannot be isolated.
- Stop and disconnect active and scheduled sources on mute/cancel/unmount.
- Replace the ordinary win chime during an audible festival burst instead of
  playing two effects simultaneously. Otherwise preserve existing win sound rules.

Proposed preference: festival audio initially off, enabled by the explicit
Celebrate with sound action or a clear festival sound toggle. Persist this choice
for the campaign. Global site mute always overrides it, including mid-playback;
never silently unmute the site. Video unmute remains video-specific.
For later win sounds, resume the audio context during a permitted gesture;
if the browser suspends or blocks sound, render silently rather than queue it.
No sound from page load, hovering, scrolling or static lighting.

Browser user activation restrictions:
https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
Audio API:
https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

## 5. Tools and component architecture
No additional paid AI generation, Higgsfield jobs or runtime animation library.
Use React/Next.js, scoped CSS Modules, small inline SVG shapes, CSS transform/
opacity keyframes, Web Audio, and FFmpeg for local sample editing.

Reuse/refine:
- lib/diwali.ts: campaign window, route eligibility, shared sequence timings.
- SeasonalDiwali.tsx: scoped activation, one playback coordinator, route/focus/
  visibility cleanup. Keep state independent of chart price updates.
- SeasonalDiwali.module.css: header lights, diya, responsive decoration and bursts.
- DiwaliCelebration.tsx: accessible manual celebration controls.
- lib/sound.ts: cached sample playback, global mute notification and cancellation.
- Add a small campaign preference store if needed for shared sound/motion state.
- Add/extract WinDiwaliFireworks for the existing result notification.
- BoldLanding, TopBar and MobileNav: placements only.
- PlatformShell: scope treatment to platform routes, suspend it in focus mode.
- FirstVisitDiwali: coordinate active-modal priority without replaying the welcome.

Preserve server/client component boundaries; do not convert the entire landing
page into client code. Lazy-load fireworks/audio code when it is needed.
Do not ship generated source files, reference screenshots, API payloads or old
video candidates as website assets.

## 6. Responsive and route policy
320–430px phones: 4–5 lights; menu entry; 24-particle budget; touch targets at
least 44px where possible; safe-area-aware placement.
768–1024px tablets: choose the compact or desktop treatment at the actual existing
header breakpoint (currently compact below 1024px), based on available space.
1280–1440px desktop: 7–9 lights with full small label where it fits.
1920–2560px wide desktop: cap decorative spread to content width; do not increase
particle count or bulb density just because the viewport is wider.
Check portrait/landscape, short screens, zoom and long labels.

Landing/trade/history/leaderboard and ordinary information pages receive the
scoped treatment. Login/register can have a static diya/accent; their existing
first-visit greeting remains eligible as already discussed. No new ambient
firework overlays on deposit, withdrawal, checkout, verification, admin,
maintenance or network-blocked pages. Decorations never block important flows.

## 7. Accessibility, campaign and performance
Respect prefers-reduced-motion: steady lighting and a static wish, no burst
animation or its accompanying audio. Also offer a persistent Animation off
control for the seasonal effect. Maintain keyboard access and focus restoration.
https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion

Use the agreed window: November 8–12, 2026, inclusive in India;
exclusive end is November 13, 2026 at 00:00 Asia/Kolkata.
Existing tabs must switch off and stop audio at expiry. Expose a documented
deployment-level disable flag. A build-time flag is not an instant remote switch;
do not claim it can immediately disable already-open sessions.

Target: no new layout shift, no perpetual animation loop, no repeated network
requests, no chart subscriptions, no new runtime dependency. Aim for under 15KB
compressed incremental seasonal JS excluding existing video and the small audio
samples; verify actual build output before claiming the size.

Apply docs/chart-performance-checklist.md proportionately:
1. Leave incremental chart updates and pan/zoom intact.
2. Isolate seasonal state; preserve stable market/order rows.
3. Leave transport payloads and snapshots unchanged.
4. Verify market switching while a celebration is visible.
5. Leave simulation, workers, ticks and settlements unchanged.
6. Profile actual browser frame intervals/long tasks with effects off and on;
   report separately from automated DOM tests. No FPS claim without measurement.

## 8. Implementation order and acceptance
A. Reconcile local drafts and the pushed greeting branch. Establish a clean
   implementation branch with only seasonal changes.
B. Place lights/diya on the actual landing and platform headers. Capture before/
   after screenshots on phones, tablets, desktop and wide desktop.
C. Prepare the selected audio samples and refine one short synchronized manual
   sequence. Review audible output, perceived sync and volume.
D. Integrate win-triggered bursts, shared preferences, deduplication, modal
   priority and cleanup. Preserve normal trading and notification semantics.
E. Test campaign boundaries/open-tab expiry; route rules; first-visit key unchanged;
   mute precedence and immediate cancellation; repeated clicks/simultaneous wins;
   history hydration/reconnect/remount dedup; focus mode; tab visibility; reduced
   motion; blocked storage/audio; keyboard close and focus restore.
F. Run targeted tests, TypeScript, lint and build. Check actual chart gestures,
   market switching and order controls while effects run. Listen on available
   speakers/headphones; disclose unavailable physical-device/browser coverage.
G. Deliver actual-page screenshots, an audible short recording, test results and
   profile observations. Review before the next push/deployment instruction.
   No /diwali-preview route, and no paid generation, is required.

## Definition of done
The site still looks like IndianxTrade; Diwali is visible in a few restrained
details. Fireworks are brief, synchronized and cancellable. A visitor controls
sound and motion. Genuine new wins can celebrate once without changing any
financial behaviour. The welcome video is not replayed. Everything switches off
after November 12. Planning this work does not mean the draft is implemented,
verified or deployed.
