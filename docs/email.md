# Transactional email (Resend)

All mail goes through `@asm/mail` (`packages/mail`): `sendEmail` posts to Resend's HTTP API, templates are pure functions in `src/templates`.

## Emails and triggers

| Email | Trigger | Where | Idempotency key |
|---|---|---|---|
| Welcome | Signup (email or Google) | `api/auth/register`, `api/auth/google/callback` | `welcome/<userId>` |
| Password reset link | "Forgot password" form | `api/auth/password-reset/request` | `password-reset/<tokenId>` |
| Password changed | Successful reset | `api/auth/password-reset/confirm` | `password-changed/<userId>/<ms>` |
| Deposit credited | Any path that credits a deposit (admin, SMS matcher, chain matcher, Tatum gateway) | `creditDepositToAccount` in `packages/db` (web **and** engine) | `deposit-credited/<depositId>` |
| Withdrawal requested | User submits a withdrawal | `api/withdrawals` POST | `withdrawal-requested/<id>` |
| Withdrawal paid + certificate | Admin clicks **Mark paid** | admin withdrawals actions → `lib/withdrawal-mail.ts` | `withdrawal-paid/<id>` |
| Withdrawal rejected | Admin clicks **Reject & refund** | same | `withdrawal-rejected/<id>` |

A send never blocks or fails the action that triggered it. Failures are logged as `mail.failed` / `mail.error`; skips as `mail.skipped` (no key, test run, or a reserved test address such as `@asmtrade.local`).

## Env

`RESEND_API_KEY`, `RESEND_FROM` (on a verified domain), `RESEND_REPLY_TO`. Needed by **web and engine**.

## One-time Resend setup

1. Resend dashboard → Domains → Add `indianxtrade.com`.
2. Add every DNS record Resend shows: DKIM `TXT` (`resend._domainkey`), the sending `CNAME`s (`send`, `rsend`) and DMARC `TXT` (`_dmarc`). On Cloudflare set the CNAMEs to DNS only (grey cloud). Click Verify and wait for **Verified**.
3. API Keys → create a key with **Sending access**.
4. `RESEND_FROM="IndianxTrade <no-reply@indianxtrade.com>"`.

Until the domain is verified, only `onboarding@resend.dev` works and it delivers only to the Resend account owner's inbox.

## Check it locally

Put the vars in the root `.env`, then:

    pnpm --filter @asm/mail samples -- you@yourdomain.com

Each line prints `{"ok":true,"id":"…"}` on success. A `403` means the from-domain isn't verified. A `422` usually means a malformed `RESEND_FROM`.

## Production

Add the vars to `/opt/asmtrader/.env.production` **before** merging the deploy, then recreate both services so they re-read env:

    docker compose --env-file ../.env.production up -d --force-recreate --no-deps web engine

Verify with `docker compose logs web engine | grep '"evt":"mail.'`.
