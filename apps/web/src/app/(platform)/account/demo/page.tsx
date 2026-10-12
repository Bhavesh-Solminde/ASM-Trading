import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listAccountsForActor, demoBalanceCap, formatMoney } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { DemoBalanceForm } from "../DemoBalanceForm";

export const dynamic = "force-dynamic";

export default async function DemoBalancePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const accounts = await listAccountsForActor(session.userId);
  const demo = accounts.find((a) => a.type === "DEMO");
  if (!demo) redirect("/account");

  return (
    <PageFrame width="narrow" title="Demo balance" back={{ href: "/account", label: "Account" }}>
      <DemoBalanceForm
        accountId={demo.id}
        currency={demo.currency}
        currentLabel={formatMoney(demo.realBalance, demo.currency)}
        capMinor={demoBalanceCap(demo.currency)}
        capLabel={formatMoney(demoBalanceCap(demo.currency), demo.currency)}
      />
    </PageFrame>
  );
}
