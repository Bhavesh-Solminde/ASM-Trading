# Resend Transactional Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send seven transactional emails through Resend: welcome, password-reset link, password-changed notice, deposit credited, withdrawal requested, withdrawal paid (with the reward certificate) and withdrawal rejected. Also make "Forgot password?" a working self-service flow.

**Architecture:** A new workspace package `@asm/mail` holds the Resend sender (raw HTTP API, no SDK) and every email template. Templates are pure string functions behind a client-safe `@asm/mail/templates` entry, because the in-app certificate renders in the browser. Deposits are credited from six code paths across two processes (web and engine). So the deposit email is sent from the single choke point `creditDepositToAccount` in `@asm/db`, after its transaction commits. Withdrawal, reset and welcome emails are sent from the web route or admin action that causes them. A send never blocks or fails the business action. Each email carries a Resend idempotency key, so a retry or re-run never sends it twice.

**Tech Stack:** Resend HTTP API (`POST https://api.resend.com/emails`), Next.js 16 route handlers and server actions, Prisma 7 (Postgres), Zod 4, Vitest 5, pnpm workspaces, tsx (engine runtime).

## Decisions (user, 2026-10-10)

| Topic | Decision |
|---|---|
| Withdrawal emails | "Request received" email at request time. **Certificate email when the admin clicks Mark paid.** Rejection email (with the preset reason and "money is back in your balance") when the admin rejects. |
| Forgot password | **Email link**: valid 30 min, single use. Opens a "Set new password" page. A successful reset signs the user out on every device. |
| Deposit email | Sent once, when money is credited to LIVE. Shows **amount + bonus added + total to trade with**. Uses the word "Bonus" and never mentions wagering. |
| Extras | **Welcome email on signup** (email/password and Google). 2FA-code email and PDF certificate: **not** in scope. |

## Global Constraints

- Brand name is exactly `IndianxTrade` (never "Indianx Trade" / "ASM Trade"). Email palette: background `#000000`, card `#05070b`, rule `#232a34`, ink `#f4f7fb`, ink-2 `#98a2b3`, ink-3 `#5a6472`, brand blue `#2f81f7`, wordmark gold `#ffb000`.
- No Resend SDK. Use the HTTP API via `fetch`, as `apps/web/src/lib/mail.ts` does today.
- Sending is gated on `RESEND_API_KEY`. When it is unset the app behaves exactly as before and sends are logged as `mail.skipped`.
- A mail failure never fails, delays or rolls back a deposit, withdrawal, signup or password reset.
- Tests never reach Resend. `sendEmail` skips when `process.env.VITEST` is set, and for reserved test domains (`.local`, `.test`, `.invalid`, `.example`, `.localhost`, `example.com/net/org`).
- Bonus copy follows the marketing posture: say "Bonus", never mention wagering, turnover or "non-withdrawable".
- User-facing dates use the `Asia/Kolkata` timezone. Money labels come from `formatMoney` in `@asm/db`.
- Migrations are hand-written SQL, because `schema.prisma` has known drift. Never run `prisma format` or `prisma migrate dev`. Apply migrations with `prisma migrate deploy` on an isolated DB.
- Tests that touch the DB run serially (`fileParallelism: false`, already set). In a worktree, export `DATABASE_URL`/`DIRECT_URL`/`REDIS_URL`/`SESSION_SECRET` pointing at an isolated local DB (see "Test environment" below). Never run the tests against the shared Supabase dev DB.
- Work on a new branch from `origin/main`: `git fetch origin && git switch -c claude/resend-email origin/main`.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Test environment (read once before Task 1)

Create a throwaway local DB and point every test command at it:

```bash
createdb -h localhost -p 5433 -U solminde asm_mail
```

```bash
export DATABASE_URL="postgresql://solminde@localhost:5433/asm_mail?schema=public" DIRECT_URL="postgresql://solminde@localhost:5433/asm_mail?schema=public" REDIS_URL="redis://localhost:6379" SESSION_SECRET="local-test-secret-at-least-32-characters-long"
```

```bash
cd packages/db && npx prisma migrate deploy
```

`DIRECT_URL` wins in `prisma.config.ts`, so both URLs must point at `asm_mail`. Re-run `migrate deploy` after Task 6 adds the new migration.

## File map

**New package `packages/mail/`**
- `package.json`, `tsconfig.json`, `vitest.config.ts`: package scaffolding. `exports` has `"."` (server: sender + notify) and `"./templates"` (pure, client-safe).
- `src/send.ts`: `sendEmail()`, the Resend HTTP client with idempotency key, one retry, reply-to and tags. Moved from `apps/web/src/lib/mail.ts`.
- `src/notify.ts`: one `sendXxxEmail()` per email. It renders the template, sets the idempotency key and tag, and calls `sendEmail`.
- `src/index.ts`: server entry. Re-exports `send` and `notify`.
- `src/templates/layout.ts`: `escapeHtml`, `siteUrl`, `emailLayout`, `p`, `muted`, `details`, `linkLine`, `RenderedEmail`, `SUPPORT_EMAIL`.
- `src/templates/format.ts`: `formatDateLabel`, `formatDateTimeLabel`, `shortRef`, `payToLabel`.
- `src/templates/name.ts`: `displayName()`. Moved from `certificateName` in `apps/web/src/lib/certificate.ts`.
- `src/templates/certificate.ts`: `certificateHtml(data, stage)`. Moved from `apps/web/src/lib/certificate.ts`.
- `src/templates/welcome.ts`, `password.ts`, `deposit.ts`, `withdrawal.ts`: one template module per feature.
- `src/templates/index.ts`: client-safe entry.
- `scripts/send-samples.ts`: sends every template to one inbox, for checking with real envs.
- Tests: `src/send.test.ts`, `src/notify.test.ts`, `src/templates/templates.test.ts`.

**Modified**
- `packages/db/prisma/schema.prisma`, plus new migration `20261010120000_password_reset_tokens`: `PasswordResetToken` model.
- `packages/db/src/repositories/password-reset.ts` (new, plus test): issue and spend reset tokens.
- `packages/db/src/repositories/deposit.ts`: deposit-credited email after commit (plus new `deposit-email.test.ts`).
- `packages/db/src/repositories/withdrawal.ts`: `getWithdrawalNotice()`.
- `packages/db/src/index.ts`, `packages/db/package.json`: exports and the `@asm/mail` dependency.
- `packages/contracts/src/auth.ts` (plus test): `PasswordResetRequestSchema`, `PasswordResetConfirmSchema`.
- `apps/web/src/app/api/auth/password-reset/request/route.ts`, `.../confirm/route.ts` (new, plus `flow.test.ts`).
- `apps/web/src/app/(auth)/forgot-password/*`, `apps/web/src/app/(auth)/reset-password/*` (new pages).
- `apps/web/src/components/auth/PasswordInput.tsx` (real link), `Spinner.tsx` (new), `apps/web/src/app/(auth)/login/*` (post-reset notice).
- `apps/web/src/app/api/withdrawals/route.ts`, `apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx`: request email and copy.
- `apps/web/src/app/admin/(console)/withdrawals/actions.ts`, plus new `apps/web/src/lib/withdrawal-mail.ts` (and test): paid and rejected emails.
- `apps/web/src/app/api/auth/register/route.ts` (plus new test), `apps/web/src/app/api/auth/google/callback/route.ts`: welcome email.
- `apps/web/src/app/robots.ts`, `apps/web/next.config.ts`, `apps/web/package.json`, `deploy/Dockerfile`, `.env.example`, new `docs/email.md`.
- Deleted: `apps/web/src/lib/mail.ts`, `apps/web/src/lib/certificate.ts`, `apps/web/src/lib/certificate.test.ts` (moved into `@asm/mail`).

---

### Task 1: `@asm/mail` package with the Resend sender

**Files:**
- Create: `packages/mail/package.json`, `packages/mail/tsconfig.json`, `packages/mail/vitest.config.ts`, `packages/mail/src/send.ts`, `packages/mail/src/index.ts`, `packages/mail/src/templates/index.ts` (empty placeholder export for now, filled in Task 2)
- Test: `packages/mail/src/send.test.ts`
- Modify: `packages/db/package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `deploy/Dockerfile`, `apps/web/src/app/api/withdrawals/route.ts:17`
- Delete: `apps/web/src/lib/mail.ts`

**Interfaces:**
- Produces: `sendEmail(msg: EmailMessage, deps?: SendDeps): Promise<SendResult>`; `isDeliverableAddress(email: string): boolean`; types `EmailMessage { to; subject; html; idempotencyKey?; tag?; cid? }`, `SendResult`, `SendDeps { fetch; env; sleep }`.

- [ ] **Step 1: Scaffold the package**

`packages/mail/package.json`:

```json
{
  "name": "@asm/mail",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./templates": "./src/templates/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "samples": "dotenv -e ../../.env -- tsx scripts/send-samples.ts"
  },
  "dependencies": {
    "@asm/logger": "workspace:*"
  },
  "devDependencies": {
    "dotenv-cli": "10.0.0",
    "tsx": "4.20.6"
  }
}
```

`packages/mail/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
```

`packages/mail/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

// Pure unit tests: fetch is faked and the logger is mocked, so no .env is read.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

`packages/mail/src/templates/index.ts` (temporary, replaced in Task 2):

```ts
export {};
```

- [ ] **Step 2: Write the failing sender tests**

`packages/mail/src/send.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@asm/logger", () => ({ childLogger: () => ({ info: () => {}, warn: () => {} }) }));

import { isDeliverableAddress, sendEmail, type SendDeps } from "./send";

const LIVE_ENV = {
  RESEND_API_KEY: "re_test_key",
  RESEND_FROM: "IndianxTrade <no-reply@indianxtrade.com>",
  RESEND_REPLY_TO: "support@indianxtrade.com",
};
const MSG = { to: "asha@gmail.com", subject: "Hello", html: "<p>Hello</p>" };

function setup(responses: Array<Response | Error>, env: Record<string, string | undefined> = LIVE_ENV) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: SendDeps = { fetch: fetchMock as unknown as typeof fetch, env, sleep: async () => {} };
  return { fetchMock, deps };
}

const ok = () => new Response(JSON.stringify({ id: "em_123" }), { status: 200 });

describe("isDeliverableAddress", () => {
  it("accepts a real mailbox", () => {
    expect(isDeliverableAddress("asha@gmail.com")).toBe(true);
  });
  it("rejects seed and test domains", () => {
    expect(isDeliverableAddress("test1@asmtrade.local")).toBe(false);
    expect(isDeliverableAddress("a@test.local")).toBe(false);
    expect(isDeliverableAddress("a@example.com")).toBe(false);
    expect(isDeliverableAddress("a@foo.test")).toBe(false);
    expect(isDeliverableAddress("not-an-email")).toBe(false);
  });
});

describe("sendEmail", () => {
  it("never sends under vitest, even with a key", async () => {
    const { fetchMock, deps } = setup([ok()], { ...LIVE_ENV, VITEST: "true" });
    expect(await sendEmail(MSG, deps)).toEqual({ ok: false, skipped: true, reason: "test_env" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when RESEND_API_KEY is unset", async () => {
    const { fetchMock, deps } = setup([ok()], {});
    expect(await sendEmail(MSG, deps)).toEqual({ ok: false, skipped: true, reason: "no_api_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips a reserved test address", async () => {
    const { fetchMock, deps } = setup([ok()]);
    const result = await sendEmail({ ...MSG, to: "test1@asmtrade.local" }, deps);
    expect(result).toEqual({ ok: false, skipped: true, reason: "undeliverable_address" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts from, to, reply_to, tag and the idempotency key", async () => {
    const { fetchMock, deps } = setup([ok()]);
    const result = await sendEmail({ ...MSG, idempotencyKey: "deposit-credited/abc", tag: "deposit_credited" }, deps);
    expect(result).toEqual({ ok: true, id: "em_123" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("deposit-credited/abc");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "IndianxTrade <no-reply@indianxtrade.com>",
      to: ["asha@gmail.com"],
      subject: "Hello",
      html: "<p>Hello</p>",
      reply_to: "support@indianxtrade.com",
      tags: [{ name: "category", value: "deposit_credited" }],
    });
  });

  it("falls back to Resend's sandbox sender when RESEND_FROM is unset", async () => {
    const { fetchMock, deps } = setup([ok()], { RESEND_API_KEY: "re_test_key" });
    await sendEmail(MSG, deps);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body)).from).toBe("IndianxTrade <onboarding@resend.dev>");
  });

  it("does not retry a 4xx rejection", async () => {
    const { fetchMock, deps } = setup([new Response("invalid from", { status: 422 }), ok()]);
    const result = await sendEmail({ ...MSG, idempotencyKey: "k" }, deps);
    expect(result).toEqual({ ok: false, skipped: false, error: "invalid from" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx once when an idempotency key makes it safe", async () => {
    const { fetchMock, deps } = setup([new Response("busy", { status: 503 }), ok()]);
    expect(await sendEmail({ ...MSG, idempotencyKey: "k" }, deps)).toEqual({ ok: true, id: "em_123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry without an idempotency key", async () => {
    const { fetchMock, deps } = setup([new Response("busy", { status: 503 }), ok()]);
    expect((await sendEmail(MSG, deps)).ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a network failure without throwing", async () => {
    const { deps } = setup([new Error("ECONNRESET"), new Error("ECONNRESET")]);
    expect(await sendEmail({ ...MSG, idempotencyKey: "k" }, deps)).toEqual({ ok: false, skipped: false, error: "network" });
  });
});
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `pnpm install && pnpm --filter @asm/mail test`
Expected: FAIL with `Failed to resolve import "./send"`.

- [ ] **Step 4: Implement the sender**

`packages/mail/src/send.ts`:

```ts
import { childLogger } from "@asm/logger";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Resend's sandbox sender: it only delivers to the Resend account owner's own
// address. Production sets RESEND_FROM to a sender on the verified domain.
const DEFAULT_FROM = "IndianxTrade <onboarding@resend.dev>";
const RETRY_DELAY_MS = 1_500;

