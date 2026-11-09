import { NextResponse, type NextRequest } from "next/server";
import { PaymentsPageSchema } from "@asm/contracts";
import { loadPaymentRows } from "@/components/history/load-payment-rows";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "20", 10) || 20, 1), 50);
  const rawCursor = params.get("cursor");
  let before: Date | undefined;
  if (rawCursor) {
    before = new Date(rawCursor);
    if (Number.isNaN(before.getTime())) {
      return NextResponse.json({ error: "Bad cursor.", code: "bad_request" }, { status: 400 });
    }
  }

  const rows = await loadPaymentRows(session.userId, limit, before);
  const last = rows.at(-1);
  return noStoreJson(
    PaymentsPageSchema.parse({
      rows,
      nextCursor: rows.length === limit && last ? new Date(last.createdAt).toISOString() : null,
    }),
  );
}
