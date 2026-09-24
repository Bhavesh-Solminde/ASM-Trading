import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadProfile, listAccountsForActor, demoBalanceCap, formatMoney } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { ProfileForm } from "./ProfileForm";
import { DemoBalanceForm } from "./DemoBalanceForm";
import { SignOutSection } from "./SignOutSection";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [profile, accounts] = await Promise.all([
    loadProfile(session.userId),
    listAccountsForActor(session.userId),
  ]);
  const demo = accounts.find((a) => a.type === "DEMO");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8 phone:px-4 phone:py-5">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">My account</h1>
      <div className="grid gap-6">
        <ProfileForm initial={profile} />
        {demo ? (
          <DemoBalanceForm
            accountId={demo.id}
            currency={demo.currency}
            currentLabel={formatMoney(demo.realBalance, demo.currency)}
            capMinor={demoBalanceCap(demo.currency)}
            capLabel={formatMoney(demoBalanceCap(demo.currency), demo.currency)}
          />
        ) : null}
        <SignOutSection />
      </div>
    </main>
  );
}
