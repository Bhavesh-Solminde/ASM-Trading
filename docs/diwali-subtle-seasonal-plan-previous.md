# Subtle Diwali additions — implementation plan

Date: November 8, 2026, India time.
Status: planning only. This document does not authorize deployment or paid generation.

## Outcome and proposed defaults

Add a restrained seasonal layer to IndianxTrade: small warm header lights, a diya
greeting, and a user-triggered three-second fireworks sequence with synchronized
sound. Preserve the existing brand, layout, typography, chart behaviour and
complete tick/order/settlement behaviour.

These are proposed defaults for the current brief, not additional user-approved
requirements. Earlier video/storyboard work remains available and unchanged.
An optional greeting video and win-triggered celebrations are separate extensions;
the initial implementation uses a manual celebration control.

“Bomb light” is provisionally interpreted as decorative bulbs and firecracker
sparks. The implementation can accommodate a different visual reference later.

## Observed foundation and remaining work

Source inspection, not a runtime or visual acceptance assessment:

- `apps/web/src/components/festive/Diwali.tsx` already contains a provider, diya,
  greeting dialog, video greeting and three bursts of twelve CSS particles.
- `apps/web/src/app/diwali-preview/preview.tsx` presents a simulated trading screen
  at desktop/tablet/mobile dimensions. Its simple chart cannot establish live
  trading performance or integration correctness.
- The root and platform layouts currently do not mount the Diwali provider.
- Header lights exist in preview-specific markup/styles; they need extraction
  into a shared component before real-header integration.
- `apps/web/src/lib/sound.ts` already provides Web Audio fireworks and settlement
  sounds. Global sound defaults to enabled; this must not be treated as explicit
  consent to festival audio. The video has an independent mute state.
- Global mute currently persists a value; there is no shared notification mechanism
  there to cancel every currently playing festive source immediately.
- The provider automatically opens its first-visit greeting. Ambient decorations
  must be decoupled from opening that dialog for the proposed manual experience.
- The provider excludes only admin and maintenance. Add an explicit route policy.
- The preview provider bypasses the campaign date, but its win-firework component
  separately checks the real date. Preview must work after the campaign expires.
- Video playback uses a separate asset naming scheme from the newer welcome
  exports. Do not assume the preview displays the latest film without verifying it.
- The current live-dialog timeout is eleven seconds. If the approximately
  seventeen-second film is later used, dismiss on actual video end or user action,
  rather than that fixed timeout.

## Visual specification

Retain navy `#080E16`, panel `#0E1820`, blue `#2F81F7`, white `#F4F7FB`, Hanken
Grotesk and the exact existing logo. Seasonal decoration uses amber `#E9BD72`
and pale gold `#FFE4A1`; it must not replace status or trading colours.

| Element | Desktop | Compact/mobile |
| --- | --- | --- |
| Header lights | 7–9 bulbs, 3–4 px, soft 6–8 px glow | 4–5 bulbs; same reserved top edge |
| Wire | Optional fine, shallow SVG curve in free header space | Omit if visually cramped |
| Greeting | Small diya and “Happy Diwali” near available navigation space | Diya/greeting in navigation menu |
| Celebration control | “Celebrate Diwali” in header or its small seasonal panel | Menu item opening the same panel |
| Hero lighting | Two faint corner glows, roughly 6–10% opacity | One smaller glow |
| Footer wish | “Wishing you a joyful festival of lights.” | Show where normal footer space permits |

Use the existing header height: 60 px desktop and 50 px compact in the platform.
Reserve the top decorative band without shifting controls. Fit at the project's
actual compact breakpoint below 1024 px, including portrait tablets and short
landscape. Trading account, balance, navigation and deposit controls keep priority.

Light behaviour: a soft introduction lasting no more than eight seconds, then
steady illumination. Any flame movement follows the same duration limit. Motion
does not restart on every internal navigation. No animated blur or shadow radius;
animate a pre-styled glow's opacity or transform if needed.

## Interaction and sequence

1. Enter an eligible page during the campaign: lights appear quietly; no audio.
2. Open “Celebrate Diwali”: a compact panel offers Play fireworks, Sound, and
   Animation controls. On the landing page use the hero's decorative area; on
   the trading screen use a contained celebration panel outside the chart surface.
3. An explicit “Celebrate with sound” action enables festival sound and starts
   playback when global sound is not muted. Always offer a silent playback action.
