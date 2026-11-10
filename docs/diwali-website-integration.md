# First-visit Diwali greeting

The root website layout now mounts `FirstVisitDiwali`. It uses the approved
13-second edit starting at second four, with the replacement audio extracted
from the user's November 8, 9:52 AM screen recording.

- First eligible visit is remembered immediately using the existing versioned
  localStorage key plus a first-party cookie fallback. Remounts, navigation,
  reloads and later visits do not automatically repeat the greeting. This is
  per browser profile, not a cross-device account flag. Clearing site data can
  allow it to appear again. An in-memory fallback covers remounts when storage
  is blocked; persistence cannot be guaranteed if all storage is disabled.
- Video elements and media sources are mounted only while the greeting opens.
- The dialog closes on video completion, Skip, Continue, Escape, or campaign
  expiry. It does not use a wall-clock timeout that can cut off stalled playback.
- Playback begins muted because browser autoplay requires this; the user can
  enable the provided sound with a tap. Reduced-motion visitors see a greeting
  poster and can opt into playback. Hidden tabs pause playback.
- Mobile uses the 720p derivative; larger displays use the 1080p master.
  Both contain the entire 16:9 composition. Flexible controls and constrained
  modal dimensions support phones, tablets, landscape and wide desktops
  without cropping the greeting or logo. The wide layout caps at 1440px.
- Admin, maintenance and the dedicated review route do not consume the first
  visit. The temporary `/diwali-preview` route was removed at the user's request.
- Campaign ends at 2026-11-13 00:00 Asia/Kolkata, after November 12.

## Validation

13 focused tests passed for first visit, StrictMode, revisits, storage fallback,
campaign boundaries/expiry, excluded routes, real playback completion, reduced
motion, sound activation and failed-media dismissal. TypeScript and targeted
ESLint checks passed. Home, preview and all three assets return HTTP 200; video
byte-range streaming returns 206. The 13-second source is 1920x1080 with stereo
audio; the mobile derivative is 1280x720.

Browser access was restored on follow-up. Verified the actual homepage dialog
at 390x844, 820x1180, 1440x900 and 2560x1080: dialog and controls fit,
no horizontal overflow, full video composition retained. Mobile selected the
720p source and desktop selected the 1080p source. Verified click-to-unmute,
real completion dismissal and reload with no dialog or video element mounted.
These are desktop browser viewport checks, not physical-device/FPS benchmarks.
Screenshots are in `artifacts/diwali/website-checks/`.

Fixed the preview StrictMode cleanup reopening and transient source-error
handling discovered during browser review. Tests, TypeScript and ESLint passed
again. The existing development-only CSP/eval warning is unrelated to this
change; security headers were not weakened. Changes are in the local workspace
and dev website; no production deployment was performed.
