import { NextResponse, type NextRequest } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";

// Cloudinary auto-configures from CLOUDINARY_URL when it's set; this call is
// a no-op in that case and falls back to the explicit vars otherwise.
cloudinary.config({ secure: true });

const MAX_SCREENSHOT_BYTES = 5_000_000; // 5MB — server cap; client sanity-checks the same.
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface CloudinaryUploadResult {
  secure_url: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  // Enforce ownership + a live-deposit status BEFORE spending a Cloudinary
  // request. A claimed or resolved deposit rejects here without touching the
  // upload API.
  const deposit = await prisma.deposit.findFirst({
    where: {
      id,
      userId: session.userId,
      status: { in: ["AWAITING_PAYMENT", "PENDING_CONFIRMATION"] },
    },
    select: { id: true },
  });
  if (!deposit) {
    log.warn(
      { evt: "security.authz_denied", route: "deposit_screenshot", depositId: id },
      "deposit not open to actor",
    );
    return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the screenshot as multipart form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach a file under the field 'file'." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Attach a PNG, JPEG or WebP screenshot." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return NextResponse.json(
      { error: "Screenshot is too large — keep it under 5MB." },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // upload_stream is the SDK's non-blocking path — pipe the buffer in, then
  // resolve when Cloudinary returns the secure_url. Signed upload uses the
  // API key/secret in CLOUDINARY_URL; no upload preset is required.
  const uploaded = await new Promise<CloudinaryUploadResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "deposits",
        resource_type: "image",
        // Cloudinary will assign the public_id if we omit it; that keeps the
        // path unguessable so a leaked URL cannot be enumerated.
      },
      (err, result) => {
        if (err || !result) reject(err ?? new Error("Upload failed."));
        else resolve(result as CloudinaryUploadResult);
      },
    );
    stream.end(buffer);
  });

  log.info(
    { evt: "deposit.screenshot_uploaded", depositId: id },
    "screenshot uploaded to cloudinary",
  );

  return NextResponse.json({ url: uploaded.secure_url });
}