export type SkipReason = "test_env" | "no_api_key" | "undeliverable_address";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: SkipReason }
  | { ok: false; skipped: false; error: string };

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /**
   * Resend drops a repeat send with the same key for 24h, so a re-run trigger
   * never emails twice. It is also what makes our own retry safe.
   */
  idempotencyKey?: string | undefined;
  /** ASCII category shown in the Resend dashboard, e.g. "deposit_credited". */
  tag?: string | undefined;
  cid?: string | undefined;
}

export interface SendDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: SendDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  env: process.env,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Seed and test users live on reserved domains (@asmtrade.local, @test.local).
// Mail to them can only bounce, and bounces hurt the sender reputation.
const RESERVED_DOMAIN = /(\.(local|test|invalid|example|localhost)$)|((^|\.)example\.(com|net|org)$)/i;

export function isDeliverableAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !RESERVED_DOMAIN.test(domain);
}

/**
 * Sends one email through Resend's HTTP API. Never throws: every outcome comes
 * back as a SendResult, so mail being down can't fail a deposit, withdrawal or
 * signup. Skips (does not fail) under vitest, without RESEND_API_KEY, or for a
 * reserved test address.
 */
export async function sendEmail(msg: EmailMessage, deps: SendDeps = defaultDeps): Promise<SendResult> {
  const log = childLogger(msg.cid ?? "mail");
  const tag = msg.tag ?? "untagged";
  const { env } = deps;

  // vitest sets VITEST. Many db/web tests credit deposits and create
  // withdrawals; none of them may reach Resend, even with a key in .env.
  if (env.VITEST) return { ok: false, skipped: true, reason: "test_env" };

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    log.info({ evt: "mail.skipped", reason: "no_api_key", tag }, "email not sent: RESEND_API_KEY unset");
    return { ok: false, skipped: true, reason: "no_api_key" };
  }
  if (!isDeliverableAddress(msg.to)) {
    log.info({ evt: "mail.skipped", reason: "undeliverable_address", tag }, "email not sent: reserved test address");
    return { ok: false, skipped: true, reason: "undeliverable_address" };
  }

  const replyTo = env.RESEND_REPLY_TO;
  const body = JSON.stringify({
    from: env.RESEND_FROM || DEFAULT_FROM,
    to: [msg.to],
    subject: msg.subject,
    html: msg.html,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(msg.tag ? { tags: [{ name: "category", value: msg.tag }] } : {}),
  });
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
  };

  // One retry for a transient failure (429, 5xx, network), and only with an
  // idempotency key, which guarantees the retry can't double-send.
  const attempts = msg.idempotencyKey ? 2 : 1;
  let lastError = "unknown";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await deps.fetch(RESEND_ENDPOINT, { method: "POST", headers, body });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        log.info({ evt: "mail.sent", tag, id: data.id }, "email sent");
        return { ok: true, id: data.id ?? null };
      }
      lastError = (await res.text().catch(() => "")) || `HTTP ${res.status}`;
      log.warn({ evt: "mail.failed", tag, status: res.status, attempt }, "resend rejected the message");
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = "network";
      log.warn({ evt: "mail.error", tag, attempt, err: String(err) }, "could not reach resend");
    }
    if (attempt < attempts) await deps.sleep(RETRY_DELAY_MS);
  }
  return { ok: false, skipped: false, error: lastError };
}
```

`packages/mail/src/index.ts`:

```ts
export { isDeliverableAddress, sendEmail } from "./send";
export type { EmailMessage, SendDeps, SendResult, SkipReason } from "./send";
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `pnpm --filter @asm/mail test`
Expected: PASS (11 tests).

- [ ] **Step 6: Wire the package into web, db and the Docker image**

`packages/db/package.json`: add `"@asm/mail": "workspace:*",` to `dependencies` (alphabetical, after `"@asm/logger"`).

`apps/web/package.json`: add `"@asm/mail": "workspace:*",` to `dependencies` after `"@asm/logger"`.

`apps/web/next.config.ts`: change the `transpilePackages` line to:

```ts
  transpilePackages: ["@asm/db", "@asm/config", "@asm/logger", "@asm/mail", "@asm/contracts", "@asm/trading", "@asm/tatum"],
```

`deploy/Dockerfile`, in the `deps` stage, after `COPY packages/logger/package.json ./packages/logger/`:

```dockerfile
COPY packages/mail/package.json ./packages/mail/
```

`apps/web/src/app/api/withdrawals/route.ts:17`: replace `import { sendEmail } from "@/lib/mail";` with:

```ts
import { sendEmail } from "@asm/mail";
```

Delete `apps/web/src/lib/mail.ts`:

```bash
git rm apps/web/src/lib/mail.ts
```

Then run `pnpm install` (updates `pnpm-lock.yaml` with the new workspace links).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @asm/mail exec tsc --noEmit && pnpm --filter @asm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/mail packages/db/package.json apps/web/package.json apps/web/next.config.ts deploy/Dockerfile apps/web/src/app/api/withdrawals/route.ts pnpm-lock.yaml
git commit -m "feat(mail): @asm/mail package — Resend sender with idempotency key, retry and test guards"
```

---

### Task 2: Template foundation + move the certificate into `@asm/mail`

**Files:**
- Create: `packages/mail/src/templates/layout.ts`, `format.ts`, `name.ts`, `certificate.ts`
- Modify: `packages/mail/src/templates/index.ts`, `apps/web/src/app/api/withdrawals/route.ts:16,76`, `apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx:16`
- Delete: `apps/web/src/lib/certificate.ts`, `apps/web/src/lib/certificate.test.ts`
- Test: `packages/mail/src/templates/templates.test.ts`

**Interfaces:**
- Produces (all from `@asm/mail/templates`): `escapeHtml(s)`, `siteUrl(path?)`, `SUPPORT_EMAIL`, `RenderedEmail { subject; html }`, `emailLayout({ preheader, heading, bodyHtml, cta?, afterCtaHtml? })`, `p(text)`, `muted(text)`, `details(rows: EmailDetail[])`, `linkLine(url)`, `formatDateLabel(d)`, `formatDateTimeLabel(d)`, `shortRef(id)`, `payToLabel(method, destination)`, `displayName(profile)`, `certificateHtml(data, stage?)`, types `CertificateData`, `CertificateStage`, `EmailDetail`.

- [ ] **Step 1: Write the failing template tests**

`packages/mail/src/templates/templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  certificateHtml,
  details,
  displayName,
  emailLayout,
  escapeHtml,
  formatDateLabel,
  formatDateTimeLabel,
  payToLabel,
  shortRef,
} from "./index";

describe("escapeHtml", () => {
  it("escapes markup and quotes", () => {
    expect(escapeHtml(`<a href="x">'</a>&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;&amp;");
  });
});

describe("emailLayout", () => {
  it("renders the wordmark, heading, body and button", () => {
    const html = emailLayout({
      preheader: "Preview line",
      heading: "Deposit credited",
      bodyHtml: "<p>Body</p>",
      cta: { label: "Start trading", url: "https://indianxtrade.com/trade" },
    });
    expect(html).toContain("INDIANXTRADE");
    expect(html).toContain("Deposit credited");
    expect(html).toContain("Preview line");
    expect(html).toContain('href="https://indianxtrade.com/trade"');
    expect(html).toContain("support@indianxtrade.com");
  });

  it("drops a button whose link is not http(s)", () => {
    const html = emailLayout({ preheader: "x", heading: "x", bodyHtml: "", cta: { label: "Go", url: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
  });
});

describe("details", () => {
  it("escapes labels and values", () => {
    const html = details([{ label: "Name", value: "<b>Asha</b>" }]);
    expect(html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
  });
});

describe("format helpers", () => {
  it("formats dates in IST, not UTC", () => {
    // 20:00 UTC on 10 Oct is 01:30 IST on 11 Oct.
    const d = new Date("2026-10-10T20:00:00Z");
    expect(formatDateLabel(d)).toBe("11 Oct 2026");
    expect(formatDateTimeLabel(d)).toBe("11 Oct 2026, 01:30 IST");
  });

  it("shortens a uuid to an 8-character reference", () => {
    expect(shortRef("8f3a21c9-1111-2222-3333-444455556666")).toBe("8F3A21C9");
  });

  it("labels the payout destination", () => {
    expect(payToLabel("UPI", "asha@okhdfc")).toBe("UPI · asha@okhdfc");
    expect(payToLabel("BANK", "HDFC0001234 ••6789")).toBe("Bank account · HDFC0001234 ••6789");
    expect(payToLabel("USDT", null)).toBe("USDT");
  });
});

describe("displayName", () => {
  it("prefers the full name", () => {
    expect(displayName({ firstName: "Rashmi", lastName: "Swain", nickname: "rx", email: "r@x.com" })).toBe("Rashmi Swain");
  });
  it("falls back to the nickname", () => {
    expect(displayName({ firstName: null, lastName: null, nickname: "AceTrader", email: "r@x.com" })).toBe("AceTrader");
  });
  it("falls back to the email local part", () => {
    expect(displayName({ firstName: null, lastName: null, nickname: null, email: "neo@x.com" })).toBe("neo");
  });
});

describe("certificateHtml", () => {
  const data = { name: "Rashmi Swain", amountLabel: "₹500.00", dateLabel: "25 Sept 2026", refId: "8F3A21C9" };

  it("embeds the name, amount, date and reference", () => {
    const html = certificateHtml(data);
    for (const s of ["Rashmi Swain", "₹500.00", "25 Sept 2026", "8F3A21C9", "Proudly presented to"]) {
      expect(html).toContain(s);
    }
  });

  it("escapes HTML in the name", () => {
    const html = certificateHtml({ ...data, name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("words the note for a request vs. a paid withdrawal", () => {
    expect(certificateHtml(data)).toContain("confirms a withdrawal request");
    expect(certificateHtml(data, "paid")).toContain("paid out by IndianxTrade");
    expect(certificateHtml(data)).not.toContain("original deposit method");
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `pnpm --filter @asm/mail test`
Expected: FAIL, `certificateHtml` (and others) not exported from `./index`.

- [ ] **Step 3: Implement the foundation**

`packages/mail/src/templates/layout.ts`:

```ts
/**
 * Shared email chrome. Every template is a pure string function so this entry
 * stays client-safe (the in-app certificate renders in the browser). Styles are
 * inline and table-based because email clients strip <style> and flexbox.
 */

export const SUPPORT_EMAIL = "support@indianxtrade.com";

const C = {
  bg: "#000000",
  card: "#05070b",
  rule: "#232a34",
  ink: "#f4f7fb",
  ink2: "#98a2b3",
  ink3: "#5a6472",
  brand: "#2f81f7",
  gold: "#ffb000",
} as const;

export interface RenderedEmail {
  subject: string;
  html: string;
}

export interface EmailDetail {
  label: string;
  value: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Absolute link into the site. Same origin rule as apps/web/src/lib/site.ts. */
export function siteUrl(path = "/"): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://indianxtrade.com").replace(/\/$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

const isHttpUrl = (url: string) => /^https?:\/\//i.test(url);

export function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${C.ink};">${escapeHtml(text)}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:${C.ink2};">${escapeHtml(text)}</p>`;
}

/** A visible URL, for when the button is blocked or stripped. */
export function linkLine(url: string): string {
  if (!isHttpUrl(url)) return "";
  const safe = escapeHtml(url);
  return `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safe}" style="color:${C.brand};">${safe}</a></p>`;
}

export function details(rows: EmailDetail[]): string {
  const tr = rows
    .map(
      (r) =>
        `<tr><td style="padding:9px 0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${C.ink2};">${escapeHtml(r.label)}</td>` +
        `<td style="padding:9px 0;font-size:14px;font-weight:700;color:${C.ink};text-align:right;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule};">${tr}</table>`;
}

function button(cta: { label: string; url: string }): string {
  // Only http(s): a template must never emit a javascript: or data: link.
  if (!isHttpUrl(cta.url)) return "";
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr>` +
    `<td style="border-radius:999px;background:${C.brand};">` +
    `<a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:800;color:#ffffff;text-decoration:none;">${escapeHtml(cta.label)}</a>` +
    `</td></tr></table>`
  );
}

export function emailLayout(input: {
  /** Inbox preview line; hidden in the body. */
  preheader: string;
  heading: string;
  /** Already-safe HTML: build it from p()/muted()/details()/certificateHtml(). */
  bodyHtml: string;
  cta?: { label: string; url: string };
  /** Already-safe HTML shown under the button. */
  afterCtaHtml?: string;
}): string {
  const { preheader, heading, bodyHtml, cta, afterCtaHtml } = input;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.rule};border-radius:14px;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="height:4px;background:${C.brand};border-radius:14px 14px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 30px 4px;">
<div style="font-size:13px;font-weight:800;letter-spacing:3px;color:${C.gold};">INDIANXTRADE</div>
<h1 style="margin:18px 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff;">${escapeHtml(heading)}</h1>
</td></tr>
<tr><td style="padding:0 30px 22px;">${bodyHtml}${cta ? button(cta) : ""}${afterCtaHtml ?? ""}</td></tr>
<tr><td style="padding:16px 30px;background:#0b0e13;border-radius:0 0 14px 14px;font-size:11px;line-height:1.6;color:${C.ink3};">
You're getting this email because you have an IndianxTrade account. Questions? Write to
<a href="mailto:${SUPPORT_EMAIL}" style="color:${C.ink2};">${SUPPORT_EMAIL}</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}
```

`packages/mail/src/templates/format.ts`:

```ts
const IST = "Asia/Kolkata";

/** "11 Oct 2026", in India time regardless of the server's timezone. */
export function formatDateLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: IST }).format(d);
}

/** "11 Oct 2026, 01:30 IST". */
export function formatDateTimeLabel(d: Date): string {
  const s = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  }).format(d);
  return `${s} IST`;
}

