# IndianxTrade mobile releases

## Toolchain

Use Node 22, pnpm 10.33.0, JDK 17, Android SDK platform 36 and build-tools 36.0.0. On macOS install Temurin 17 and Android command-line tools, set `JAVA_HOME` and `ANDROID_HOME`, add the SDK platform-tools to `PATH`, then accept SDK licences. Run `sdkmanager "platforms;android-36" "build-tools;36.0.0"`. The release script checks the app tests and types before producing artifacts. It sets `APP_RELEASE_BUILD=1`, enforces HTTPS/WSS and disables the generated `exp+` development-client URL scheme. No Expo account is required.

## Keys and initial setup

Only the owner creates signing identities. Keep an encrypted offline backup of every private key and password. Never commit keystores, private PEMs, Firebase service accounts or `google-services.json`.

| Material | Local file / GitHub secret | Server |
| --- | --- | --- |
| Play upload key | `~/.indianxtrade/keys/play.p12`; `PLAY_UPLOAD_KEYSTORE_B64`, `PLAY_UPLOAD_KEYSTORE_PASSWORD`, `PLAY_UPLOAD_KEY_ALIAS`, `PLAY_UPLOAD_KEY_PASSWORD` | Never needed |
| Direct APK signing key | `~/.indianxtrade/keys/direct.p12`; `DIRECT_KEYSTORE_B64`, `DIRECT_KEYSTORE_PASSWORD`, `DIRECT_KEY_ALIAS`, `DIRECT_KEY_PASSWORD` | Never needed |
| Firebase Android configuration | `gs-play.json`, `gs-direct.json`; `GOOGLE_SERVICES_PLAY_B64`, `GOOGLE_SERVICES_DIRECT_B64` | Never needed |
| Google web OAuth client | `APP_GOOGLE_WEB_CLIENT_ID` | Server OAuth setup from P1 |
| OTA signing key | Offline `expo-updates-private.pem`; public certificate at `apps/mobile/certs/certificate.pem` | `EXPO_UPDATES_PRIVATE_KEY` (PEM; escaped newlines accepted) |
| Firebase service account | Owner backup | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` |
| VAPID keypair | Owner backup | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Deploy identity | `VPS_SSH_KEY` plus pinned `VPS_KNOWN_HOSTS`, `VPS_HOST`, `VPS_USER` | Restricted deployment account |

Create distinct Android OAuth/Firebase app entries for `com.indianxtrade.app` and `com.indianxtrade.app.direct`. Download each matching Google services file. Keystores are PKCS12; choose and save each key alias. To create the OTA keypair once, use `openssl genrsa -out expo-updates-private.pem 2048` and `openssl req -new -x509 -key expo-updates-private.pem -out certificate.pem -days 3650 -subj "/CN=IndianxTrade Updates"`. Copy only the certificate into the repo and put its corresponding private key on the server. These commands must run in the owner's private keys folder, outside the repo.

Until that public certificate exists, development builds disable OTA and the release script fails early. There is no unsigned fallback. After committing the certificate, confirm the server key matches it using public-key fingerprints before publishing an update.

Losing the direct key means existing APK users cannot upgrade without uninstalling. Losing the Play upload key requires a Play Console upload-key reset. Losing the OTA key requires embedding a new certificate in a full build; existing installations trust the old certificate. Firebase/VAPID rotation may require device re-registration. Keep a verified, pinned VPS host key in GitHub rather than trusting a host-key scan at deploy time.

## Server preparation and deploy order

Deploy the money hotfix before the mobile server stack. Apply the push-notification migration before starting the new engine. Create `/srv/app/releases` and `/srv/app/updates`, owned by the deployment user and readable by container UID 1001. The web service mounts both read-only. Recreate the web container after compose/env changes: from `deploy/`, `docker compose --env-file ../.env.production up -d --force-recreate web`.

Set the signing key and push credentials. Verify `APP_MIN_VERSION`, `APP_LATEST_VERSION`, support URLs and the CFD engine settings. Download/update routes are public; they contain signed executable artifacts, never account data. A maintenance gate may still stop update requests during a planned outage.

## Full release

### First website-only release

Version 0.1.1 (Android versionCode 2) is prepared for the first public website APK.
The owner runs `scripts/setup-direct-release.sh` locally to create or resume the
publisher signing setup. It prompts for a password, keeps the PKCS12 keystore and
encrypted OTA private key under `~/.indianxtrade/keys`, copies only the public OTA
certificate into the repo, and writes the direct-signing credentials to GitHub
Secrets. Back up the keys folder and its password before publishing. The setup
does not publish an APK or start a release.

Commit the public certificate through a PR. The `publish website Android app`
workflow can then be dispatched on `main` with version `0.1.1` and mode `build`.
Install and test that signed candidate, then dispatch mode `publish` to activate
the exact existing bytes without rebuilding them. The workflow uses
`APP_RELEASE_VARIANT=direct` and requires no Play upload key. If no direct Firebase
configuration is provided, the website APK supports email login and disables
Google login; Firebase push delivery is unavailable until configured. Existing
full Play/direct and OTA release paths continue to require their Firebase files.

The website workflow verifies signing and the server-side checksum before
setting `APP_LATEST_VERSION`, recreates web through GitHub Actions, then downloads
the public APK and verifies its bytes and checksum endpoint. It preserves
`APP_MIN_VERSION`. Published version URLs cannot be overwritten with different
bytes; publish a new version for a changed APK. Private OTA key/server setup is
still required before publishing any OTA updates.

1. Bump `apps/mobile/package.json` and `apps/mobile/app.config.ts` `version` together; increment `android.versionCode`. Any native dependency or plugin change requires a full build and a new app version.
2. Check release blockers: CFD app/server compatibility, native Hindi review, physical-phone tests, Firebase/OAuth configuration, real signing identities and the OTA public certificate.
3. Commit and tag `app-v<version>`. The GitHub `mobile release` workflow tests, prebuilds and signs both variants, then uploads the direct APK/checksum to the VPS and attaches both APK and Play AAB to the GitHub release. It never changes latest/minimum version settings.
4. Verify APK signatures with Android `apksigner verify --print-certs`; compare the signing-certificate fingerprints to the owner backup. Install over the previous direct version on a test phone to verify upgrade continuity. Download `/download/app/<version>` and compare its SHA-256 checksum with `/download/app/<version>/checksum`.
5. Upload the AAB manually in Play Console: internal testing, closed testing, then production only after approval. Complete the Financial features declaration truthfully. Record the review outcome below.
6. After real-phone testing, set `APP_LATEST_VERSION=<version>` and recreate web. Set `APP_PLAY_LIVE=true` only after the store listing is actually live and `APP_PLAY_URL` is correct. Until then the website uses `/download/app`.

The optional `/download/app?help=1` page explains installation and links the current checksum. Android users should turn off their browser's unknown-app installation permission after installing.

## Forcing an update

Set `APP_MIN_VERSION` and recreate web. Older native apps show Update required on their next gated API call. Config and OTA endpoints remain exempt from the minimum-version gate so a fix remains reachable. Confirm the direct download and Play URLs are usable before increasing the minimum.

## OTA updates

Only JS/assets compatible with an existing native build belong in OTA. Tags are `app-ota-v<version>` and must match the installed app version; each version tag can be pushed once, so repeat publishes for the same native version use the local fallback. Do not force-move a published tag.

The export runs separately for Play and direct. Runtime identifiers are `<version>-play` and `<version>-direct`; this intentionally differs from the old plan's shared appVersion runtime, because `extra.variant` and native configuration differ. Never copy one variant's export into the other runtime. Publishing stages hidden folders and renames them atomically after every asset/config/metadata file and the `READY` marker is uploaded. Partially uploaded releases are never selected. Assets at a published URL are immutable.

Verify on a signed release build: change a visible test string, publish to a test deployment, launch twice and verify the change. Also verify the signature with the committed public certificate and test a bad signature is refused. OTA starts on the embedded/cached bundle immediately; it does not hold app launch while downloading.

## Rollback

To withdraw a not-yet-installed OTA, remove its `READY` marker rather than deleting files. Keep published asset files for clients still downloading them.

**Already installed OTAs do not roll back merely by removing the newest directory.** Expo chooses cached updates by creation time. To roll back, check out the known-good JS revision, keep the same native app version/runtime, and publish that known-good export again with a new timestamp/ID via the local OTA script. Verify on a phone that already ran the faulty update. This follows Expo's update-selection rules: [Expo Updates v1](https://docs.expo.dev/technical-specs/expo-updates-1/). Do not replace bytes in an old published asset URL.

For a direct APK, latest-version rollback changes what new downloads receive; installed users need a newer signed versionCode containing the known-good code. Never promise a downgrade install over a newer Android build.

## Mac fallback

Set `APP_KEYS_DIR` (default `~/.indianxtrade/keys`), `APP_RELEASE_OUT_DIR` if a persistent output folder is desired, `APP_GOOGLE_WEB_CLIENT_ID`, `PLAY_STORE_PASSWORD`, `PLAY_KEY_ALIAS`, `PLAY_KEY_PASSWORD`, `DIRECT_STORE_PASSWORD`, `DIRECT_KEY_ALIAS`, `DIRECT_KEY_PASSWORD`. Optional overrides: `PLAY_KEYSTORE_PATH`, `DIRECT_KEYSTORE_PATH`, `PLAY_GOOGLE_SERVICES_JSON`, `DIRECT_GOOGLE_SERVICES_JSON`.

Run `scripts/app-release.sh build 0.1.0` or `scripts/app-release.sh ota 0.1.0`. By default the script only creates local output. To upload, explicitly set `APP_RELEASE_UPLOAD=1`, `VPS_HOST`, `VPS_USER`, and `VPS_SSH_KEY_FILE`; the host must already exist in `~/.ssh/known_hosts`. Credentials are passed as environment values, never interpolated into Gradle source. Release output includes paths in the final line. Keep OTA signing private material on the server, never in exported files.

## Play review log

| Date | Version | Track | Outcome |
| --- | --- | --- | --- |
| Pending | — | — | Owner account, signing/Firebase setup and first real-device release validation required |

## Device acceptance still required

On a real iPhone (iOS 16.4+), install from Safari, enable notifications in the installed app and verify a payment notification opens History. On both physical Android phones, cold-start repeatedly, sign in, verify PIN/biometric return, payment intents and CFD open/close results, receive notifications while away and test update + rollback. These require owner accounts/devices and are not replaced by unit tests.
