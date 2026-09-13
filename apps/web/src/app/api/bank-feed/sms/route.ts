import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_VPA,
  createBankCreditIfNew,
  createRelayMessage,
  findBankCreditByUtr,
  linkRelayMessageToCredit,
  type BankCredit,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { matchCreditToDeposit } from "@/lib/deposit-matcher";
import { parseBankSms } from "@/lib/parse-bank-sms";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";

const SOURCE = "sms-relay";

// Machine-to-machine and legitimately busier than a human-facing endpoint
// (register: 5/hour, login: 20/5min) — generous enough for real SMS volume
// from a single companion device, but still a meaningful throttle.
const RATE_LIMIT = 30;
const RATE_WINDOW_SEC = 300;

function authorised(header: string | null): boolean {
  const secret = process.env["SMS_RELAY_SECRET"] ?? "";
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deterministic stand-in UTR for a credit-shaped SMS with no reference
 * number of its own. Must be a pure function of the message's own content
 * so that an identical retry (the relay's own documented behaviour) hashes
 * to the exact same value and collides on `BankCredit.utr`'s unique index —
 * that collision is the entire dedup mechanism Fix 1 depends on to
 * recognise "this is a retry of something already seen," not a fresh
 * credit. `receivedAt` must be the already-normalized Date (not the raw
 * request string) so retries with the same payload always match.
 */
function syntheticUtr(sender: string | null, body: string, receivedAt: Date): string {
  const hash = createHash("sha256")
    .update(`${sender ?? ""}|${body}|${receivedAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24);
  return `no-utr-${hash}`;
}

interface RelayedSmsBody {
  sender?: string;
  body?: string;
  receivedAt?: string;
  deviceLabel?: string;
  deviceModel?: string;
}

function isRelayedSmsBody(value: unknown): value is RelayedSmsBody {
  return typeof value === "object" && value !== null;
}

/**
 * Ingress for the companion app. Accepts a bank SMS the operator's own phone
 * forwarded, logs it unconditionally, parses it, and — for a credit — tries
 * to match it against a live deposit immediately.
 *
 * Always returns 202 for an authorised, well-formed request, whether or not
 * it turned into anything — an ignored promotional SMS is normal operation,
 * and so is a downstream processing hiccup the operator can already see and
 * fix via the admin panel's orphan queue and manual-match route. The relay
 * retries aggressively on anything else, so this handler must never 500 a
 * request it already durably logged.
 */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  // Rate-limit before authorising, so an attacker can't burn through Bearer
  // secret guesses without ever tripping the limiter.
  const okIp = await checkRateLimit(`rl:bank_feed_sms:ip:${ctx.ip}`, RATE_LIMIT, RATE_WINDOW_SEC);
  if (!okIp) {
    log.warn(
      { evt: "security.rate_limited", route: "bank_feed_sms" },
      "bank feed sms ingestion throttled",
    );
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  if (!authorised(req.headers.get("authorization"))) {
    log.warn(
      { evt: "security.authz_denied", route: "bank_feed_sms" },
      "unauthorised relay attempt",
    );
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  if (!isRelayedSmsBody(body) || typeof body.body !== "string") {
    return NextResponse.json({ error: "Malformed relay payload." }, { status: 400 });
  }

  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  const parsed = parseBankSms(body.body);

  let relayMessageId: string | undefined;

  try {
    const relayMessage = await createRelayMessage({
      source: SOURCE,
      deviceLabel: body.deviceLabel ?? null,
      deviceModel: body.deviceModel ?? null,
      sender: body.sender ?? null,
      body: body.body,
      receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
      parsedAmountInr: parsed?.amountInr ?? null,
      parsedUtr: parsed?.utr ?? null,
      isCredit: parsed?.isCredit ?? null,
    });
    relayMessageId = relayMessage.id;

    if (!parsed || !parsed.isCredit) {
      log.info({ evt: "bankfeed.ignored", relayMessageId }, "message ignored");
      return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
    }

    const utr = parsed.utr ?? syntheticUtr(body.sender ?? null, body.body, relayMessage.receivedAt);

    let credit: BankCredit | null = await createBankCreditIfNew({
      vpa: DEMO_VPA,
      amountInr: parsed.amountInr,
      utr,
      receivedAt: relayMessage.receivedAt,
      raw: body.body,
    });

    if (!credit) {
      // Unique-constraint hit on `utr` — either a genuine duplicate delivery
      // (the relay's own retry logic resends up to 3 times) or the
      // surviving half of an earlier request that crashed somewhere after
      // creating this row but before finishing. Distinguish by `consumed`:
      // if it was never fully applied, this request recovers it exactly
      // like a fresh credit (link + match again, harmlessly idempotent if
      // the first attempt actually did get that far); if it's already
      // consumed, an earlier attempt already finished the job.
      const existing = await findBankCreditByUtr(utr);
      if (!existing) {
        // Should not happen — P2002 on `utr` implies a row exists — but
        // fail informationally rather than throwing on a state that can't
        // be reasoned about.
        log.error(
          { evt: "bankfeed.duplicate_lookup_failed", relayMessageId },
          "createBankCreditIfNew reported a duplicate but no row was found for its utr",
        );
        return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
      }

      if (existing.consumed) {
        log.info(
          { evt: "bankfeed.duplicate", relayMessageId, bankCreditId: existing.id },
          "duplicate credit already fully processed",
        );
        return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
      }

      credit = existing;
    }

    await linkRelayMessageToCredit(relayMessage.id, credit.id);

    const outcome = await matchCreditToDeposit({
      creditId: credit.id,
      amountInr: credit.amountInr,
      utr: parsed.utr,
    });

    log.info(
      { evt: "bankfeed.matched", outcome: outcome.kind, relayMessageId },
      "credit processed",
    );

    return NextResponse.json(
      { accepted: true, matched: outcome.kind === "auto_approved" },
      { status: 202 },
    );
  } catch (err) {
    // The message was already durably logged (or the failure happened
    // before we even got that far) — surface it server-side for the
    // operator to diagnose via the admin panel, but don't make the relay
    // retry-storm a downstream hiccup it can't do anything about itself.
    log.error(
      { evt: "bankfeed.processing_error", relayMessageId, err },
      "unhandled error processing relay message",
    );
    return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
  }
}