/** The 8-character reference shown on receipts ("8F3A21C9"). */
export function shortRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const METHOD_LABEL: Record<string, string> = { BANK: "Bank account", UPI: "UPI", USDT: "USDT" };

/** "UPI · asha@okhdfc". `destination` comes from contracts' payoutDestinationLabel. */
export function payToLabel(method: string, destination: string | null): string {
  const label = METHOD_LABEL[method] ?? method;
  return destination ? `${label} · ${destination}` : label;
}
```

`packages/mail/src/templates/name.ts`:

```ts
/** How we address the user: full name, else nickname, else the email local part. */
export function displayName(profile: {
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  email: string;
}): string {
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (profile.nickname && profile.nickname.trim()) return profile.nickname.trim();
  return profile.email.split("@")[0] ?? "Trader";
}
```

`packages/mail/src/templates/certificate.ts`: copy `apps/web/src/lib/certificate.ts` verbatim, then make these changes:
1. Delete its local `certificateName` and `escapeHtml` functions. Add `import { escapeHtml } from "./layout";` at the top.
2. Add the stage type and notes above `certificateHtml`:

```ts
/** "requested" = the in-app receipt at request time; "paid" = the email sent when the admin marks it paid. */
export type CertificateStage = "requested" | "paid";

const CERTIFICATE_NOTE: Record<CertificateStage, string> = {
  requested:
    "This certificate confirms a withdrawal request on IndianxTrade. Requests are processed within 5–10 hours to your chosen payout method.",
  paid: "This certificate confirms a withdrawal paid out by IndianxTrade to your chosen payout method.",
};
```

3. Change the signature to `export function certificateHtml({ name, amountLabel, dateLabel, refId }: CertificateData, stage: CertificateStage = "requested"): string {`.
4. Replace the two-line footer text (`This certificate confirms a withdrawal request on IndianxTrade. Requests are processed within` / `5–10 hours to your original deposit method.`) with `${CERTIFICATE_NOTE[stage]}`.
5. Update the top doc comment's first line to: `Withdrawal reward certificate — one inline-styled HTML fragment used by the in-app receipt and the "withdrawal paid" email, so the two never drift.`

`packages/mail/src/templates/index.ts` (replace the placeholder):

```ts
// Client-safe entry: pure string templates, no logger, no secrets.
export * from "./layout";
export * from "./format";
export * from "./name";
export * from "./certificate";
```

- [ ] **Step 4: Point the web app at the moved certificate**

`apps/web/src/app/api/withdrawals/route.ts:16`: replace
`import { certificateHtml, certificateName, type CertificateData } from "@/lib/certificate";` with

```ts
import { certificateHtml, displayName, type CertificateData } from "@asm/mail/templates";
```

and on line 76 change `name: certificateName(profile),` to `name: displayName(profile),`.

`apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx:16`: replace
`import { certificateHtml, type CertificateData } from "@/lib/certificate";` with

```ts
import { certificateHtml, type CertificateData } from "@asm/mail/templates";
```

Delete the old files:

```bash
git rm apps/web/src/lib/certificate.ts apps/web/src/lib/certificate.test.ts
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @asm/mail test && pnpm --filter @asm/web exec tsc --noEmit`
Expected: mail PASS, web typecheck clean. If `formatDateTimeLabel` renders `11 Oct 2026 at 01:30`, your ICU differs. Node 22's full ICU gives `11 Oct 2026, 01:30`; adjust the expectation only if Node 22 itself disagrees.

- [ ] **Step 6: Commit**

```bash
git add packages/mail apps/web/src/app/api/withdrawals/route.ts "apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx"
git commit -m "feat(mail): shared email layout + move the withdrawal certificate into @asm/mail/templates"
```

---

### Task 3: The seven email templates + `notify` senders

**Files:**
- Create: `packages/mail/src/templates/welcome.ts`, `password.ts`, `deposit.ts`, `withdrawal.ts`, `packages/mail/src/notify.ts`
- Modify: `packages/mail/src/templates/index.ts`, `packages/mail/src/index.ts`
- Test: append to `packages/mail/src/templates/templates.test.ts`; create `packages/mail/src/notify.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces (templates, from `@asm/mail/templates`): `welcomeEmail({ name, firstDepositBonusPercent })`, `passwordResetEmail({ name, resetUrl, ttlMinutes })`, `passwordChangedEmail({ name, changedAtLabel, resetUrl })`, `depositCreditedEmail({ name, creditLabel, bonusLabel, totalLabel, dateLabel, refId })`, `withdrawalRequestedEmail({ name, amountLabel, payToLabel, held, refId })`, `withdrawalPaidEmail({ certificate, payToLabel })`, `withdrawalRejectedEmail({ name, amountLabel, reason, refId })`. Each returns `RenderedEmail`.
- Produces (senders, from `@asm/mail`). All return `Promise<SendResult>` and accept optional `cid`:
  - `sendWelcomeEmail({ to, userId, name, firstDepositBonusPercent })`, key `welcome/<userId>`, tag `welcome`
  - `sendPasswordResetEmail({ to, tokenId, name, resetUrl, ttlMinutes })`, key `password-reset/<tokenId>`, tag `password_reset`
  - `sendPasswordChangedEmail({ to, userId, name, changedAt: Date })`, key `password-changed/<userId>/<changedAt ms>`, tag `password_changed`
  - `sendDepositCreditedEmail({ to, depositId, name, creditLabel, bonusLabel: string | null, totalLabel })`, key `deposit-credited/<depositId>`, tag `deposit_credited`
  - `sendWithdrawalRequestedEmail({ to, withdrawalId, name, amountLabel, payToLabel, held })`, key `withdrawal-requested/<id>`, tag `withdrawal_requested`
  - `sendWithdrawalPaidEmail({ to, withdrawalId, certificate: CertificateData, payToLabel })`, key `withdrawal-paid/<id>`, tag `withdrawal_paid`
  - `sendWithdrawalRejectedEmail({ to, withdrawalId, name, amountLabel, reason })`, key `withdrawal-rejected/<id>`, tag `withdrawal_rejected`

- [ ] **Step 1: Write the failing template tests (append to `templates.test.ts`)**

Add to the import list at the top of `templates.test.ts`: `depositCreditedEmail, passwordChangedEmail, passwordResetEmail, welcomeEmail, withdrawalPaidEmail, withdrawalRejectedEmail, withdrawalRequestedEmail`. Then append:

```ts
describe("welcomeEmail", () => {
  it("greets by name and pitches the first-deposit bonus without wagering terms", () => {
    const { subject, html } = welcomeEmail({ name: "Asha", firstDepositBonusPercent: 100 });
    expect(subject).toBe("Welcome to IndianxTrade");
    expect(html).toContain("Hi Asha");
    expect(html).toContain("100% bonus");
    expect(html).not.toMatch(/wager|turnover|withdrawable/i);
  });
  it("leaves the bonus line out when there is no first-deposit bonus", () => {
    expect(welcomeEmail({ name: "Asha", firstDepositBonusPercent: 0 }).html).not.toContain("bonus");
  });
});

describe("password emails", () => {
  it("puts the reset link in the button and as plain text", () => {
    const url = "https://indianxtrade.com/reset-password?token=abc123";
    const { subject, html } = passwordResetEmail({ name: "Asha", resetUrl: url, ttlMinutes: 30 });
    expect(subject).toBe("Reset your IndianxTrade password");
    expect(html.split(url).length - 1).toBe(3); // button href, plain-link href, plain-link text
    expect(html).toContain("30 minutes");
  });
  it("tells the user when the password changed", () => {
    const { subject, html } = passwordChangedEmail({
      name: "Asha",
      changedAtLabel: "11 Oct 2026, 01:30 IST",
      resetUrl: "https://indianxtrade.com/forgot-password",
    });
    expect(subject).toBe("Your IndianxTrade password was changed");
    expect(html).toContain("11 Oct 2026, 01:30 IST");
    expect(html).toContain("signed you out");
  });
});

describe("depositCreditedEmail", () => {
  const base = { name: "Asha", creditLabel: "₹5,000.00", totalLabel: "₹10,000.00", dateLabel: "11 Oct 2026", refId: "D41C09AA" };
  it("shows the deposit, the bonus and the total", () => {
    const { subject, html } = depositCreditedEmail({ ...base, bonusLabel: "₹5,000.00" });
    expect(subject).toBe("₹5,000.00 added to your IndianxTrade account");
    expect(html).toContain("Bonus");
    expect(html).toContain("₹10,000.00");
    expect(html).not.toMatch(/wager|turnover|withdrawable/i);
  });
  it("has no bonus rows when no bonus was granted", () => {
    const { html } = depositCreditedEmail({ ...base, bonusLabel: null, totalLabel: "₹5,000.00" });
    expect(html).not.toContain("Bonus");
  });
});

describe("withdrawal emails", () => {
  it("confirms a request and promises the certificate on payout", () => {
    const { subject, html } = withdrawalRequestedEmail({
      name: "Asha", amountLabel: "₹2,500.00", payToLabel: "UPI · asha@okhdfc", held: false, refId: "8F3A21C9",
    });
    expect(subject).toBe("We've received your withdrawal request");
    expect(html).toContain("UPI · asha@okhdfc");
    expect(html).toContain("certificate");
    expect(html).toContain("Under review");
  });
  it("explains the first-withdrawal hold", () => {
    const { html } = withdrawalRequestedEmail({
      name: "Asha", amountLabel: "₹2,500.00", payToLabel: "UPI", held: true, refId: "8F3A21C9",
    });
    expect(html).toContain("On security hold");
  });
  it("embeds the paid-stage certificate", () => {
    const { subject, html } = withdrawalPaidEmail({
      certificate: { name: "Asha Rao", amountLabel: "₹2,500.00", dateLabel: "11 Oct 2026", refId: "8F3A21C9" },
      payToLabel: "UPI · asha@okhdfc",
    });
    expect(subject).toBe("Your withdrawal is paid. Here's your certificate");
    expect(html).toContain("Proudly presented to");
    expect(html).toContain("paid out by IndianxTrade");
  });
  it("gives the rejection reason and says the money is back", () => {
    const { html } = withdrawalRejectedEmail({
      name: "Asha", amountLabel: "₹2,500.00", reason: "The UPI ID couldn't receive the payment", refId: "8F3A21C9",
    });
    expect(html).toContain("The UPI ID couldn&#39;t receive the payment");
    expect(html).toContain("back in your balance");
  });
});
```

- [ ] **Step 2: Write the failing notify tests**

`packages/mail/src/notify.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_msg: { to: string; subject: string; html: string; idempotencyKey?: string; tag?: string }) => ({
    ok: true as const,
    id: "em_1",
  })),
}));
vi.mock("./send", () => ({ sendEmail }));

import {
  sendDepositCreditedEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendWithdrawalPaidEmail,
  sendWithdrawalRejectedEmail,
  sendWithdrawalRequestedEmail,
} from "./notify";

const last = () => sendEmail.mock.calls.at(-1)![0];
beforeEach(() => sendEmail.mockClear());

describe("notify senders", () => {
  it("keys each email so a re-run never sends it twice", async () => {
    await sendWelcomeEmail({ to: "a@gmail.com", userId: "u1", name: "Asha", firstDepositBonusPercent: 100 });
    expect(last()).toMatchObject({ to: "a@gmail.com", idempotencyKey: "welcome/u1", tag: "welcome" });

    await sendPasswordResetEmail({ to: "a@gmail.com", tokenId: "t1", name: "Asha", resetUrl: "https://indianxtrade.com/reset-password?token=x", ttlMinutes: 30 });
    expect(last()).toMatchObject({ idempotencyKey: "password-reset/t1", tag: "password_reset" });

    await sendPasswordChangedEmail({ to: "a@gmail.com", userId: "u1", name: "Asha", changedAt: new Date(1_000) });
    expect(last()).toMatchObject({ idempotencyKey: "password-changed/u1/1000", tag: "password_changed" });

    await sendDepositCreditedEmail({ to: "a@gmail.com", depositId: "d1", name: "Asha", creditLabel: "₹1.00", bonusLabel: null, totalLabel: "₹1.00" });
    expect(last()).toMatchObject({ idempotencyKey: "deposit-credited/d1", tag: "deposit_credited" });

    await sendWithdrawalRequestedEmail({ to: "a@gmail.com", withdrawalId: "w1", name: "Asha", amountLabel: "₹1.00", payToLabel: "UPI", held: false });
    expect(last()).toMatchObject({ idempotencyKey: "withdrawal-requested/w1", tag: "withdrawal_requested" });

    await sendWithdrawalPaidEmail({
      to: "a@gmail.com", withdrawalId: "w1", payToLabel: "UPI",
      certificate: { name: "Asha", amountLabel: "₹1.00", dateLabel: "11 Oct 2026", refId: "W1" },
    });
    expect(last()).toMatchObject({ idempotencyKey: "withdrawal-paid/w1", tag: "withdrawal_paid" });

    await sendWithdrawalRejectedEmail({ to: "a@gmail.com", withdrawalId: "w1", name: "Asha", amountLabel: "₹1.00", reason: "Bad UPI" });
    expect(last()).toMatchObject({ idempotencyKey: "withdrawal-rejected/w1", tag: "withdrawal_rejected" });
  });

  it("uses the deposit id's short form as the reference", async () => {
    await sendDepositCreditedEmail({ to: "a@gmail.com", depositId: "d41c09aa-0000", name: "Asha", creditLabel: "₹1.00", bonusLabel: null, totalLabel: "₹1.00" });
    expect(last().html).toContain("D41C09AA");
  });
});
```

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `pnpm --filter @asm/mail test`
Expected: FAIL, `welcomeEmail` not exported and `./notify` not found.

- [ ] **Step 4: Implement the templates**

`packages/mail/src/templates/welcome.ts`:

```ts
import { emailLayout, p, siteUrl, type RenderedEmail } from "./layout";

export function welcomeEmail(input: { name: string; firstDepositBonusPercent: number }): RenderedEmail {
  const pct = input.firstDepositBonusPercent;
  // Bonus copy follows the marketing posture: "Bonus", no wagering wording.
  const bonusLine =
    pct >= 100
      ? p(`When you're ready for LIVE trading, make your first deposit and get a ${pct}% bonus on it. Double your trading power.`)
      : pct > 0
        ? p(`When you're ready for LIVE trading, make your first deposit and get a ${pct}% bonus on it.`)
        : p("When you're ready, make a deposit to start trading LIVE.");
  return {
    subject: "Welcome to IndianxTrade",
    html: emailLayout({
      preheader: "Your account is ready. Start with the DEMO account.",
      heading: "Welcome to IndianxTrade",
      bodyHtml: [
        p(`Hi ${input.name}, your IndianxTrade account is ready.`),
        p("Your DEMO account comes loaded with practice money, so you can learn the platform without risking a rupee."),
        bonusLine,
      ].join(""),
      cta: { label: "Start trading", url: siteUrl("/trade") },
    }),
  };
}
```

`packages/mail/src/templates/password.ts`:

```ts
import { SUPPORT_EMAIL, emailLayout, linkLine, muted, p, type RenderedEmail } from "./layout";

