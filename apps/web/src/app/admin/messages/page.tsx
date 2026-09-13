import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listRelayMessages } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; deviceLabel?: string }>;
}) {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");

  const params = await searchParams;
  const messages = await listRelayMessages(
    {
      ...(params.source ? { source: params.source } : {}),
      ...(params.deviceLabel ? { deviceLabel: params.deviceLabel } : {}),
    },
    200,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Incoming messages</h1>
        <a
          href="/admin/deposits"
          className="text-xs font-semibold text-[var(--color-ink-2)] underline underline-offset-4"
        >
          Deposits →
        </a>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-edge)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--color-panel)] text-[var(--color-ink-2)]">
            <tr>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">Sender</th>
              <th className="px-3 py-2">Body</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">UTR</th>
              <th className="px-3 py-2">Credit?</th>
              <th className="px-3 py-2">Matched?</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id} className="border-t border-[var(--color-edge)]">
                <td className="px-3 py-2 whitespace-nowrap">{m.receivedAt.toISOString()}</td>
                <td className="px-3 py-2">{m.source}</td>
                <td className="px-3 py-2">{m.deviceLabel ?? "—"}</td>
                <td className="px-3 py-2">{m.sender ?? "—"}</td>
                <td className="px-3 py-2 max-w-xs truncate" title={m.body}>{m.body}</td>
                <td className="px-3 py-2 tabular-nums">
                  {m.parsedAmountInr != null ? (m.parsedAmountInr / 100).toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2">{m.parsedUtr ?? "—"}</td>
                <td className="px-3 py-2">{m.isCredit === null ? "—" : m.isCredit ? "yes" : "no"}</td>
                <td className="px-3 py-2">{m.bankCreditId ? "→ credit" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {messages.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">No messages yet.</p>
      ) : null}
    </main>
  );
}
