# Diwali implementation verification

November 8, 2026. Seasonal lights and a manual celebration are connected to the
landing and platform headers; compact navigation contains the platform entry.
The existing first-visit video work is preserved. No paid assets were generated.

- Web TypeScript check and production build passed.
- 11 focused unit/component tests passed: campaign boundaries/routes, existing
  mute semantics, replay guard, cleanup, hidden-tab cancellation and immediate mute.
- Automated Chromium checks passed for desktop/mobile preview, replay protection,
  mute control, Escape dismissal and reduced motion. Script: `verify.mjs`;
  set DIWALI_TEST_URL to a running local web app.
- Screenshots named landing-* are from the actual landing page on the local
  development server; developer tools indicators are hidden for the captures. The seen-greeting preference was set to reveal the seasonal additions.
- These are automated browser interaction checks, not device FPS measurements.
  Authenticated live trading and physical-device audio quality are not measured.

Configuration: NEXT_PUBLIC_DIWALI_ENABLED=false disables the new ambient/manual
layer on a subsequent build. Default is enabled during the configured India-time
campaign window only. The preview deliberately ignores the campaign date/flag.
This flag does not alter the separately implemented first-visit video greeting.

Implementation uses steady lights, bounded CSS particles and shared Web Audio.
Audio is requested explicitly on each audible celebration. Animation preference
persists; global mute takes precedence and stops active festive sources.
