import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEMO_VPA,
  createBankCreditIfNew,
  createRelayMessage,
  linkRelayMessageToCredit,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { matchCreditToDeposit } from "@/lib/deposit-matcher";
import { parseBankSms } from "@/lib/parse-bank-sms";
import { requestContext } from "@/lib/request-context";

const SOURCE = "sms-relay";

function authorised(header: string | null): boolean {
  const secret = process.env["SMS_RELAY_SECRET"] ?? "";
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
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
 * it turned into anything — an ignored promotional SMS is normal operation.
 */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

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

  if (!parsed || !parsed.isCredit) {
    log.info({ evt: "bankfeed.ignored", relayMessageId: relayMessage.id }, "message ignored");
    return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
  }

  const credit = await createBankCreditIfNew({
    vpa: DEMO_VPA,
    amountInr: parsed.amountInr,
    utr: parsed.utr ?? `no-utr-${Date.now()}`,
    receivedAt: relayMessage.receivedAt,
    raw: body.body,
  });

  if (!credit) {
    // Duplicate UTR — the relay's own retry logic can resend the same
    // message; this is normal, not an error.
    log.info(
      { evt: "bankfeed.duplicate", relayMessageId: relayMessage.id },
      "duplicate credit ignored",
    );
    return NextResponse.json({ accepted: true, matched: false }, { status: 202 });
  }

  await linkRelayMessageToCredit(relayMessage.id, credit.id);

  const outcome = await matchCreditToDeposit({
    creditId: credit.id,
    amountInr: credit.amountInr,
    utr: parsed.utr,
  });

  log.info(
    { evt: "bankfeed.matched", outcome: outcome.kind, relayMessageId: relayMessage.id },
    "credit processed",
  );

  return NextResponse.json(
    { accepted: true, matched: outcome.kind === "auto_approved" },
    { status: 202 },
  );
}
