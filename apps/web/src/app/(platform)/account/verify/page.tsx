import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadProfile } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { KycFlow } from "./KycFlow";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const profile = await loadProfile(session.userId);

  return (
    <main className="mx-auto w-full max-w-xl px-6 py-8 phone:px-4 phone:py-5">
      <Link href="/account" className="text-xs font-semibold text-ink-2 underline underline-offset-4">
        &lsaquo; My account
      </Link>
      <h1 className="mb-1 mt-3 text-xl font-semibold tracking-tight">Verify your identity</h1>
      <p className="mb-6 text-sm text-ink-2">
        Required once before your first withdrawal. Takes about 2 minutes — keep your Aadhaar and PAN card handy.
      </p>
      <KycFlow
        initialStatus={profile.kycStatus}
        initialDocuments={profile.kycDocuments}
        reviewNote={profile.kycReviewNote}
        initialDetails={{
          firstName: profile.firstName ?? "",
          lastName: profile.lastName ?? "",
          dateOfBirth: profile.dateOfBirth ?? "",
          aadhaar: profile.aadhaar ?? "",
          pan: profile.pan ?? "",
          address: profile.address ?? "",
          country: profile.country ?? "India",
        }}
      />
    </main>
  );
}