export function passwordResetEmail(input: { name: string; resetUrl: string; ttlMinutes: number }): RenderedEmail {
  return {
    subject: "Reset your IndianxTrade password",
    html: emailLayout({
      preheader: `This link works once and expires in ${input.ttlMinutes} minutes.`,
      heading: "Reset your password",
      bodyHtml: [
        p(`Hi ${input.name}, we got a request to reset the password on your IndianxTrade account.`),
        p(`Tap the button to choose a new one. The link works once and expires in ${input.ttlMinutes} minutes.`),
      ].join(""),
      cta: { label: "Set a new password", url: input.resetUrl },
      afterCtaHtml: [
        muted("Button not working? Paste this link into your browser:"),
        linkLine(input.resetUrl),
        muted("Didn't ask for this? Ignore this email. Your password stays the same."),
      ].join(""),
    }),
  };
}

export function passwordChangedEmail(input: { name: string; changedAtLabel: string; resetUrl: string }): RenderedEmail {
  return {
    subject: "Your IndianxTrade password was changed",
    html: emailLayout({
      preheader: "We signed you out on every device.",
      heading: "Password changed",
      bodyHtml: [
        p(`Hi ${input.name}, the password on your IndianxTrade account was changed on ${input.changedAtLabel}.`),
        p("For your security we signed you out on every device. Log in again with your new password."),
        p(`Wasn't you? Reset your password right away and write to ${SUPPORT_EMAIL}.`),
      ].join(""),
      cta: { label: "Reset password", url: input.resetUrl },
    }),
  };
}
```

`packages/mail/src/templates/deposit.ts`:

```ts
import { details, emailLayout, p, siteUrl, type EmailDetail, type RenderedEmail } from "./layout";

export function depositCreditedEmail(input: {
  name: string;
  creditLabel: string;
  /** Null when this deposit earned no bonus (5th deposit onwards). */
  bonusLabel: string | null;
  totalLabel: string;
  dateLabel: string;
  refId: string;
}): RenderedEmail {
  const rows: EmailDetail[] = [{ label: "Deposit", value: input.creditLabel }];
  if (input.bonusLabel) {
    rows.push({ label: "Bonus", value: input.bonusLabel }, { label: "You can trade with", value: input.totalLabel });
  }
  rows.push({ label: "Date", value: input.dateLabel }, { label: "Reference", value: input.refId });
  return {
    subject: `${input.creditLabel} added to your IndianxTrade account`,
    html: emailLayout({
      preheader: input.bonusLabel
        ? `Bonus ${input.bonusLabel} added too. Trade with ${input.totalLabel}.`
        : "Your money is in your LIVE account.",
      heading: "Deposit credited",
      bodyHtml: [p(`Hi ${input.name}, your deposit is in your LIVE account and ready to trade.`), details(rows)].join(""),
      cta: { label: "Start trading", url: siteUrl("/trade") },
    }),
  };
}
```

`packages/mail/src/templates/withdrawal.ts`:

```ts
import { certificateHtml, type CertificateData } from "./certificate";
import { details, emailLayout, p, siteUrl, type RenderedEmail } from "./layout";

export function withdrawalRequestedEmail(input: {
  name: string;
  amountLabel: string;
  payToLabel: string;
  /** First withdrawal inside the hold window: status HELD. */
  held: boolean;
  refId: string;
}): RenderedEmail {
  return {
    subject: "We've received your withdrawal request",
    html: emailLayout({
      preheader: `${input.amountLabel} to ${input.payToLabel}.`,
      heading: "Withdrawal requested",
      bodyHtml: [
        p(`Hi ${input.name}, we've received your request to withdraw ${input.amountLabel}.`),
        details([
          { label: "Amount", value: input.amountLabel },
          { label: "Pay to", value: input.payToLabel },
          { label: "Status", value: input.held ? "On security hold" : "Under review" },
          { label: "Reference", value: input.refId },
        ]),
        p(
          input.held
            ? "Your first withdrawal sits on a short security hold, then goes to review. You can cancel it from the Withdrawal page while the cancel window is open."
            : "Our team reviews it and sends the money within 5–10 hours.",
        ),
        p("We'll email your reward certificate as soon as it's paid."),
      ].join(""),
      cta: { label: "View withdrawal", url: siteUrl("/withdrawal") },
    }),
  };
}

export function withdrawalPaidEmail(input: { certificate: CertificateData; payToLabel: string }): RenderedEmail {
  const c = input.certificate;
  return {
    subject: "Your withdrawal is paid. Here's your certificate",
    html: emailLayout({
      preheader: `${c.amountLabel} is on its way to ${input.payToLabel}.`,
      heading: "Withdrawal paid",
      bodyHtml: [
        p(`Hi ${c.name}, we've sent ${c.amountLabel} to ${input.payToLabel}. Depending on your bank or network, it can take a little while to show up.`),
        `<div style="margin:18px 0 6px;">${certificateHtml(c, "paid")}</div>`,
      ].join(""),
    }),
  };
}

export function withdrawalRejectedEmail(input: {
  name: string;
  amountLabel: string;
  reason: string;
  refId: string;
}): RenderedEmail {
  return {
    subject: "Your withdrawal couldn't be paid",
    html: emailLayout({
      preheader: `${input.amountLabel} is back in your balance.`,
      heading: "Withdrawal not completed",
      bodyHtml: [
        p(`Hi ${input.name}, we couldn't pay your withdrawal of ${input.amountLabel}.`),
        details([
          { label: "Reason", value: input.reason },
          { label: "Refunded", value: input.amountLabel },
          { label: "Reference", value: input.refId },
        ]),
        p("The full amount is back in your balance. Check your payout details and request the withdrawal again."),
      ].join(""),
      cta: { label: "Request again", url: siteUrl("/withdrawal") },
    }),
  };
}
```

Append to `packages/mail/src/templates/index.ts`:

```ts
export * from "./welcome";
export * from "./password";
export * from "./deposit";
export * from "./withdrawal";
```

- [ ] **Step 5: Implement the senders**

`packages/mail/src/notify.ts`:

```ts
import { sendEmail, type SendResult } from "./send";
import {
  depositCreditedEmail,
  formatDateLabel,
  passwordChangedEmail,
  passwordResetEmail,
  shortRef,
  siteUrl,
  welcomeEmail,
  withdrawalPaidEmail,
  withdrawalRejectedEmail,
  withdrawalRequestedEmail,
  formatDateTimeLabel,
  type CertificateData,
  type RenderedEmail,
} from "./templates";

/**
 * One sender per email. Each fixes the idempotency key (so a re-run trigger
 * never sends twice) and the dashboard tag. Callers pass already-formatted
 * money labels: formatMoney lives in @asm/db, which this package can't import.
 */

interface Recipient {
  to: string;
  cid?: string | undefined;
}

function deliver(r: Recipient, email: RenderedEmail, idempotencyKey: string, tag: string): Promise<SendResult> {
  return sendEmail({ to: r.to, subject: email.subject, html: email.html, idempotencyKey, tag, cid: r.cid });
}

export function sendWelcomeEmail(input: Recipient & { userId: string; name: string; firstDepositBonusPercent: number }) {
  return deliver(input, welcomeEmail(input), `welcome/${input.userId}`, "welcome");
}

export function sendPasswordResetEmail(
  input: Recipient & { tokenId: string; name: string; resetUrl: string; ttlMinutes: number },
) {
  return deliver(input, passwordResetEmail(input), `password-reset/${input.tokenId}`, "password_reset");
}

export function sendPasswordChangedEmail(input: Recipient & { userId: string; name: string; changedAt: Date }) {
  const email = passwordChangedEmail({
    name: input.name,
    changedAtLabel: formatDateTimeLabel(input.changedAt),
    resetUrl: siteUrl("/forgot-password"),
  });
  return deliver(input, email, `password-changed/${input.userId}/${input.changedAt.getTime()}`, "password_changed");
}

export function sendDepositCreditedEmail(
  input: Recipient & { depositId: string; name: string; creditLabel: string; bonusLabel: string | null; totalLabel: string },
) {
  const email = depositCreditedEmail({
    name: input.name,
    creditLabel: input.creditLabel,
    bonusLabel: input.bonusLabel,
    totalLabel: input.totalLabel,
    dateLabel: formatDateLabel(new Date()),
    refId: shortRef(input.depositId),
  });
  return deliver(input, email, `deposit-credited/${input.depositId}`, "deposit_credited");
}

export function sendWithdrawalRequestedEmail(
  input: Recipient & { withdrawalId: string; name: string; amountLabel: string; payToLabel: string; held: boolean },
) {
  const email = withdrawalRequestedEmail({ ...input, refId: shortRef(input.withdrawalId) });
  return deliver(input, email, `withdrawal-requested/${input.withdrawalId}`, "withdrawal_requested");
}

export function sendWithdrawalPaidEmail(
  input: Recipient & { withdrawalId: string; certificate: CertificateData; payToLabel: string },
) {
  const email = withdrawalPaidEmail({ certificate: input.certificate, payToLabel: input.payToLabel });
  return deliver(input, email, `withdrawal-paid/${input.withdrawalId}`, "withdrawal_paid");
}

export function sendWithdrawalRejectedEmail(
  input: Recipient & { withdrawalId: string; name: string; amountLabel: string; reason: string },
) {
  const email = withdrawalRejectedEmail({ ...input, refId: shortRef(input.withdrawalId) });
  return deliver(input, email, `withdrawal-rejected/${input.withdrawalId}`, "withdrawal_rejected");
}
```

Append to `packages/mail/src/index.ts`:

```ts
export * from "./notify";
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `pnpm --filter @asm/mail test && pnpm --filter @asm/mail exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/mail
git commit -m "feat(mail): welcome, password, deposit and withdrawal templates + keyed senders"
```

---

### Task 4: Deposit-credited email from `creditDepositToAccount`

**Files:**
- Modify: `packages/db/src/repositories/deposit.ts` (imports; `creditDepositToAccount` ~lines 548-776)
- Test: `packages/db/src/repositories/deposit-email.test.ts` (new)

**Interfaces:**
- Consumes: `sendDepositCreditedEmail` (`@asm/mail`), `displayName` (`@asm/mail/templates`), `formatMoney` (`../money`).
- Produces: none. Side effect only: one email per credited deposit, after commit.

