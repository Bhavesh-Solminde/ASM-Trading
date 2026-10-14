import type { NextRequest } from "next/server";
import { DepositConfigSchema } from "@asm/contracts";
import { loadDepositConfig } from "@/lib/deposit-config";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();
  return noStoreJson(DepositConfigSchema.parse(await loadDepositConfig(session.userId)));
}
