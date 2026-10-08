import { NextResponse, type NextRequest } from "next/server";
import { KYC_DOCUMENT_KINDS, KycLocked, saveKycDocument, type KycDocumentKind } from "@asm/db";
import { childLogger } from "@asm/logger";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { SESSION_COOKIE, readSession } from "@/lib/session";

// The client downsizes photos to a few hundred KB before upload; this cap is
// for the odd one that arrives as-is (e.g. canvas unsupported). The bytes are
// stored in Postgres, so keep it modest.
const MAX_BYTES = 8_000_000;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Uploads one KYC document (multipart: `kind`, `file`), replacing any earlier one of that kind. */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if ((await checkNetwork({ ip: ctx.ip, route: "kyc_document", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
  }

  if (!(await checkRateLimit(`rl:kyc-upload:${session.userId}`, 30, 3600))) {
    return NextResponse.json({ error: "Too many uploads. Try again in an hour." }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the photo as multipart form-data." }, { status: 400 });
  }

  const kind = String(form.get("kind") ?? "") as KycDocumentKind;
  if (!KYC_DOCUMENT_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a photo under the field 'file'." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Photo is too large — keep it under 8MB." }, { status: 413 });
  }

  try {
    await saveKycDocument(session.userId, kind, {
      contentType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (err) {
    // Locked mid-flow, e.g. submitted from another tab.
    if (err instanceof KycLocked) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }

  log.info({ evt: "kyc.document_uploaded", userId: session.userId, kind }, "kyc document uploaded");
  return NextResponse.json({ kind });
}
