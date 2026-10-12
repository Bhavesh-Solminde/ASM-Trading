import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadProfile } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { KycFlow } from "./KycFlow";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const profile = await loadProfile(session.userId);

  return (
    <PageFrame
      width="narrow"
      title="Verify identity"
      back={{ href: "/account", label: "Account" }}
    >
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
    </PageFrame>
  );
}
