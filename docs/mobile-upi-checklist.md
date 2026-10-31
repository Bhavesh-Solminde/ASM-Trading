# UPI app hand-off — manual release check

Run before every release that touches deposits. Use a real Android phone with
PhonePe, Google Pay and Paytm installed, the production API, and each VPA in
`UPI_COLLECTION_VPAS`.

| VPA | App | Opens with amount filled? | Payment allowed? | Credited? | Notes |
|---|---|---|---|---|---|
| | PhonePe | | | | |
| | Google Pay | | | | |
| | Paytm | | | | |
| | Any UPI (chooser) | | | | |

If an app shows "payment declined for security reasons" or caps the amount
(common for personal/P2P VPAs), record it. Release is allowed only if at least
the QR + copy path works for every VPA; consider hiding that app's button by
adding it to `UPI_APP_BLOCKLIST` (app config) if it fails for all VPAs.

## Hiding an app without a release

`UPI_APP_BLOCKLIST` is read per request by the web app and served in
`/api/v1/app/config`; the app hides the named apps' "Open <App>" buttons the
next time it loads the config (cached for about 5 minutes). The QR code, the
UPI ID copy and the system chooser stay, so a deposit can still be paid.

1. Set `UPI_APP_BLOCKLIST=gpay,paytm` (names: `phonepe`, `gpay`, `paytm`,
   comma-separated; anything else is ignored) in the production env.
2. Force-recreate the `web` container (an env edit needs it).
3. Check `curl https://indianxtrade.com/api/v1/app/config` shows
   `"upiAppBlocklist":["gpay","paytm"]`, then reopen a deposit in the app.

Clear the variable to bring the app back. Older app builds ignore the list and
keep showing every button.
