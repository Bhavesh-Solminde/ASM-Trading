import { NextResponse, type NextRequest } from "next/server";
import { CreateWithdrawalSchema, payoutDestinationKey, payoutDestinationLabel } from "@asm/contracts";
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
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import { displayName, formatDateLabel, payToLabel, personName, shortRef, type CertificateData } from "@asm/mail/templates";
import { sendWithdrawalRequestedEmail } from "@asm/mail";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { getSession, unauthenticated } from "@/lib/request-session";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
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
      name: personName(profile),
      amountLabel,
      payToLabel: payToLabel(parsed.data.payout.method, payoutDestinationLabel(parsed.data.payout)),
      held: withdrawal.status === "HELD",
    });
    const emailed = sent.ok;

    return NextResponse.json(
      {
        id: withdrawal.id,
        status: withdrawal.status,
        certificate,
        emailed,
        // Fresh balance from the just-committed debit. The client pushes
        // this straight into PlatformProvider so the TopBar updates in
        // the same tick as the receipt — the engine doesn't know about
        // withdrawals, so there is no WebSocket `balance:update` coming
        // on its own.
        balance: account
          ? { realBalance: account.realBalance, bonusBalance: account.bonusBalance }
          : null,
      },
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
  const session = await getSession(req);
  if (!session) {
    return unauthenticated();
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
