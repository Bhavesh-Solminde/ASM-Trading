import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FAQ } from "@asm/contracts";
import { listTicketsForActor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PageFrame } from "@/components/shell/PageFrame";
import { Icon } from "@/components/shell/Icon";
import { TicketForm } from "./TicketForm";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-brand/10 text-brand" },
  ANSWERED: { label: "Answered", cls: "bg-up/10 text-up" },
  CLOSED: { label: "Closed", cls: "bg-tile text-ink-2" },
};

export default async function SupportPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const tickets = await listTicketsForActor(session.userId, 20);

  return (
    <PageFrame width="base" title="Help & support">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Frequently asked questions</h2>
        <div className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-panel">
          {FAQ.map((entry) => (
            <details key={entry.q} className="group">
              <summary className="flex cursor-pointer focus-visible:outline-offset-[-2px] list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>{entry.q}</span>
                <Icon
                  name="caret"
                  className="size-4 flex-none text-ink-2 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <p className="px-4 pb-4 text-sm leading-relaxed text-ink-2">{entry.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Contact support</h2>
        <TicketForm />
      </section>

      {tickets.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold tracking-tight">Your requests</h2>
          <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-panel">
            {tickets.map((t) => {
              const pill = STATUS_PILL[t.status] ?? { label: t.status, cls: "bg-tile text-ink-2" };
              return (
                <li
                  key={t.id}
                  className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="min-w-0 truncate font-semibold">{t.subject}</span>
                  <span
                    className={`flex-none rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${pill.cls}`}
                  >
                    {pill.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </PageFrame>
  );
}
