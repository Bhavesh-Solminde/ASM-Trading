# Mobile P5 implementation report — 2026-11-01

All nine planned code tasks are implemented on `codex/mobile-p5-distribution`, based on P3 merge `899a618`. Integrate after P4; push endpoints retain P4's interfaces.

1. Manifest, 192/512/maskable icons and six iPhone startup images from the supplied brand mark; iPhone metadata.
2. Installed-only, push-only service worker, with no fetch handler/caching; protected same-origin notification navigation; headers and minimum-version exemptions.
3. Signed-in product-only iPhone install guide and Android app bar; resilient storage, frequency rules, accessible modal and illustrated steps.
4. Installed-browser push opt-in, clear denied/error states, registration rollback, opt-out and local unsubscribe before sign-out.
5. Version-validated APK stream/checksum/help routes and read-only compose mounts; realpath/descriptor checks reject symlink escapes.
6. Signed Expo Updates v1 endpoint, correct multipart and JSON negotiation, immutable asset URLs, verified SHA-256 content, variant isolation, completed-upload marker and traversal/symlink rejection.
7. expo-updates client, signed configuration when the owner certificate exists, direct-only translated update prompt. Missing certificate disables OTA safely. Release config enforces TLS and excludes generated dev-client schemes.
8. Tag-triggered signed Android/OTA workflow using pinned SSH host trust, owner secrets and cleanup. Release scripts fail before build/upload without real public signing certificate. No production calls or release tags were made.
9. macOS fallback script and full release/setup/rollback runbook.

## Plan corrections

- Runtime is `<app version>-play|direct`, exported separately. Sharing the original plan's runtime/config would deliver the wrong `extra.variant` to one installed variant.
- READY is written only after export validation; uploads stage in hidden directories and rename atomically. Manifest selection ignores incomplete exports.
- Existing installed Expo updates do **not** revert when the newest server directory is deleted. The runbook requires republishing a known-good export with a fresh creation timestamp/ID. Published asset URLs remain immutable.
- No fabricated Claude attribution or generated private signing identity was added.

## Verification

- Targeted web suite: 9 files, 34 tests, including 9 OTA tests and service-worker external-URL tests.
- Full mobile suite: 137 files, 1490 tests.
- Web and mobile TypeScript checks passed; changed-code ESLint passed.
- Production Next build passed with nonproduction placeholder build env.
- Android Expo export passed (2946 modules); real exported asset names match the manifest's MD5 asset key mapping.
- Both release scripts passed `bash -n`. A throwaway Gradle fixture verified signing injection is idempotent and secret quotes/dollar signs are never emitted into source.
- Missing-certificate release preflight was exercised and refused the build before installing/building/uploading anything.
- Protocol checked against [Expo Updates v1](https://docs.expo.dev/technical-specs/expo-updates-1/): empty multipart 204 allowed; SFV v0 and signed manifest-part headers, RSA signatures over exact JSON bytes; creation-time update ordering.

## Owner setup and physical validation remain

Real Play/direct keystores and aliases/passwords; public OTA certificate plus matching server private key; both Firebase app files and FCM credentials; OAuth IDs; VAPID keys; pinned VPS host key; Google Play account/review. The release runbook names every local/GitHub/VPS location. These cannot be invented by an implementation agent.

No physical iPhone/Android install, signed APK/AAB, real push delivery, signed OTA apply/rollback, deployment or live-money action was performed. Follow `docs/mobile-release.md` and complete Hindi/device review before an app release.

## Independent review fixes

The Android app banner now occupies its own automatic-height shell grid row above navigation; it no longer overlays or intercepts ticket controls. The chart uses the remaining flexible space while the ticket keeps its intrinsic height.

The authenticated shell now synchronizes an existing browser push endpoint on account entry/change and on foreground return, even when Account settings is never opened. A new authenticated user replaces the prior endpoint owner before the toggle reports On; rejected/expired-session registration unsubscribes locally. Browser logout cleanup has a three-second deadline over the whole operation, including worker discovery/unsubscribe, so a stalled browser API cannot hold session revocation open.

Regression checks cover A → expired session → B with a persisted subscription, expired-cookie cleanup and a never-completing browser worker lookup. These checks, TypeScript, ESLint and the production website build passed.
