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
        <h1
          className="text-5xl font-black tracking-wide text-[var(--color-brand)]"
          style={{ fontFamily: "var(--font-led)" }}
        >
          ASM
        </h1>
        <p className="mt-1 text-lg font-semibold text-[var(--color-ink-2)]">Trade</p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/register"
          className="rounded bg-[var(--color-up)] px-5 py-2.5 text-sm font-bold text-[var(--color-up-ink)]"
        >
          Create account
        </Link>
        <Link
          href="/login"
          className="rounded border border-[var(--color-rule)] bg-[var(--color-panel)] px-5 py-2.5 text-sm font-semibold"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
