# Mobile push notifications

Implemented in mobile Plan 4. Deploy the handwritten push-notification migration before starting the web or engine images. The Docker image includes `@asm/notify`; both services inherit the environment from Compose. Never put credentials in source control.

## Transport setup

For Android, create the Firebase project and register both Android package IDs (`com.indianxtrade.app` and `com.indianxtrade.app.direct`). Download each `google-services.json` and supply its path through `GOOGLE_SERVICES_JSON` during that variant's native build. Configure `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` on the engine; the private key accepts escaped newline characters. The app uses native FCM tokens, not the Expo push relay. A native rebuild is required after adding Firebase configuration.

For browser push, generate VAPID keys, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a real operator contact). The public key route returns null until configured. Plan 5 supplies the browser subscription UI and service worker. Supported subscription endpoints are the production Google, Mozilla, Apple, and Windows push services; arbitrary outbound endpoints, credentials, and nonstandard ports are refused.

Missing transport credentials log once at engine startup. Events for users with devices on an unconfigured transport stay pending without consuming their retry budget. No transport configuration is invented or deployed by this change.

## Delivery rules

Payment and KYC transitions enqueue inside the same transaction as the transition, audit, and money changes. Reversed deposits never notify. The engine claims up to 50 rows every two seconds with a 60-second lease and unique claim token. A replaced worker cannot acknowledge a newer claim. Sends run concurrently and transport network calls are bounded; retries stop after five delivery attempts. Sent events are retained for 30 days. Delivery is at least once; a crash between delivery and acknowledgement can repeat a notification.

Trade results use one in-memory ten-second batch per user, only for LIVE accounts, never bots or users with an authenticated open socket. Presence is rechecked immediately before send. The existing CFD settlement event passes through the same decorator. Result amounts and their currency are reread in one DB snapshot, and unlike currencies are never added together. A restart can lose the last ten seconds of trade-result pushes; payment/KYC events persist in the outbox.

Device registration is authenticated, rate limited, and capped at twenty recent devices per user. Language updates update all device locales. Android text follows its device locale; browser text stays English. Native permission is requested after a LIVE settlement or created deposit, never on launch. Notification taps wait behind the app gate and only open History/receipts or identity verification. Registration and sign-out use captured sessions, with cleanup ordered before remote session revocation.

## Release checks requiring configured devices

- Supply Firebase credentials and both variant configurations, then rebuild native apps.
- Android 13+: launch without a permission prompt, complete a deposit or LIVE CFD trade, and accept permission. Verify a notification while the app is backgrounded.
- Deny permission, then enable it from Account → Notifications/system settings; mute each category and confirm delivery stops.
- Switch English/Hindi and verify Android notification text, then sign out/switch accounts and confirm the departed account sends no further notifications to that device.
- Lock the app and tap a deposit/withdrawal notification; unlock and confirm the correct History receipt. Verify a KYC tap opens verification.
- On an installed iOS 16.4+ PWA, enable Web Push and verify delivery and tap navigation (Plan 5).
- A native Hindi speaker must review the added Hindi notification text before release.

Automated checks use only the isolated local database `asm_codex_p4_test`; no production migrations, pushes, or release builds were performed.
