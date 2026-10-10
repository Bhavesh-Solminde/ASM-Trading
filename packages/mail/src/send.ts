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
