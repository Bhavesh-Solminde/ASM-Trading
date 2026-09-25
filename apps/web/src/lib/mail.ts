import { childLogger } from "@asm/logger";

/**
 * Minimal Resend client over its HTTP API — no SDK dependency. Sending is gated
 * on RESEND_API_KEY: until the key is provided the app runs exactly as before
 * and `sendEmail` reports `skipped` instead of failing. Server-only (reads the
 * secret key); only ever imported from route handlers.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true }
  | { ok: false; skipped: false; error: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  cid?: string;
}): Promise<SendResult> {
  const log = childLogger(input.cid ?? "mail");
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Not configured yet — the caller treats this as a no-op, never an error.
    log.info({ evt: "mail.skipped", reason: "no_api_key" }, "email not sent: RESEND_API_KEY unset");
    return { ok: false, skipped: true };
  }

  const from = process.env.RESEND_FROM ?? "ASM Trade <onboarding@resend.dev>";
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      log.warn({ evt: "mail.failed", status: res.status }, "resend rejected the message");
      return { ok: false, skipped: false, error: detail || `HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    log.info({ evt: "mail.sent", id: body.id }, "email sent");
    return { ok: true, id: body.id ?? null };
  } catch (err) {
    log.warn({ evt: "mail.error", err: String(err) }, "could not reach resend");
    return { ok: false, skipped: false, error: "network" };
  }
}
