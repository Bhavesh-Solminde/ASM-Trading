import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { DepositFlow } from "@/components/deposit/DepositFlow";

export default async function DepositPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-10 phone:px-4 phone:py-5">
      <header>
        <h1 className="text-xl font-bold tracking-tight">Deposit</h1>
      </header>

      <DepositFlow />
    </main>
  );
}
