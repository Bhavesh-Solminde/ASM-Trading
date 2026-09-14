import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FAQ } from "@asm/contracts";
import { listTicketsForActor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { TicketForm } from "./TicketForm";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const tickets = await listTicketsForActor(session.userId, 20);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
      <section>
        <h1 className="mb-4 text-lg font-semibold tracking-tight">Frequently asked questions</h1>
        <div className="flex flex-col gap-1">
          {FAQ.map((entry) => (
            <details
              key={entry.q}
              className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-3"
            >
              <summary className="cursor-pointer text-sm font-semibold">{entry.q}</summary>
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">{entry.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Contact support</h2>
        <TicketForm />
      </section>

      {tickets.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Your requests</h2>
          <ul className="flex flex-col gap-2">
            {tickets.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-3 text-sm"
              >
                <span className="font-semibold">{t.subject}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-2)]">
                  {t.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
