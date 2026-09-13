import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export default async function Home() {
  const store = await cookies();
  if (await readSession(store.get(SESSION_COOKIE)?.value)) redirect("/trade");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
          Demonstration build — simulated, no real money
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">ASM Trade</h1>
      </div>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded-lg bg-[var(--color-up)] px-5 py-2.5 text-sm font-semibold text-[#06231a]"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-5 py-2.5 text-sm font-semibold"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
