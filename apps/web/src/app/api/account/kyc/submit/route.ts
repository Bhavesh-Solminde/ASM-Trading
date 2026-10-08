import { NextResponse, type NextRequest } from "next/server";
import { loadProfile, submitKyc } from "@asm/db";
import { childLogger } from "@asm/logger";
import { requestContext } from "@/lib/request-context";
import { SESSION_COOKIE, readSession } from "@/lib/session";

/** Sends the user's details + documents for review (→ PENDING) once all are on file. */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const result = await submitKyc(session.userId);
  if (result.ok) {
    log.info({ evt: "kyc.submitted", userId: session.userId }, "kyc submitted for review");
    return NextResponse.json({ profile: await loadProfile(session.userId) });
  }
  if ("locked" in result) {
    return NextResponse.json({ error: "Your verification is already in review or approved." }, { status: 409 });
  }
  return NextResponse.json(
    {
      error: "Some details or documents are still missing.",
      missingFields: result.missingFields,
      missingDocuments: result.missingDocuments,
    },
    { status: 400 },
  );
}
