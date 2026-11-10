import type { NextRequest } from "next/server";
import { WithdrawalPrefillSchema } from "@asm/contracts";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";
import { loadWithdrawalPrefill } from "@/lib/withdrawal-prefill";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  return noStoreJson(WithdrawalPrefillSchema.parse(await loadWithdrawalPrefill(session.userId)));
}
