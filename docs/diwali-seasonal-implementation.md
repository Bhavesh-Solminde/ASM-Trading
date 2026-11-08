# Diwali seasonal implementation

Branch: codex/diwali-seasonal, based on codex/diwali-first-visit.

Warm 4–9-bulb strands, small SVG diya entries, a landing hero accent and footer
wish are integrated into existing layouts. No chart engine, tick scheduling,
transport schema, order or settlement calculation is changed.

The diya entries now open the same approved video popup directly. The additional
manual fireworks panel and its sound/animation buttons were removed after the
user clarified that only the video and one Close button should appear.

Short AAC samples are extracted from the user's chosen recording (pop:
7.0–8.1 s; rise: 3.5–3.85 s), with fades and reduced level; final files total
about 18 KB. Win fireworks follow the existing site sound setting, decode once
on a user gesture, and stop immediately on global mute. Reduced motion disables
win fireworks and their audio. Sounds and CSS share burst timing constants.

The existing server-confirmed trade:settled notification path can trigger compact
win fireworks. Only positive WON/CLOSED results qualify. Initial history is
excluded; bounded session IDs prevent repeated effects on remount/reconnect.
The ordinary win chime is replaced only when festive audio actually starts.
Busy/hidden/reduced-motion/focus/modal states do not queue later celebrations.
Effects stop on dismissal, route change, mute, preference change or campaign end.

The existing welcome video remains once per browser. Following the latest user
correction, its popup is now video-only with one Close icon. It closes on ending
or Escape and remembers the visit. Audible autoplay is attempted; when the
browser blocks it, video retries muted without adding UI controls. Reduced
motion shows the poster. There is no heading bar, footer or playback toolbar.

Campaign end: November 13, 2026 at 00:00 Asia/Kolkata (after November 12).
Set NEXT_PUBLIC_DIWALI_ENABLED=false and rebuild to disable seasonal decorations;
this is a deployment flag, not an instant remote switch for already-open tabs.

## Validation

- 36 focused tests: first-visit lifecycle, video-only controls, autoplay fallback,
  site-mute precedence, sound activation/cancellation, route/date boundaries,
  positive-win eligibility, deduplication and dialog priority.
- TypeScript, targeted ESLint and production build passed.
- Browser checks: landing page at 320, 390, 1440 and 2560 px; welcome popup at
  390, 820 and 1440 px; controls fit with no horizontal overflow in checked views.
- Final browser review verified that clicking the diya opens the approved video
  and the dialog contains exactly one button: Close. Physical speakers/headphones
  were not independently evaluated; no device or frame-rate guarantee is claimed.
- Trading chrome/result appearance was checked with the real shell/result
  components and sample data in a temporary local fixture. The configured DB is
  shared, so no user/account/trade records were created or modified. The temporary
  fixture was removed and is not shipped. No live order was placed for testing.
- Actual market-switching/FPS profiling with authenticated live data was not
  performed. Source review confirms no chart/market store subscriptions were
  added. Automated DOM tests are not browser FPS measurements.
- /diwali-preview stays removed. No other permanent preview route is introduced.

Screenshots are retained locally under artifacts/diwali-seasonal and are not
runtime assets. API keys, recordings and raw generation/reference files are not
included in the commit. The original checkout's unrelated changes remain intact.
