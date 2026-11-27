import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isKycRequired, loadProfile } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { ProfileForm } from "../ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [profile, kycRequired] = await Promise.all([loadProfile(session.userId), isKycRequired()]);

  return (
    <PageFrame width="narrow" title="Personal details" back={{ href: "/account", label: "Account" }}>
      <ProfileForm initial={profile} kycRequired={kycRequired} />
    </PageFrame>
  );
}
