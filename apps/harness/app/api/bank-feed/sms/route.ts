import { NextRequest, NextResponse } from "next/server";
import { parseSms } from "@/lib/parseSms";

interface BankFeedSmsPayload {
  sender?: string;
  body?: string;
  receivedAt?: string;
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

  const parsed = parseSms(payload.body ?? "");

  console.log(
    `[bank-feed/sms] sender=${payload.sender ?? "?"} receivedAt=${payload.receivedAt ?? "?"} parsed=${JSON.stringify(parsed)}`,
  );

  return NextResponse.json({ accepted: true, parsed }, { status: 202 });
}
