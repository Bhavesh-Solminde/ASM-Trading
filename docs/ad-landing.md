# Instagram and Facebook ad landing page

Use `https://indianxtrade.com/start` as the ad destination after deploying this change. Every **Get started** button opens `/register` directly in the same tab.

Optional campaign URL:

```
https://indianxtrade.com/start?utm_source=instagram&utm_medium=paid_social&utm_campaign=demo_intro
```

The destination preserves the `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id` and `fbclid` query parameters. Unknown, repeated and oversized values are discarded. The ad landing origin is remembered for the current browser tab when browser storage is available. It survives the Google sign-in round trip in that tab. This is browser attribution, not a durable backend attribution record.

## Activate measurement

The supplied Pixel ID is `1176260014975763`. It is configured in `apps/web/.env.local` for this preview and in `.env.production.example` for deployment. Set `META_PIXEL_ID="1176260014975763"` in the deployed service’s `.env.production`, then restart/recreate the web service. Set it empty to disable tracking in an environment. No new tracking provider, secret or package is needed.

| Event | When it fires | Context |
| --- | --- | --- |
| `PageView` (standard) | Public entry page loads, including `/start` | Filter by `/start` URL to count landing views |
| `GetStarted` (custom) | A Get started link is clicked | `source=ad_landing`; `placement=header`, `hero` or `closing` |
| `CompleteRegistration` (existing standard event) | Email or Google signup completes | Existing signup integration |
| `Login` (custom) | Email login succeeds or an existing user completes Google login | `method=email` or `google`; `source=ad_landing` or `website` |

A failed login or a click on the login button alone does not fire `Login`. Google login uses a short-lived server-issued receipt and suppresses repeat events for the same receipt in a browser tab. Trading, balances, deposits, identity documents and withdrawals are not added to the Pixel integration. Custom event parameters do not include email, password, user ID, balance or trading activity.

## Verify before running ads

1. Deploy with your Pixel ID configured.
2. Open Meta Events Manager → your data source → Test events, and open `/start` with test UTM parameters.
3. Confirm a `PageView` on `/start` and a `GetStarted` event after clicking the button. Check that the registration URL retains your campaign parameters.
4. Complete a successful email login and confirm `Login` with `method=email` and `source=ad_landing`. Repeat with an existing Google account; a new Google account should produce the existing `CompleteRegistration` instead.
5. Try an incorrect password and confirm no `Login` event. In Events Manager, create custom conversions for `GetStarted` and `Login` if you want those as Ads Manager reporting columns. Filter `Login` by `source=ad_landing` when evaluating this funnel.

These are browser events, not an exact count of unique people. Browser tracking restrictions, blocked scripts and disabled storage can affect measurement. Live delivery to your Meta account must be checked in Test events; the automated tests use a local Pixel stub and do not transmit test activity to Meta.