- [ ] **Step 1: Write the failing test**

`packages/db/src/repositories/deposit-email.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendDepositCreditedEmail } = vi.hoisted(() => ({
  sendDepositCreditedEmail: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, id: "em_1" })),
}));
vi.mock("@asm/mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@asm/mail")>()),
  sendDepositCreditedEmail,
}));

import { prisma } from "../client";
import { formatMoney } from "../money";
import { createAccountsForUser } from "./account";
import { DepositAlreadyResolved, createDepositIntent, creditDepositToAccount } from "./deposit";

let userId = "";
let email = "";

beforeAll(async () => {
  email = `deposit-email-${randomUUID()}@test.local`;
  const user = await prisma.user.create({ data: { email, passwordHash: "x", firstName: "Asha", lastName: "Rao" } });
  userId = user.id;
  await createAccountsForUser(userId, 0);
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { account: { userId } } });
  await prisma.bonusGrant.deleteMany({ where: { account: { userId } } });
  await prisma.deposit.deleteMany({ where: { userId } });
  await prisma.account.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(() => sendDepositCreditedEmail.mockClear());

// A random rupee amount, so the live-amount unique index never collides with
// another test's open deposit.
const randomAmount = () => (500 + Math.floor(Math.random() * 40_000)) * 100;

describe("deposit-credited email", () => {
  it("emails the credited amount and the bonus once the deposit commits", async () => {
    const amount = randomAmount();
    const deposit = await createDepositIntent({ userId, method: "upi", amountInrMinor: amount, correlationId: randomUUID() });
    await creditDepositToAccount({ depositId: deposit.id, adminId: "test-admin", creditId: null });

    expect(sendDepositCreditedEmail).toHaveBeenCalledTimes(1);
    // First deposit: 100% bonus.
    expect(sendDepositCreditedEmail).toHaveBeenCalledWith({
      to: email,
      name: "Asha Rao",
      depositId: deposit.id,
      creditLabel: formatMoney(amount, "INR"),
      bonusLabel: formatMoney(amount, "INR"),
      totalLabel: formatMoney(amount * 2, "INR"),
    });
  });

  it("sends nothing when the deposit was already credited", async () => {
    const deposit = await createDepositIntent({ userId, method: "upi", amountInrMinor: randomAmount(), correlationId: randomUUID() });
    await creditDepositToAccount({ depositId: deposit.id, adminId: "test-admin", creditId: null });
    sendDepositCreditedEmail.mockClear();

    await expect(
      creditDepositToAccount({ depositId: deposit.id, adminId: "test-admin", creditId: null }),
    ).rejects.toBeInstanceOf(DepositAlreadyResolved);
    expect(sendDepositCreditedEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run (with the Test environment vars exported): `pnpm --filter @asm/db exec vitest run src/repositories/deposit-email.test.ts`
Expected: FAIL. `sendDepositCreditedEmail` is called 0 times.

- [ ] **Step 3: Implement the hook**

In `packages/db/src/repositories/deposit.ts`, add to the imports:

```ts
import { sendDepositCreditedEmail } from "@asm/mail";
import { displayName } from "@asm/mail/templates";
import { formatMoney } from "../money";
```

In `creditDepositToAccount`, widen the user select:

```ts
  const deposit = await prisma.deposit.findUnique({
    where: { id: input.depositId },
    include: { user: { select: { role: true, email: true, firstName: true, lastName: true, nickname: true } } },
  });
