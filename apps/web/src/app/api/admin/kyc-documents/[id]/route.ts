import { NextResponse, type NextRequest } from "next/server";
import { loadKycDocumentImage } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

/**
 * Serves one KYC document image to the admin review page. Admin session only,
 * never cached anywhere — these are identity documents.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await readAdminSession(req.cookies.get(ADMIN_SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const { id } = await params;
  const image = await loadKycDocumentImage(id);
  if (!image) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return new NextResponse(image.data as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    },
  });
}
