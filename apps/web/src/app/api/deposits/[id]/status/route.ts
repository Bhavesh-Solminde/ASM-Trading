import { NextResponse, type NextRequest } from "next/server";
import { findChainCreditById, findChainCreditForDepositDisplay, getDepositByToken } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Lightweight JSON status for the checkout page's client-side poller — only
 * a USDT deposit needs this (the UPI flow is a one-shot render; a chain
 * transfer genuinely takes time to confirm, unlike an instant SMS credit).
 * Never returns anything the poller couldn't otherwise see: the deposit's
 * own status plus its linked ChainCredit's finality/processing state, no
 * raw provider payloads, no other user's data.
 *
 * The dynamic segment is named [id] (not [token]) to match the sibling
 * claim/screenshot routes under api/deposits/[id]/ — Next.js requires every
 * route at the same path position to share one slug name. The value passed
 * in is actually the deposit's checkout token (the same opaque id the
 * checkout page's own URL uses), looked up the same way getDepositByToken
 * already does everywhere else in this route family.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:deposit-status:${session.userId}`, 60, 60))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id: checkoutToken } = await params;
  const deposit = await getDepositByToken(checkoutToken);
  // Ownership check folded into the same "not found" response as a missing
  // token — same pattern as claimUtr's DepositNotFound handling elsewhere in
  // this route family, so an authz failure is indistinguishable from a
  // genuinely missing deposit.
  if (!deposit || deposit.userId !== session.userId) {
    return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
  }

  // Linked only once credited; before that, fall back to the display-only
  // lookup so the poller can show detection/confirmation progress.
  const chainCredit = deposit.matchedChainCreditId
    ? await findChainCreditById(deposit.matchedChainCreditId)
    : deposit.network && deposit.tokenContract && deposit.receivingAddress && deposit.amountUsdtMinor != null
      ? await findChainCreditForDepositDisplay({
          network: deposit.network,
          tokenContract: deposit.tokenContract,
          receivingAddress: deposit.receivingAddress,
          amountUsdtMinor: deposit.amountUsdtMinor,
          depositCreatedAt: deposit.createdAt,
        })
      : null;

  return NextResponse.json(
    {
      status: deposit.status,
      chainCredit: chainCredit
        ? { finalityState: chainCredit.finalityState, processingStatus: chainCredit.processingStatus }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