```

Directly above `await prisma.$transaction(async (tx) => {`, add:

```ts
  // Set inside the transaction; read after commit for the email.
  let grantedBonus = 0;
```

Inside the transaction, right after `const bonus = Math.floor((credit * bonusPercent) / 100);`, add:

```ts
    grantedBonus = bonus;
```

After the existing `flagLinkageForUser(...).catch(...)` block at the end of the function, add:

```ts
  // Tell the user once the money is really there. Outside the transaction and
  // not awaited: Resend being slow or down must never delay or undo a credit.
  // The idempotency key (deposit id) stops a duplicate if this ever re-runs.
  sendDepositCreditedEmail({
    to: deposit.user.email,
    name: displayName(deposit.user),
    depositId: deposit.id,
    creditLabel: formatMoney(credit, account.currency),
    bonusLabel: grantedBonus > 0 ? formatMoney(grantedBonus, account.currency) : null,
    totalLabel: formatMoney(credit + grantedBonus, account.currency),
  }).catch(() => {
    /* sendEmail never throws; this guards a template bug */
  });
```

- [ ] **Step 4: Run the new test and the whole db suite**

Run: `pnpm --filter @asm/db exec vitest run src/repositories/deposit-email.test.ts`
Expected: PASS (2 tests).

Run: `pnpm --filter @asm/db test`
Expected: PASS (all existing tests still green; under vitest `sendEmail` skips, so nothing is sent).

- [ ] **Step 5: Check the engine still boots with the new import chain**

Run: `pnpm --filter @asm/engine exec tsc --noEmit`
Expected: no errors (the engine pulls `@asm/mail` in through `@asm/db`).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repositories/deposit.ts packages/db/src/repositories/deposit-email.test.ts
git commit -m "feat(deposits): email the user when a deposit is credited (amount + bonus + total)"
```

---

### Task 5: Withdrawal emails — requested, paid (certificate), rejected

**Files:**
- Modify: `packages/db/src/repositories/withdrawal.ts` (append `getWithdrawalNotice`), `packages/db/src/index.ts` (export it)
- Create: `apps/web/src/lib/withdrawal-mail.ts`
- Modify: `apps/web/src/app/api/withdrawals/route.ts` (mail block ~lines 65-97), `apps/web/src/app/admin/(console)/withdrawals/actions.ts` (paid + reject actions), `apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx:382`
- Test: `apps/web/src/lib/withdrawal-mail.test.ts` (new), `apps/web/src/app/api/withdrawals/route.test.ts` (add mock + assertion)

**Interfaces:**
- Produces: `getWithdrawalNotice(withdrawalId: string)` returns `{ id, amount, currency, status, reason, method, accountNumber, ifsc, upiId, usdtNetwork, usdtAddress, user: { email, firstName, lastName, nickname } } | null`. Also `emailWithdrawalPaid(withdrawalId): Promise<void>` and `emailWithdrawalRejected(withdrawalId): Promise<void>`; neither ever throws.

- [ ] **Step 1: Write the failing lib test**

`apps/web/src/lib/withdrawal-mail.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendWithdrawalPaidEmail: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, id: "em" })),
  sendWithdrawalRejectedEmail: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, id: "em" })),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { prisma } from "@asm/db";
import { emailWithdrawalPaid, emailWithdrawalRejected } from "./withdrawal-mail";

const RUN = randomUUID();
let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `wmail-${RUN}@test.local`, passwordHash: "x", firstName: "Asha", lastName: "Rao" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  mail.sendWithdrawalPaidEmail.mockClear();
  mail.sendWithdrawalRejectedEmail.mockClear();
});

function makeWithdrawal(status: "PAID" | "REJECTED" | "APPROVED", reason: string | null = null) {
  return prisma.withdrawal.create({
    data: { userId, amount: 2_500_00, currency: "INR", method: "UPI", upiId: "asha@okhdfc", status, reason },
  });
}

describe("withdrawal emails", () => {
  it("sends the paid certificate with the payout destination", async () => {
    const w = await makeWithdrawal("PAID");
    await emailWithdrawalPaid(w.id);
    expect(mail.sendWithdrawalPaidEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: `wmail-${RUN}@test.local`,
        withdrawalId: w.id,
        payToLabel: "UPI · asha@okhdfc",
        certificate: expect.objectContaining({ name: "Asha Rao", amountLabel: "₹2,500.00", refId: w.id.slice(0, 8).toUpperCase() }),
      }),
    );
  });

  it("does not send a certificate for a withdrawal that is not PAID", async () => {
    const w = await makeWithdrawal("APPROVED");
    await emailWithdrawalPaid(w.id);
    expect(mail.sendWithdrawalPaidEmail).not.toHaveBeenCalled();
  });

  it("sends the rejection with the admin's preset reason", async () => {
    const w = await makeWithdrawal("REJECTED", "The UPI ID couldn't receive the payment");
    await emailWithdrawalRejected(w.id);
    expect(mail.sendWithdrawalRejectedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ withdrawalId: w.id, amountLabel: "₹2,500.00", reason: "The UPI ID couldn't receive the payment" }),
    );
  });

  it("never throws, even for an unknown id", async () => {
    await expect(emailWithdrawalPaid(randomUUID())).resolves.toBeUndefined();
    await expect(emailWithdrawalRejected(randomUUID())).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @asm/web exec vitest run src/lib/withdrawal-mail.test.ts`
Expected: FAIL with `Failed to resolve import "./withdrawal-mail"`.

- [ ] **Step 3: Add `getWithdrawalNotice` to the db**

Append to `packages/db/src/repositories/withdrawal.ts`:

```ts
/**
 * What the withdrawal emails need: amount, currency, payout destination and
 * who to write to. Read-only; the status is returned so a caller can refuse
 * to send a "paid" email for a row that isn't PAID.
 */
export async function getWithdrawalNotice(withdrawalId: string) {
  return prisma.withdrawal.findUnique({
    where: { id: withdrawalId },
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      reason: true,
      method: true,
      accountNumber: true,
      ifsc: true,
      upiId: true,
      usdtNetwork: true,
      usdtAddress: true,
      user: { select: { email: true, firstName: true, lastName: true, nickname: true } },
    },
  });
}
```

In `packages/db/src/index.ts`, add `getWithdrawalNotice` to the existing `export { ... } from "./repositories/withdrawal";` block.

- [ ] **Step 4: Implement the web lib**

`apps/web/src/lib/withdrawal-mail.ts`:

```ts
import { payoutDestinationLabel } from "@asm/contracts";
import { formatMoney, getWithdrawalNotice } from "@asm/db";
import { logger } from "@asm/logger";
import { sendWithdrawalPaidEmail, sendWithdrawalRejectedEmail } from "@asm/mail";
import { displayName, formatDateLabel, payToLabel, shortRef } from "@asm/mail/templates";

/**
 * Emails for the admin's withdrawal decisions. Both run after the decision is
 * committed and never throw: a mail failure must not surface as a failed
 * admin action, because the payout or refund already happened.
 */

export async function emailWithdrawalPaid(withdrawalId: string): Promise<void> {
  try {
    const w = await getWithdrawalNotice(withdrawalId);
    if (!w || w.status !== "PAID") return;
    await sendWithdrawalPaidEmail({
      to: w.user.email,
      withdrawalId: w.id,
      payToLabel: payToLabel(w.method, payoutDestinationLabel(w)),
      certificate: {
        name: displayName(w.user),
        amountLabel: formatMoney(w.amount, w.currency),
        dateLabel: formatDateLabel(new Date()),
        refId: shortRef(w.id),
      },
    });
  } catch (err) {
    logger.warn({ evt: "withdrawal.mail_failed", kind: "paid", withdrawalId, err: String(err) }, "withdrawal paid email failed");
  }
}

export async function emailWithdrawalRejected(withdrawalId: string): Promise<void> {
  try {
    const w = await getWithdrawalNotice(withdrawalId);
    if (!w || w.status !== "REJECTED") return;
    await sendWithdrawalRejectedEmail({
      to: w.user.email,
      withdrawalId: w.id,
      name: displayName(w.user),
      amountLabel: formatMoney(w.amount, w.currency),
      reason: w.reason ?? "We couldn't send this payout",
    });
  } catch (err) {
    logger.warn({ evt: "withdrawal.mail_failed", kind: "rejected", withdrawalId, err: String(err) }, "withdrawal rejected email failed");
  }
}
```

- [ ] **Step 5: Run the lib test**

Run: `pnpm --filter @asm/web exec vitest run src/lib/withdrawal-mail.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Call the lib from the admin actions**

In `apps/web/src/app/admin/(console)/withdrawals/actions.ts`, add the import:

```ts
import { emailWithdrawalPaid, emailWithdrawalRejected } from "@/lib/withdrawal-mail";
```

In `markWithdrawalPaidAction`, after the `logger.info(...)` call and before `revalidatePath`, add:

```ts
  // The reward certificate goes out now that the money has actually been sent.
  await emailWithdrawalPaid(withdrawalId);
```

In `rejectWithdrawalAction`, after its `logger.info(...)` call and before `revalidatePath`, add:

```ts
  await emailWithdrawalRejected(withdrawalId);
```

- [ ] **Step 7: Switch the request route to the "received" email**

In `apps/web/src/app/api/withdrawals/route.ts`:

Change the imports. Remove `import { sendEmail } from "@asm/mail";` and the Task 2 `@asm/mail/templates` import line. Add `payoutDestinationLabel` to the existing `@asm/contracts` import, and add:

```ts
import { sendWithdrawalRequestedEmail } from "@asm/mail";
import { displayName, formatDateLabel, payToLabel, shortRef, type CertificateData } from "@asm/mail/templates";
```

Replace everything from the comment `// Build the reward certificate and (when Resend is configured) email it.` down to and including the closing `}` of the `try { const sent = await sendEmail(...) } catch (mailErr) {...}` block with:

```ts
    // The in-app receipt still shows the certificate now. By email the user
    // gets a "request received" note, and the certificate follows when the
    // admin marks it paid (admin withdrawals actions). The post-debit account
    // snapshot also feeds the live-balance push below, so the TopBar drops
    // immediately instead of waiting for the next trade settlement. A mail
    // failure never fails the withdrawal: the request is already recorded.
    const [account, profile] = await Promise.all([
      getAccountForActor(session.userId, parsed.data.accountId),
      loadProfile(session.userId),
    ]);
    const name = displayName(profile);
    const amountLabel = formatMoney(parsed.data.amount, account?.currency ?? "INR");
    const certificate: CertificateData = {
      name,
      amountLabel,
      dateLabel: formatDateLabel(new Date()),
      refId: shortRef(withdrawal.id),
    };
    const sent = await sendWithdrawalRequestedEmail({
      to: profile.email,
      cid: ctx.cid,
      withdrawalId: withdrawal.id,
      name,
      amountLabel,
      payToLabel: payToLabel(parsed.data.payout.method, payoutDestinationLabel(parsed.data.payout)),
      held: withdrawal.status === "HELD",
    });
    const emailed = sent.ok;
```

(The `return NextResponse.json({ id, status, certificate, emailed, balance }, { status: 201 })` that follows stays unchanged.)

- [ ] **Step 8: Update the receipt copy**

`apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx:382`: replace

```tsx
        {receipt.emailed ? " A certificate has been emailed to you." : ""}
```

with

```tsx
        {receipt.emailed ? " We've emailed you a confirmation. Your certificate follows once it's paid." : ""}
```

- [ ] **Step 9: Assert the request email in the route test**

At the top of `apps/web/src/app/api/withdrawals/route.test.ts`, change `import { afterAll, beforeAll, describe, expect, it } from "vitest";` to include `vi`, and add right after the imports-from-vitest line:

```ts
const mail = vi.hoisted(() => ({
  sendWithdrawalRequestedEmail: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true as const, id: "em" })),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));
```

In the existing test `it("creates a withdrawal to a UPI ID the user never deposited with", ...)`, after `expect(res.status).toBe(201);`, add:

```ts
    expect(mail.sendWithdrawalRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ amountLabel: "₹1,000.00", payToLabel: expect.stringContaining("UPI") }),
    );
```

- [ ] **Step 10: Run the web tests and typecheck**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/withdrawals src/lib/withdrawal-mail.test.ts && pnpm --filter @asm/web exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
git add packages/db/src/repositories/withdrawal.ts packages/db/src/index.ts apps/web/src/lib/withdrawal-mail.ts apps/web/src/lib/withdrawal-mail.test.ts apps/web/src/app/api/withdrawals "apps/web/src/app/admin/(console)/withdrawals/actions.ts" "apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx"
git commit -m "feat(withdrawals): request-received email; certificate on Mark paid; rejection email with reason"
```

---

### Task 6: Password-reset token storage

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (new model + `User` relation), `packages/db/src/index.ts`
- Create: `packages/db/prisma/migrations/20261010120000_password_reset_tokens/migration.sql`, `packages/db/src/repositories/password-reset.ts`
- Test: `packages/db/src/repositories/password-reset.test.ts`

**Interfaces:**
- Produces: `PASSWORD_RESET_TTL_MS` (30 min); `issuePasswordResetToken({ userId, ipAddress? }): Promise<{ id: string; token: string; expiresAt: Date }>`; `resetPasswordWithToken({ token, passwordHash, ipAddress? }): Promise<{ userId: string; email: string; firstName: string | null; lastName: string | null; nickname: string | null } | null>`.

- [ ] **Step 1: Add the model (hand-edit, no `prisma format`)**

In `packages/db/prisma/schema.prisma`, in `model User`'s relation list, add a line after `kycDocuments   KycDocument[]`:

```prisma
  passwordResetTokens PasswordResetToken[]
```

After `model TwoFactorCode { ... }`, add:

```prisma
/// Self-service "forgot password": one row per emailed reset link. Only the
/// sha256 of the token is stored; the raw token lives only in the email.
model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  ipAddress String?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- [ ] **Step 2: Hand-write the migration**

`packages/db/prisma/migrations/20261010120000_password_reset_tokens/migration.sql`:

```sql
-- Self-service password reset: one row per emailed link. Hand-written:
-- schema.prisma has pre-existing drift.

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Apply it to the isolated DB, then regenerate the client:

Run: `cd packages/db && npx prisma migrate deploy && npx prisma generate`
Expected: `Applying migration 20261010120000_password_reset_tokens` … `All migrations have been successfully applied.`

Confirm that only the known drift remains:

Run: `cd packages/db && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
Expected: only the known drift (`Asset.garchOmega` default, `FraudFlag.linkedUserIds` default, `HouseDay` timestamps). Nothing about `PasswordResetToken`.

- [ ] **Step 3: Write the failing repo test**

`packages/db/src/repositories/password-reset.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../client";
import { issuePasswordResetToken, resetPasswordWithToken } from "./password-reset";

let userId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `pw-reset-${randomUUID()}@test.local`, passwordHash: "old-hash", firstName: "Asha" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { targetType: "User", targetId: userId } });
  await prisma.user.delete({ where: { id: userId } }); // cascades tokens and sessions
  await prisma.$disconnect();
});

describe("password reset tokens", () => {
  it("stores only a hash of the token", async () => {
    const { id, token } = await issuePasswordResetToken({ userId });
    const row = await prisma.passwordResetToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it("sets the new password, verifies the email and signs out every device", async () => {
    await prisma.session.create({
      data: { userId, tokenHash: `t-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) },
    });
    const { token } = await issuePasswordResetToken({ userId });
    const result = await resetPasswordWithToken({ token, passwordHash: "new-hash" });

    expect(result?.userId).toBe(userId);
    expect(result?.firstName).toBe("Asha");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBe("new-hash");
    expect(user.emailVerified).toBe(true);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
  });

  it("works only once", async () => {
    const { token } = await issuePasswordResetToken({ userId });
    expect(await resetPasswordWithToken({ token, passwordHash: "h1" })).not.toBeNull();
    expect(await resetPasswordWithToken({ token, passwordHash: "h2" })).toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBe("h1");
  });

  it("refuses an expired token", async () => {
    const { id, token } = await issuePasswordResetToken({ userId });
    await prisma.passwordResetToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect(await resetPasswordWithToken({ token, passwordHash: "never" })).toBeNull();
  });

  it("kills the older link when a new one is issued", async () => {
    const first = await issuePasswordResetToken({ userId });
    const second = await issuePasswordResetToken({ userId });
    expect(await resetPasswordWithToken({ token: first.token, passwordHash: "never" })).toBeNull();
    expect(await resetPasswordWithToken({ token: second.token, passwordHash: "ok" })).not.toBeNull();
  });

  it("refuses an unknown token", async () => {
    expect(await resetPasswordWithToken({ token: "x".repeat(43), passwordHash: "never" })).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `pnpm --filter @asm/db exec vitest run src/repositories/password-reset.test.ts`
Expected: FAIL with `Failed to resolve import "./password-reset"`.

- [ ] **Step 5: Implement the repo**

`packages/db/src/repositories/password-reset.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../client";

/** How long an emailed reset link works. The email copy states it in minutes. */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a single-use reset token for the emailed link. Every earlier unused
 * token for the user dies first, so only the newest email works. Returns the
 * raw token (goes in the link, never stored) and the row id (the email's
 * idempotency key).
 */
export async function issuePasswordResetToken(input: {
  userId: string;
  ipAddress?: string | null;
}): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  const row = await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: input.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    return tx.passwordResetToken.create({
      data: { userId: input.userId, tokenHash: hashToken(token), expiresAt, ipAddress: input.ipAddress ?? null },
      select: { id: true },
    });
  });
  return { id: row.id, token, expiresAt };
}

/**
 * Spends a reset token and sets the new password in one transaction. The
 * token claim is conditional (unused and unexpired), so a replayed or racing
 * link loses. Every session is deleted, which signs the user out on all
 * devices. The email counts as verified, since only the inbox owner could
 * open the link. Returns null for an unknown, used or expired token. The
 * caller hashes the password first (argon2 lives in the web app).
 */
export async function resetPasswordWithToken(input: {
  token: string;
  passwordHash: string;
  ipAddress?: string | null;
}): Promise<{ userId: string; email: string; firstName: string | null; lastName: string | null; nickname: string | null } | null> {
  const tokenHash = hashToken(input.token);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true } });
    if (!row) return null;

    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const user = await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash: input.passwordHash, emailVerified: true },
      select: { id: true, email: true, firstName: true, lastName: true, nickname: true },
    });
    await tx.session.deleteMany({ where: { userId: row.userId } });
    await tx.auditLog.create({
      data: {
        actorId: row.userId,
        action: "auth.password_reset",
        targetType: "User",
        targetId: row.userId,
        after: { via: "email_link", ip: input.ipAddress ?? null },
      },
    });
    return { userId: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, nickname: user.nickname };
  });
}
```

In `packages/db/src/index.ts`, add after the `twofa` export line:

```ts
export {
  PASSWORD_RESET_TTL_MS,
  issuePasswordResetToken,
  resetPasswordWithToken,
} from "./repositories/password-reset";
```

- [ ] **Step 6: Run the test to make sure it passes**

Run: `pnpm --filter @asm/db exec vitest run src/repositories/password-reset.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261010120000_password_reset_tokens packages/db/src/repositories/password-reset.ts packages/db/src/repositories/password-reset.test.ts packages/db/src/index.ts
git commit -m "feat(auth): password-reset tokens — hashed, single-use, 30-min, sign out everywhere on reset"
```

---

### Task 7: Password-reset API routes

**Files:**
- Modify: `packages/contracts/src/auth.ts`, `packages/contracts/src/auth.test.ts`, `packages/contracts/src/index.ts` (only if it doesn't already `export * from "./auth"`)
- Create: `apps/web/src/app/api/auth/password-reset/request/route.ts`, `apps/web/src/app/api/auth/password-reset/confirm/route.ts`
- Test: `apps/web/src/app/api/auth/password-reset/flow.test.ts`

**Interfaces:**
- Consumes: Task 6 repo, Task 3 `sendPasswordResetEmail` / `sendPasswordChangedEmail`, `displayName`.
- Produces: `POST /api/auth/password-reset/request` with `{ email }`. It always returns `200 { ok: true, message }` (400 for a malformed email, 429 when throttled, 403 for a VPN block). `POST /api/auth/password-reset/confirm` with `{ token, password }` returns `200 { ok: true }`, or `400 { error }` for a bad link or weak password (429 when throttled).

- [ ] **Step 1: Add the schemas (test first)**

Append to `packages/contracts/src/auth.test.ts` (add the two new names to its import from `./auth`):

```ts
describe("password reset schemas", () => {
  it("normalises the email on a reset request", () => {
    const r = PasswordResetRequestSchema.safeParse({ email: "  Asha@Gmail.com " });
    expect(r.success && r.data.email).toBe("asha@gmail.com");
  });
  it("applies the signup password rule on confirm", () => {
    const token = "x".repeat(43);
    expect(PasswordResetConfirmSchema.safeParse({ token, password: "short" }).success).toBe(false);
    expect(PasswordResetConfirmSchema.safeParse({ token, password: "correct-horse-battery" }).success).toBe(true);
  });
  it("rejects extra keys", () => {
    expect(PasswordResetRequestSchema.safeParse({ email: "a@b.com", role: "ADMIN" }).success).toBe(false);
  });
});
```

Run: `pnpm --filter @asm/contracts test`
Expected: FAIL, schemas not exported.

Append to `packages/contracts/src/auth.ts` (after `LoginSchema`):

```ts
export const PasswordResetRequestSchema = z.strictObject({ email });
// A base64url 32-byte token is 43 characters; the bounds only reject junk.
export const PasswordResetConfirmSchema = z.strictObject({
  token: z.string().min(32).max(128),
  password,
});
```

Check `packages/contracts/src/index.ts` re-exports `./auth` (it exports `RegisterSchema` today; if it lists names explicitly, add `PasswordResetRequestSchema, PasswordResetConfirmSchema`).

Run: `pnpm --filter @asm/contracts test`
Expected: PASS.

- [ ] **Step 2: Write the failing route tests**

`apps/web/src/app/api/auth/password-reset/flow.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(
    async (_input: { to: string; tokenId: string; name: string; resetUrl: string; ttlMinutes: number }) => ({ ok: true as const, id: "em" }),
  ),
  sendPasswordChangedEmail: vi.fn(async (_input: { to: string; userId: string; name: string; changedAt: Date }) => ({
    ok: true as const,
    id: "em",
  })),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { prisma } from "@asm/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { redis } from "@/lib/redis";
import { createSession } from "@/lib/session";
import { POST as confirmReset } from "./confirm/route";
import { POST as requestReset } from "./request/route";

const RUN = randomUUID();
const EMAIL = `reset-${RUN}@test.local`;
let userId = "";
let spentToken = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: EMAIL, passwordHash: await hashPassword("old-password-123"), firstName: "Asha" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { targetType: "User", action: "auth.password_reset", targetId: userId } });
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => {
  mail.sendPasswordResetEmail.mockClear();
  mail.sendPasswordChangedEmail.mockClear();
});

function call(handler: (req: NextRequest) => Promise<Response>, path: string, body: unknown) {
  return handler(
    new NextRequest(`http://localhost/api/auth/password-reset/${path}`, {
      method: "POST",
      // A fresh fake IP per request: no IP throttle carries across tests, and
      // a non-public IP skips the VPN lookup.
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID() },
      body: JSON.stringify(body),
    }),
  );
}

