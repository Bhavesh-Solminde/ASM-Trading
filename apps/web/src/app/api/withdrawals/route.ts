import { NextResponse, type NextRequest } from "next/server";
import { CreateWithdrawalSchema, payoutDestinationKey } from "@asm/contracts";
import {
  WithdrawalRefused,
  formatMoney,
  getAccountForActor,
  listWithdrawalsForActor,
  loadProfile,
  requestWithdrawal,
  withdrawableBalance,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { certificateHtml, certificateName, type CertificateData } from "@/lib/certificate";
import { sendEmail } from "@/lib/mail";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if ((await checkNetwork({ ip: ctx.ip, route: "withdrawals", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }

  // Parity with the deposit route — a money-moving request a human never fires
  // in bursts. Keeps a bot from flooding the admin payout queue.
  if (!(await checkRateLimit(`rl:withdraw:${session.userId}`, 10, 300))) {
    log.warn({ evt: "security.rate_limited", route: "withdrawals" }, "withdrawal throttled");
    return NextResponse.json(
      { error: "Too many withdrawal attempts. Wait a few minutes." },
      { status: 429 },
    );
  }

  const parsed = CreateWithdrawalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // Surface the first field message ("Enter a valid IFSC code…") so the user
    // knows what to fix; the form validates the same rules before submitting.
    const first = parsed.error.issues[0]?.message;
    return NextResponse.json(
      { error: first && !first.startsWith("Invalid") ? first : "Check the withdrawal details." },
      { status: 400 },
    );
  }

  try {
    const withdrawal = await requestWithdrawal({
      actorId: session.userId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      accountId: parsed.data.accountId,
      amount: parsed.data.amount,
      payout: parsed.data.payout,
      destinationKey: payoutDestinationKey(parsed.data.payout),
    });

    // Build the reward certificate and (when Resend is configured) email it.
    // Currency comes from the account; email/name from the profile. A mail
    // failure never fails the withdrawal — the request is already recorded.
    const [account, profile] = await Promise.all([
      getAccountForActor(session.userId, parsed.data.accountId),
      loadProfile(session.userId),
    ]);
    const certificate: CertificateData = {
      name: certificateName(profile),
      amountLabel: formatMoney(parsed.data.amount, account?.currency ?? "INR"),
      dateLabel: new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date()),
      refId: withdrawal.id,
    };
    let emailed = false;
    try {
      const sent = await sendEmail({
        to: profile.email,
        subject: "Your IndianxTrade withdrawal certificate",
        html: certificateHtml(certificate),
        cid: ctx.cid,
      });
      emailed = sent.ok;
    } catch (mailErr) {
      log.warn({ evt: "withdrawal.mail_failed", err: String(mailErr) }, "certificate email failed");
    }

    return NextResponse.json(
      { id: withdrawal.id, status: withdrawal.status, certificate, emailed },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof WithdrawalRefused) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  // Ownership check first — never read balances for an account the caller
  // does not own (this closes an IDOR the original plan had).
  const account = await getAccountForActor(session.userId, accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({
    balance: await withdrawableBalance(accountId),
    withdrawals: await listWithdrawalsForActor(session.userId, 20),
  });
}
