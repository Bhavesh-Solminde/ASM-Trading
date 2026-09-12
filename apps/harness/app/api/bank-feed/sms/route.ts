import { NextRequest, NextResponse } from "next/server";
import { parseSms } from "@/lib/parseSms";
import { getSql } from "@/lib/db";

interface BankFeedSmsPayload {
  sender?: string;
  body?: string;
  receivedAt?: string;
  deviceLabel?: string;
  deviceModel?: string;
}

export async function POST(request: NextRequest) {
  const secret = process.env.SMS_RELAY_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let payload: BankFeedSmsPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  }

  const body = payload.body ?? "";
  const parsed = parseSms(body);

  try {
    const sql = getSql();
    await sql`
      insert into messages
        (device_label, device_model, sender, body, received_at, amount_inr, utr, is_credit)
      values (
        ${payload.deviceLabel ?? null},
        ${payload.deviceModel ?? null},
        ${payload.sender ?? ""},
        ${body},
        ${payload.receivedAt ?? new Date().toISOString()},
        ${parsed?.amountInr ?? null},
        ${parsed?.utr ?? null},
        ${parsed?.isCredit ?? null}
      )
    `;
  } catch (error) {
    console.error("[bank-feed/sms] failed to persist message", error);
    // Not 202/400 — the relay app retries on anything else, so a transient
    // DB outage doesn't silently drop the message.
    return NextResponse.json({ error: "Storage unavailable." }, { status: 500 });
  }

  return NextResponse.json({ accepted: true, parsed }, { status: 202 });
}