function tokenFromLastEmail(): string {
  const url = mail.sendPasswordResetEmail.mock.calls.at(-1)![0].resetUrl;
  return new URL(url).searchParams.get("token")!;
}

describe("password reset flow", () => {
  it("answers the same for an unknown email and sends nothing", async () => {
    const res = await call(requestReset, "request", { email: `nobody-${RUN}@test.local` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("emails a reset link to a registered user", async () => {
    const res = await call(requestReset, "request", { email: EMAIL.toUpperCase() });
    expect(res.status).toBe(200);
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const input = mail.sendPasswordResetEmail.mock.calls[0]![0];
    expect(input.to).toBe(EMAIL);
    expect(input.ttlMinutes).toBe(30);
    expect(input.resetUrl).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
  });

  it("refuses a password under 12 characters with the rule's own message", async () => {
    const res = await call(confirmReset, "confirm", { token: "x".repeat(43), password: "short" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/12 characters/);
  });

  it("resets the password, signs out every device and sends a notice", async () => {
    await createSession(userId, {});
    await call(requestReset, "request", { email: EMAIL });
    spentToken = tokenFromLastEmail();

    const res = await call(confirmReset, "confirm", { token: spentToken, password: "brand-new-password-1" });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(user.passwordHash, "brand-new-password-1")).toBe(true);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    expect(mail.sendPasswordChangedEmail).toHaveBeenCalledWith(expect.objectContaining({ to: EMAIL, userId }));
  });

  it("refuses a link that was already used", async () => {
    const res = await call(confirmReset, "confirm", { token: spentToken, password: "another-password-22" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/invalid or has expired/);
  });

  it("does not issue links for affiliate accounts", async () => {
    const email = `aff-${RUN}@test.local`;
    await prisma.user.create({ data: { email, passwordHash: "x", role: "AFFILIATE" } });
    const res = await call(requestReset, "request", { email });
    expect(res.status).toBe(200);
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @asm/web exec vitest run src/app/api/auth/password-reset`
Expected: FAIL with `Failed to resolve import "./confirm/route"`.

- [ ] **Step 3: Implement the request route**

`apps/web/src/app/api/auth/password-reset/request/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { PasswordResetRequestSchema } from "@asm/contracts";
import { PASSWORD_RESET_TTL_MS, findUserByEmail, issuePasswordResetToken } from "@asm/db";
import { childLogger } from "@asm/logger";
import { sendPasswordResetEmail } from "@asm/mail";
import { displayName } from "@asm/mail/templates";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { absoluteUrl } from "@/lib/site";

// The same answer whether or not the email has an account, so this route
// can't be used to find out who is registered.
const SENT = {
  ok: true,
  message: "If that email has an account, we've sent a reset link. Check your inbox.",
};

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const parsed = PasswordResetRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const { email } = parsed.data;

  // Per IP and per address: one alone lets a bot spray resets or flood one inbox.
  const okIp = await checkRateLimit(`rl:pwreset:ip:${ctx.ip}`, 10, 900);
  const okEmail = await checkRateLimit(`rl:pwreset:email:${email}`, 3, 3600);
  if (!okIp || !okEmail) {
    log.warn({ evt: "security.rate_limited", route: "password_reset" }, "password reset throttled");
    return NextResponse.json({ error: "Too many reset requests. Wait a while and try again." }, { status: 429 });
  }

  const user = await findUserByEmail(email);

  // Same VPN rule as login. Looked up first so a vpnExempt account is recognised.
  const guardInput = user
    ? { ip: ctx.ip, route: "password_reset", log, userId: user.id }
    : { ip: ctx.ip, route: "password_reset", log };
  if ((await checkNetwork(guardInput)).blocked) {
    return vpnBlockedResponse();
  }

  // Affiliate and admin accounts are managed from the admin panel, which has
  // its own reset. Only regular users reset by email.
  if (!user || user.role !== "USER") {
    log.info({ evt: "auth.password_reset_requested", found: false }, "reset requested for an unknown or managed email");
    return NextResponse.json(SENT);
  }

  const issued = await issuePasswordResetToken({ userId: user.id, ipAddress: ctx.ip });
  // Not awaited: the reply must not get slower when the account exists.
  void sendPasswordResetEmail({
    to: user.email,
    cid: ctx.cid,
    tokenId: issued.id,
    name: displayName(user),
    resetUrl: absoluteUrl(`/reset-password?token=${issued.token}`),
    ttlMinutes: PASSWORD_RESET_TTL_MS / 60_000,
  });
  log.info({ evt: "auth.password_reset_requested", userId: user.id }, "password reset link issued");
  return NextResponse.json(SENT);
}
```

- [ ] **Step 4: Implement the confirm route**

`apps/web/src/app/api/auth/password-reset/confirm/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { PasswordResetConfirmSchema } from "@asm/contracts";
import { resetPasswordWithToken } from "@asm/db";
import { childLogger } from "@asm/logger";
import { sendPasswordChangedEmail } from "@asm/mail";
import { displayName } from "@asm/mail/templates";
import { hashPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { SESSION_COOKIE } from "@/lib/session";

const INVALID_LINK = "This reset link is invalid or has expired. Request a new one.";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  if (!(await checkRateLimit(`rl:pwreset-confirm:ip:${ctx.ip}`, 10, 900))) {
    log.warn({ evt: "security.rate_limited", route: "password_reset_confirm" }, "password reset confirm throttled");
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 });
  }

  const parsed = PasswordResetConfirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // A weak password gets its own message; any other problem reads as a bad link.
    const issue = parsed.error.issues[0];
    const error = issue?.path[0] === "password" ? issue.message : INVALID_LINK;
    return NextResponse.json({ error }, { status: 400 });
  }

  // Hash before touching the token, so a bad link costs the same as a good one.
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await resetPasswordWithToken({ token: parsed.data.token, passwordHash, ipAddress: ctx.ip });
  if (!user) {
    log.info({ evt: "auth.password_reset_failed" }, "reset link invalid, used or expired");
    return NextResponse.json({ error: INVALID_LINK }, { status: 400 });
  }

  log.info({ evt: "auth.password_reset", userId: user.userId }, "password reset via email link");
  void sendPasswordChangedEmail({
    to: user.email,
    cid: ctx.cid,
    userId: user.userId,
    name: displayName(user),
    changedAt: new Date(),
  });

  const response = NextResponse.json({ ok: true });
  // Every session was just deleted; drop this browser's stale cookie too.
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
```

- [ ] **Step 5: Run the route tests**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/auth/password-reset && pnpm --filter @asm/web exec tsc --noEmit`
Expected: PASS (6 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src apps/web/src/app/api/auth/password-reset
git commit -m "feat(auth): forgot-password API — enumeration-safe request + single-use confirm"
```

---

### Task 8: Forgot / reset password pages

**Files:**
- Create: `apps/web/src/components/auth/Spinner.tsx`, `apps/web/src/app/(auth)/forgot-password/page.tsx`, `ForgotPasswordForm.tsx`, `apps/web/src/app/(auth)/reset-password/page.tsx`, `ResetPasswordForm.tsx`
- Modify: `apps/web/src/components/auth/PasswordInput.tsx:41-45`, `apps/web/src/app/(auth)/login/LoginForm.tsx`, `apps/web/src/app/(auth)/login/page.tsx`, `apps/web/src/app/robots.ts:23`

**Interfaces:**
- Consumes: Task 7 routes.
- Produces: `/forgot-password`, `/reset-password?token=…`, and `/login?reset=1` (shows a success notice).

- [ ] **Step 1: Extract the spinner**

`apps/web/src/components/auth/Spinner.tsx`:

```tsx
export function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
```

In `LoginForm.tsx`, delete the local `function Spinner() {...}` at the bottom and add `import { Spinner } from "@/components/auth/Spinner";`.

- [ ] **Step 2: Make "Forgot password?" a real link**

In `apps/web/src/components/auth/PasswordInput.tsx`, add `import Link from "next/link";` and replace the `<a href="#" ...>Forgot password?</a>` element with:

```tsx
          <Link href="/forgot-password" className="text-[11px] font-semibold text-ink-3 hover:text-brand">
            Forgot password?
          </Link>
```

- [ ] **Step 3: Forgot-password page**

`apps/web/src/app/(auth)/forgot-password/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
```

`apps/web/src/app/(auth)/forgot-password/ForgotPasswordForm.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailInput } from "@/components/auth/EmailInput";
import { Spinner } from "@/components/auth/Spinner";

const PRIMARY =
  "mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-sm font-black text-brand-ink shadow-[0_20px_50px_-20px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (res.ok) setSent(data.message ?? "If that email has an account, we've sent a reset link.");
    else setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  return (
    <AuthShell
      eyebrow="Forgot password"
      title="Reset your password."
      subtitle="Enter the email you signed up with and we'll send you a link to set a new password."
      imageCaption="Every tick settles on a real ledger."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Log in
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <div role="status" className="rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-sm text-up">
            {sent}
          </div>
          <p className="text-sm text-ink-2">
            The link works for 30 minutes. Not in your inbox? Check your spam folder, or send it again.
          </p>
          <button
            type="button"
            onClick={() => setSent(null)}
            className="inline-flex h-11 items-center justify-center rounded-full border border-rule text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
          >
            Send it again
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
          <EmailInput value={email} onChange={setEmail} autoFocus />
          {error ? (
            <div role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-sm text-down">
              {error}
            </div>
          ) : null}
          <button type="submit" disabled={busy || !email} className={PRIMARY}>
            {busy ? (
              <>
                <Spinner /> Sending…
              </>
            ) : (
              <>
                Send reset link <span aria-hidden>→</span>
              </>
            )}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
```

- [ ] **Step 4: Reset-password page**

`apps/web/src/app/(auth)/reset-password/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Set a new password", robots: { index: false, follow: false } };
// The token arrives in the query string; never prerender this page.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={typeof token === "string" ? token : ""} />;
}
```

`apps/web/src/app/(auth)/reset-password/ResetPasswordForm.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Spinner } from "@/components/auth/Spinner";

const PRIMARY =
  "mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-sm font-black text-brand-ink shadow-[0_20px_50px_-20px_color-mix(in_srgb,var(--color-brand)_60%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The token stays in React state; take it out of the address bar and history.
  useEffect(() => {
    if (token) window.history.replaceState(null, "", "/reset-password");
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 12) return setError("Use at least 12 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (res.ok) {
      router.push("/login?reset=1");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Something went wrong. Try again.");
    setBusy(false);
  }

  const footer = (
    <>
      Link not working?{" "}
      <Link href="/forgot-password" className="font-semibold text-brand hover:underline">
        Get a new one
      </Link>
    </>
  );

  if (!token) {
    return (
      <AuthShell
        eyebrow="Reset password"
        title="This link is incomplete."
        subtitle="Open the link from your email again, or request a new one."
        imageCaption="Every tick settles on a real ledger."
        footer={footer}
      >
        <Link href="/forgot-password" className={PRIMARY}>
          Request a new link <span aria-hidden>→</span>
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Set a new password."
      subtitle="Choose a password you don't use anywhere else. You'll be signed out on every device."
      imageCaption="Every tick settles on a real ledger."
      footer={footer}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          required
          minLength={12}
          autoComplete="new-password"
          placeholder="At least 12 characters"
          showStrength
        />
        <PasswordInput
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          required
          minLength={12}
          autoComplete="new-password"
          placeholder="Type it again"
        />
        {error ? (
          <div role="alert" className="rounded-lg border border-down/40 bg-down/10 px-3 py-2.5 text-sm text-down">
            {error}
          </div>
        ) : null}
        <button type="submit" disabled={busy || !password || !confirm} className={PRIMARY}>
          {busy ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            <>
              Save new password <span aria-hidden>→</span>
            </>
          )}
        </button>
      </form>
    </AuthShell>
  );
}
```

- [ ] **Step 5: Post-reset notice on the login page**

`apps/web/src/app/(auth)/login/page.tsx`: change the `searchParams` type to `Promise<{ error?: string; reset?: string }>`, destructure `const { error, reset } = await searchParams;`, and render:

```tsx
  return (
    <LoginForm
      googleEnabled={googleSignInEnabled()}
      googleError={error === "google"}
      notice={reset === "1" ? "Password updated. Log in with your new password." : null}
    />
  );
```

`LoginForm.tsx`: change the signature to

```tsx
export function LoginForm({
  googleEnabled,
  googleError,
  notice,
}: {
  googleEnabled: boolean;
  googleError: boolean;
  notice: string | null;
}) {
```

and directly above `{error ? (` inside the form add:

```tsx
        {notice && !error ? (
          <div role="status" className="rounded-lg border border-up/40 bg-up/10 px-3 py-2.5 text-sm text-up">
            {notice}
          </div>
        ) : null}
```

- [ ] **Step 6: Keep the new pages out of search**

`apps/web/src/app/robots.ts`: after the `"/register",` line add:

```ts
        "/forgot-password",
        "/reset-password",
```

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter @asm/web exec tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 8: Browser check (no Resend key needed)**

With `RESEND_API_KEY` unset, the reset link is not emailed. Read it from the DB instead: the confirm route only needs the raw token, so issue one with a short script against the isolated DB:

```bash
cd packages/db && npx tsx -e 'import("./src/index").then(async ({ prisma, issuePasswordResetToken }) => { const u = await prisma.user.findFirstOrThrow({ where: { role: "USER" } }); const t = await issuePasswordResetToken({ userId: u.id }); console.log(u.email, "/reset-password?token=" + t.token); await prisma.$disconnect(); })'
```

Start the web dev server on the isolated DB (see memory `local-browser-verification`: a free port such as 3200, browse via `http://mail.localhost:3200`). Then check:
1. `/login` → click "Forgot password?" → lands on `/forgot-password`.
2. Submit any email → the green "If that email has an account…" panel shows; "Send it again" returns to the form.
3. Open the printed `/reset-password?token=…` → address bar drops the token; a mismatched confirm shows "The two passwords don't match."; a valid pair redirects to `/login?reset=1` with the green notice; logging in with the new password works.
4. Re-open the same token link → submitting shows "This reset link is invalid or has expired."
5. `/reset-password` with no token → "This link is incomplete." screen.
6. Phone width (375px): both forms fit with no horizontal scroll.

Take a screenshot of steps 2 and 3 for the PR.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/auth "apps/web/src/app/(auth)" apps/web/src/app/robots.ts
git commit -m "feat(auth): forgot-password and set-new-password pages; login shows post-reset notice"
```

---

### Task 9: Welcome email on signup

**Files:**
- Modify: `apps/web/src/app/api/auth/register/route.ts`, `apps/web/src/app/api/auth/google/callback/route.ts:85-88`
- Test: `apps/web/src/app/api/auth/register/route.test.ts` (new)

**Interfaces:**
- Consumes: `sendWelcomeEmail` (Task 3), `bonusPercentForDeposit` (`@asm/db`, already exported).

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/api/auth/register/route.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({
  sendWelcomeEmail: vi.fn(
    async (_input: { to: string; userId: string; name: string; firstDepositBonusPercent: number }) => ({ ok: true as const, id: "em" }),
  ),
}));
// Partial mock: keep the real exports (@asm/db imports other senders from it).
vi.mock("@asm/mail", async (importOriginal) => ({ ...(await importOriginal<typeof import("@asm/mail")>()), ...mail }));

import { prisma } from "@asm/db";
import { redis } from "@/lib/redis";
import { POST } from "./route";

const RUN = randomUUID();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(() => mail.sendWelcomeEmail.mockClear());

function register(email: string) {
  return POST(
    new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": randomUUID() },
      body: JSON.stringify({ name: "Asha Rao", email, password: "correct-horse-battery" }),
    }),
  );
}

describe("register welcome email", () => {
  it("welcomes a new account by first name with the first-deposit bonus", async () => {
    const email = `welcome-${RUN}@test.local`;
    const res = await register(email);
    expect(res.status).toBe(201);
    const { userId } = (await res.json()) as { userId: string };
    expect(mail.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: email, userId, name: "Asha", firstDepositBonusPercent: 100 }),
    );
  });

  it("sends nothing when the email is already registered", async () => {
    const email = `dupe-${RUN}@test.local`;
    await register(email);
    mail.sendWelcomeEmail.mockClear();
    expect((await register(email)).status).toBe(409);
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @asm/web exec vitest run src/app/api/auth/register`
Expected: FAIL, `sendWelcomeEmail` was not called.

- [ ] **Step 2: Send it from both signup paths**

`apps/web/src/app/api/auth/register/route.ts`: change `import { findUserByEmail, prisma } from "@asm/db";` to `import { bonusPercentForDeposit, findUserByEmail, prisma } from "@asm/db";`, add `import { sendWelcomeEmail } from "@asm/mail";`, and after `log.info({ evt: "auth.register", userId: user.id }, "account created");` add:

```ts
  // Not awaited: signup must not wait on, or fail because of, mail.
  void sendWelcomeEmail({
    to: email,
    cid: ctx.cid,
    userId: user.id,
    name: firstName ?? name,
    firstDepositBonusPercent: bonusPercentForDeposit(1),
  });
```

`apps/web/src/app/api/auth/google/callback/route.ts`: add `bonusPercentForDeposit` to the `@asm/db` import, add `import { sendWelcomeEmail } from "@asm/mail";` and `import { displayName } from "@asm/mail/templates";`. Inside `if (result.created) {`, after the `log.info(...)` line, add:

```ts
    void sendWelcomeEmail({
      to: profile.email,
      cid: ctx.cid,
      userId: result.userId,
      name: profile.givenName ?? displayName({ email: profile.email }),
      firstDepositBonusPercent: bonusPercentForDeposit(1),
    });
```

- [ ] **Step 3: Run the tests and typecheck**

Run: `pnpm --filter @asm/web exec vitest run src/app/api/auth/register && pnpm --filter @asm/web exec tsc --noEmit`
Expected: PASS (2 tests), no type errors. If `profile.givenName` is typed `string | null`, `??` already covers it. If it is `string | undefined`, same.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/auth/register "apps/web/src/app/api/auth/google/callback/route.ts"
git commit -m "feat(auth): welcome email on signup (email and Google)"
```

---

### Task 10: Env docs, sample sender and runbook

**Files:**
- Modify: `.env.example` (Resend block, ~lines 77-82)
- Create: `packages/mail/scripts/send-samples.ts`, `docs/email.md`

- [ ] **Step 1: Document the env vars**

Replace the Resend block in `.env.example` with:

```bash
# Resend — transactional email. Sends: welcome (signup), password-reset link,
# "password changed" notice, deposit credited, withdrawal requested, withdrawal
# paid (reward certificate) and withdrawal rejected. Until RESEND_API_KEY is
# set the app runs unchanged and skips sending. RESEND_FROM must be on a domain
# verified in Resend; Resend's onboarding@resend.dev sandbox only delivers to
# the Resend account owner's own inbox. BOTH web and engine read these, because
# deposits are credited in both processes. Runbook: docs/email.md.
RESEND_API_KEY=""
RESEND_FROM="IndianxTrade <no-reply@indianxtrade.com>"
RESEND_REPLY_TO="support@indianxtrade.com"
```

- [ ] **Step 2: Sample sender**

`packages/mail/scripts/send-samples.ts`:

```ts
/**
 * Sends one sample of every email to a single inbox, to check Resend config
 * and rendering with real credentials. Reads RESEND_* from the root .env.
 *
 *   pnpm --filter @asm/mail samples -- you@example.com
 */
import { sendEmail } from "../src/send";
import {
  depositCreditedEmail,
  formatDateLabel,
  formatDateTimeLabel,
  passwordChangedEmail,
  passwordResetEmail,
  siteUrl,
  welcomeEmail,
  withdrawalPaidEmail,
  withdrawalRejectedEmail,
  withdrawalRequestedEmail,
  type RenderedEmail,
} from "../src/templates";

const to = process.argv.slice(2).find((a) => a.includes("@"));
if (!to) {
  console.error("Usage: pnpm --filter @asm/mail samples -- you@example.com");
  process.exit(1);
}

const today = formatDateLabel(new Date());
const samples: Array<[string, RenderedEmail]> = [
  ["welcome", welcomeEmail({ name: "Asha", firstDepositBonusPercent: 100 })],
  ["password_reset", passwordResetEmail({ name: "Asha", resetUrl: siteUrl("/reset-password?token=sample-not-a-real-token"), ttlMinutes: 30 })],
  ["password_changed", passwordChangedEmail({ name: "Asha", changedAtLabel: formatDateTimeLabel(new Date()), resetUrl: siteUrl("/forgot-password") })],
  ["deposit_credited", depositCreditedEmail({ name: "Asha", creditLabel: "₹5,000.00", bonusLabel: "₹5,000.00", totalLabel: "₹10,000.00", dateLabel: today, refId: "D41C09AA" })],
  ["withdrawal_requested", withdrawalRequestedEmail({ name: "Asha", amountLabel: "₹2,500.00", payToLabel: "UPI · asha@okhdfc", held: false, refId: "8F3A21C9" })],
  ["withdrawal_paid", withdrawalPaidEmail({ certificate: { name: "Asha Rao", amountLabel: "₹2,500.00", dateLabel: today, refId: "8F3A21C9" }, payToLabel: "UPI · asha@okhdfc" })],
  ["withdrawal_rejected", withdrawalRejectedEmail({ name: "Asha", amountLabel: "₹2,500.00", reason: "The UPI ID couldn't receive the payment", refId: "8F3A21C9" })],
];

for (const [tag, email] of samples) {
  const result = await sendEmail({ to, subject: `[sample] ${email.subject}`, html: email.html, tag });
  console.log(tag.padEnd(22), JSON.stringify(result));
  // Stay under Resend's per-second rate limit.
  await new Promise((resolve) => setTimeout(resolve, 600));
}
```

- [ ] **Step 3: Runbook**

`docs/email.md`:

```markdown
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

1. Resend dashboard → Domains → Add `indianxtrade.com` (region closest to users).
2. Add every DNS record Resend shows: DKIM `TXT` (`resend._domainkey`), the sending `CNAME`s (`send`, `rsend`) and DMARC `TXT` (`_dmarc`). On Cloudflare set the CNAMEs to DNS only (grey cloud). Click Verify and wait for **Verified**.
3. API Keys → create a key with **Sending access** for that domain only.
4. `RESEND_FROM="IndianxTrade <no-reply@indianxtrade.com>"`.

Until the domain is verified, only `onboarding@resend.dev` works and it delivers only to the Resend account owner's inbox.

## Check it locally

Put the three vars in the root `.env`, then:

    pnpm --filter @asm/mail samples -- you@yourdomain.com

Each line prints `{"ok":true,"id":"…"}` on success. A `403` means the from-domain isn't verified. A `422` usually means a malformed `RESEND_FROM`.

## Production

Add the vars to `/opt/asmtrader/.env.production` **before** merging the deploy, then recreate both services so they re-read env:

    docker compose --env-file ../.env.production up -d --force-recreate --no-deps web engine

Verify with `docker compose logs web engine | grep '"evt":"mail.'`.
```

- [ ] **Step 4: Commit**

```bash
git add .env.example packages/mail/scripts/send-samples.ts docs/email.md
git commit -m "docs(mail): env vars, sample sender and Resend runbook"
```

---

### Task 11: Full test pass, PR, and live check with real Resend envs

This task needs the user's `RESEND_API_KEY` (and the verified `RESEND_FROM` domain). Steps 1–2 don't.

- [ ] **Step 1: Run everything**

Run (Test environment vars exported): `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. Under vitest no email is sent.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin claude/resend-email
```

```bash
gh pr create --title "feat: Resend transactional email — reset password, deposit, withdrawal certificate, welcome" --body-file /tmp/pr-body.md
```

The PR body lists the seven emails and triggers (copy the table from `docs/email.md`). It also notes the new migration `20261010120000_password_reset_tokens` and the env vars to add to `.env.production` before merge, and includes the Task 8 screenshots. End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 3: Live check with the user's envs (local)**

1. Put `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO` in the root `.env`.
2. `pnpm --filter @asm/mail samples -- <user's inbox>` → 7 × `{"ok":true,...}`. Open each in Gmail web + Gmail mobile. Check: dark card renders, gold wordmark, button works, certificate readable, not in spam.
3. End-to-end on the isolated DB with a user whose email is the user's real inbox (reserved test domains are skipped by design):
   - `/forgot-password` → email arrives → link → set new password → "Password changed" email arrives → old sessions logged out.
   - Create a deposit and approve it in `/admin/deposits` → "Deposit credited" email shows amount, bonus and total.
   - Request a withdrawal → "request received" email. Admin Approve → Mark paid → certificate email. A second withdrawal → Reject → rejection email with the reason.
   - Resend dashboard → Emails: each shows its `category` tag and Delivered.

- [ ] **Step 4: Production (after the user approves)**

Add the three vars to `.env.production` on the VPS *before* merging (see the `vps-access` memory for the idempotent `sed` append), merge the PR (the user clicks Merge), let the deploy run the migration, then:

```bash
docker compose --env-file ../.env.production up -d --force-recreate --no-deps web engine
```

Check `docker compose logs web engine | grep '"evt":"mail.'` while doing one real forgot-password on prod.

---

## Self-review notes

- **Spec coverage:** reset link 30 min single-use + sign-out-everywhere (Tasks 6–8). Deposit amount + bonus + total, sent only after credit, covering every credit path (Task 4). Withdrawal received at request, certificate on Paid, rejection with reason (Task 5). Welcome on both signup paths (Task 9). Env check with real keys (Tasks 10–11). 2FA email and PDF attachment are deliberately out of scope.
- **Not touched on purpose:** the in-app certificate on the withdrawal success screen still appears at request time (only its footer wording changed from "original deposit method" to "chosen payout method"). The ProfileForm "codes are written to the server log" note stays, since 2FA email is out of scope.
- **Known limitation:** sends are fire-and-forget, not a durable outbox. If Resend is down beyond the one retry, that email is lost (logged as `mail.failed`). If that matters later, add an `EmailOutbox` table drained by the engine; the idempotency keys already make that safe.
