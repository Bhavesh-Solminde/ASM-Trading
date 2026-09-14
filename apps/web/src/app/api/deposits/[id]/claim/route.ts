import { NextResponse, type NextRequest } from "next/server";
import { ClaimUtrSchema } from "@asm/contracts";
import { DepositNotFound, UtrAlreadyClaimed, claimUtr } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const parsed = ClaimUtrSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn(
      { evt: "security.validation_rejected", route: "deposit_claim" },
      "rejected utr claim payload",
    );
    return NextResponse.json(
      { error: "Enter the numeric reference from your payment app." },
      { status: 400 },
    );
  }

  try {
    // Ownership is enforced inside claimUtr, which takes the actor id.
    const deposit = await claimUtr(session.userId, id, parsed.data.utr);
    log.info(
      { evt: "deposit.utr_claimed", depositId: deposit.id, cid: deposit.correlationId },
      "utr claimed",
    );
    return NextResponse.json({ status: deposit.status });
  } catch (err) {
    if (err instanceof DepositNotFound) {
      log.warn(
        { evt: "security.authz_denied", route: "deposit_claim", depositId: id },
        "deposit does not belong to actor",
      );
      return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
    }
    if (err instanceof UtrAlreadyClaimed) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
