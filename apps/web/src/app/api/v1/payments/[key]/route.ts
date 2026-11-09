import { NextResponse, type NextRequest } from "next/server";
import { PaymentRowSchema, parsePaymentKey } from "@asm/contracts";
import { loadPaymentRow } from "@/components/history/load-payment-rows";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

/** The app sends the key percent-encoded (`d%3A<id>`); Next may or may not have decoded it. An undecodable one is just malformed. */
function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** One of the caller's own payments by its deep-link key (`d:<id>` | `w:<id>`), as the list returns it. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const key = decodeKey((await params).key);
  if (!parsePaymentKey(key)) return NextResponse.json({ error: "Bad payment key.", code: "bad_request" }, { status: 400 });

  const row = await loadPaymentRow(session.userId, key);
  // Someone else's payment is indistinguishable from a missing one.
  if (!row) return NextResponse.json({ error: "Payment not found.", code: "not_found" }, { status: 404 });
  return noStoreJson(PaymentRowSchema.parse(row));
}