4. If global sound is muted, show “Site sounds are muted” and offer an explicit
   unmute action; do not silently override the setting. Unmuting the site alone
   does not opt the user into festival sounds.
5. Run one three-second sequence; re-enable replay after a five-second interval
   measured from launch. Ignore repeated clicks while a sequence is active.
6. Closing the panel, changing route, entering focus mode, hiding the tab,
   disabling the campaign or changing motion preference cancels the sequence.
   Return to idle without queued replays when the visitor comes back.

| Time | Visual | Audio |
| --- | --- | --- |
| 0–0.4 s | Small rising spark at an edge | Short gentle hiss |
| 0.4 s | First gold burst | Soft pop and fine crackle |
| 0.85 s | Second gold burst | Slightly different soft pop |
| 1.3 s | Smaller blue-white burst | Quieter pop and fading crackle |
| 1.3–3 s | Trails fade completely | Tail fades to silence |

Use 36 burst particles desktop and 24 compact as initial budgets, plus at most
three launch trails. Use one shared timing specification for CSS delays and audio
scheduling. Reset visual nodes once per launch, never once per animation frame.
Check perceived synchronization on devices rather than relying on timer values.

A decorative layer uses `pointer-events: none` and `aria-hidden`. The actual
controls are normal accessible buttons. The panel must not conceal prices or
order controls. A mobile dialog is allowed only after the visitor opens it; it
needs Escape/close, focus containment and focus restoration.

## Component and file plan

Paths below are relative to `apps/web/src/`.

| File/component | Planned responsibility |
| --- | --- |
| `lib/diwali.ts` | Campaign identifier, absolute start/end instants, route policy and pure eligibility functions |
| `components/festive/Diwali.tsx` | Preserve existing preview exports; separate ambient activation from greeting playback |
| `components/festive/FestiveLights.tsx` (new) | Fixed decorative bulbs and optional SVG wire |
| `components/festive/DiwaliControls.tsx` (new) | Accessible greeting, play, mute and animation controls |
| `components/festive/Fireworks.tsx` (new) | Bounded visual sequence and cancellation; extract existing Sparks primitive |
| `components/festive/Diwali.module.css` | Scoped decoration, compact rules, motion fallbacks and layer ordering |
| `lib/festive-preferences.ts` (new) | Small observable preference store; same-tab notification and cross-tab storage updates |
| `lib/sound.ts` | Reuse shared AudioContext; cached crackle buffer; scheduled cancellable sources; global mute notification |
| `components/marketing/BoldLanding.tsx` | Lights in BoldNav, hero decoration/celebration area and footer wish |
| `components/shell/PlatformShell.tsx` | Scoped platform festival boundary and focus-mode cancellation |
| `components/shell/TopBar.tsx`, `MobileNav.tsx` | Desktop placement and compact-menu entry |
| `app/diwali-preview/preview.tsx` | Use shared components; controls for simulated date, mute, motion and viewport |

Read the installed Next.js guides and applicable React performance skill before
implementation. Keep client state in small seasonal components; do not convert
the entire landing page to a client component. Preserve work already in progress
in shared files and review their current diffs before editing.

A single festival controller per page owns active playback. Ambient lights and
controls subscribe only to campaign/preferences, not market updates. Avoid broad
root-layout integration that accidentally activates effects on excluded routes.
Load the fireworks/audio feature on demand. Keep any optional video unloaded until
explicitly opened, with an accessible static fallback.

## Audio lifecycle and preferences

Festival audio starts off for a new visitor. Persist explicit festival consent
under a separate campaign key. Existing global mute always wins. Preference reads
must tolerate unavailable storage and avoid server/client markup disagreement.

Resume/create the shared AudioContext inside a user gesture. Check actual context
state and handle a rejected or suspended start. Do not postpone sound until well
after a silent visual sequence has begun; offer another explicit playback attempt.

Use a shared master gain for festive sources with gentle attack/release and a
conservative initial level. Prepare and cache the short synthesized crackle once.
No new sound library or paid audio assets are required. If listening review finds
the synthetic sound unconvincing, consider a licensed local sample as a separate
asset decision.

Register all scheduled sources for immediate cancellation, including those that
have not started. Disconnect ended nodes and clear timers/listeners on cleanup.
Global mute should stop festive sound through same-tab notification; storage
events handle another tab. Do not accidentally stop settlement sounds when only
festival audio is muted. Existing trade-sound behaviour remains covered by tests.

