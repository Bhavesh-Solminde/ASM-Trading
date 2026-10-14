import { NextResponse, type NextRequest } from "next/server";
import { CheckoutViewSchema } from "@asm/contracts";
import { getDepositByToken } from "@asm/db";
import { checkoutViewFor } from "@/lib/checkout-view";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const { token } = await params;
  const deposit = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await getDepositByToken(token) : null;
  // Someone else's deposit is indistinguishable from a missing one.
  if (!deposit || deposit.userId !== session.userId) {
    return NextResponse.json({ error: "Deposit not found.", code: "not_found" }, { status: 404 });
  }
  return noStoreJson(CheckoutViewSchema.parse(checkoutViewFor(deposit)));
}