## Route and campaign policy

| Area | Treatment |
| --- | --- |
| `/` | Full subtle treatment and manual celebration |
| `/trade` | Quiet header treatment; manual contained celebration; disabled in focus mode |
| Account, history, leaderboard, support, referral, balance | Quiet header treatment; optional manual entry in shared navigation |
| Login/register, checkout, deposit, withdrawal, verification | Static accent at most; no animated overlay or celebration |
| Admin, maintenance, network-blocked | Disabled |
| `/diwali-preview` | Explicit local preview mode independent of real campaign date |

Default proposed window matches existing code: November 8, 2026 00:00 IST through
November 12, 2026, with exclusive end November 13 00:00 IST. Central enabled switch
defaults off until integration is ready. Evaluate start and end for already-open
tabs, re-evaluate on visibility changes, and cancel playback at expiry. Use bounded
timers when future dates exceed browser timer limits.

Initial kill switch can be deployment configuration: document that changing it
requires deployment and a fresh configuration read. If instant shutdown in already
open sessions is required, add a server-read campaign status with bounded refresh;
do not describe a build-time environment variable as a live switch.

## Accessibility and performance acceptance

- Reduced motion produces steady lights and a static greeting; no fireworks or
  related sounds. An Animation off preference behaves the same way.
- No rapid flashes, screen-wide brightness pulses, background audio or loops.
- Interactive targets aim for 44 px, visible focus and plain accessible labels.
- Decorations cause no layout shifts and never intercept chart gestures.
- The completed sequence releases particles, audio nodes and timers.
- Hidden tabs stop festive work without pausing the market simulation.
- No festive network requests for price updates and no extra chart subscriptions.
- No new runtime animation dependency; target under 15 KB additional compressed
  JavaScript for the seasonal feature, subject to an actual build comparison.
- Profile the real trading page with effects off/on, on desktop and a representative
  mobile device. Target no new repeated >50 ms tasks and chart redraw p95 below
  16 ms where the existing baseline supports it. These are targets, not results.

Apply all six checks from `docs/chart-performance-checklist.md` proportionately:
(1) preserve incremental candles/pan/zoom; (2) keep rows stable and decorative
state isolated; (3) leave stream/snapshot payloads unchanged; (4) verify market
switching during playback; (5) leave simulation/worker scheduling unchanged;
(6) measure browser rendering and report it separately from DOM/server tests.
No simulation changes are planned, so accelerated replay/equivalence benchmarks
are conditional on any implementation unexpectedly touching that machinery.

## Delivery tasks and acceptance gates

1. **Preview refinement:** extract shared lights/diya, implement placement and
   steady-state appearance. Review 320, 390, 768, 1024 and 1440 px widths plus short
   landscape. Compare normal and decorated views using the actual page chrome.
2. **Sequence and sound:** implement synchronized playback, preference precedence,
   stop/replay handling, reduced motion and hidden-tab cancellation. Listen on
   headphones and speakers; check current Chrome, Firefox, Safari and mobile
   Safari/Chrome where devices are available. Report unavailable device coverage.
3. **Integration:** mount scoped providers and route rules, insert compact-menu
   controls, preserve trading focus mode, and add explicit campaign configuration.
4. **Focused automated verification:** date boundaries and open-tab expiry; preview
   outside the campaign; route exclusions; global mute overriding festival consent;
   immediate mute; repeated-click protection; unmount/hidden/reduced-motion cleanup;
   blocked storage/audio; keyboard dismissal and focus restoration. Avoid tests
   that merely assert decorative markup counts.
5. **Real-page verification:** test market switching, pan/zoom, order controls,
   account menus and overlays during playback. Run relevant existing sound and
   trading regressions, typecheck and build. Keep baseline failures distinguishable.
6. **Reviewable delivery:** screenshots of actual desktop/mobile pages, a short
   recording with audible fireworks, test results, browser profile summary and
   documented activation/expiry/rollback settings. Implementation and deployment
   are separate from this planning-only task.

## Reference behaviour

- Browser audio activation: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- Reduced motion: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion

Existing video concepts and prior asset instructions remain in
`docs/diwali-storyboard.md` and `artifacts/diwali/final-generation/README.md`.
