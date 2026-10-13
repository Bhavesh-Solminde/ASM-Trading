import Link from "next/link";
import { listRelayMessages, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { EmptyRow, PageHead, Pager, Pill } from "../../_components/ui";
import { hrefWith, inrFromMinor } from "../../_lib/format";

export const dynamic = "force-dynamic";

const PER_PAGE = 15;
const PATH = "/admin/messages";
type Result = "matched" | "unmatched" | "unrecorded" | "other";

function receivedLabel(d: Date): string {
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return new Date().toDateString() === d.toDateString()
    ? `Today, ${time}`
    : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const q = sp.q?.trim().toLowerCase() ?? "";
  const source = sp.source && sp.source !== "all" ? sp.source : undefined;
  const page = Math.max(1, Number(sp.page) || 1);

  const [all, sources] = await Promise.all([
    listRelayMessages(source ? { source } : {}, 300),
    prisma.relayMessage.findMany({ distinct: ["source"], select: { source: true } }),
  ]);

  // A parsed credit becomes a BankCredit; it only reached a deposit if that
  // credit was consumed by a match. Look the page's credits up in one query.
  const creditIds = all.map((m) => m.bankCreditId).filter((v): v is string => !!v);
  const credits = creditIds.length
    ? await prisma.bankCredit.findMany({ where: { id: { in: creditIds } }, select: { id: true, consumed: true } })
    : [];
  const consumed = new Map(credits.map((c) => [c.id, c.consumed]));
  const resultOf = (m: (typeof all)[number]): Result =>
    m.bankCreditId ? (consumed.get(m.bankCreditId) ? "matched" : "unmatched") : m.isCredit ? "unrecorded" : "other";

  const show = sp.show === "unmatched" || sp.show === "other" ? sp.show : undefined;
  const searched = q
    ? all.filter((m) => [m.body, m.sender, m.parsedUtr, m.deviceLabel].some((v) => v?.toLowerCase().includes(q)))
    : all;
  const counts = {
    unmatched: searched.filter((m) => resultOf(m) === "unmatched" || resultOf(m) === "unrecorded").length,
    other: searched.filter((m) => resultOf(m) === "other").length,
  };
  const filtered = show
    ? searched.filter((m) => (show === "other" ? resultOf(m) === "other" : resultOf(m) === "unmatched" || resultOf(m) === "unrecorded"))
    : searched;

  const total = filtered.length;
  const rows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const spForLinks: Record<string, string | undefined> = { q: sp.q, source: sp.source, show };
  const devices = Array.from(new Set(all.map((m) => (m.deviceLabel ? `${m.source} (${m.deviceLabel})` : m.source))));
  const chip = (value: string | undefined, label: string, count: number) => (
    <Link
      key={label}
      href={hrefWith(PATH, spForLinks, { show: value ?? null, page: null })}
      className={`admin-chip${show === value ? " active" : ""}`}
    >
      {label}
      <span className="n">{count}</span>
    </Link>
  );

  return (
    <>
      <PageHead
        title="Bank messages"
        desc={`SMS forwarded by ${devices.length ? devices.join(", ") : "the relay phone"}. Credits are matched to deposits by UTR.`}
      />

      <section className="admin-card">
        <div className="admin-toolbar">
          <TableControls
            searchKey="q"
            placeholder="Search text, sender or UTR"
            filters={
              sources.length > 1
                ? [
                    {
                      param: "source",
                      label: "Source",
                      options: [
                        { value: "all", label: "All sources" },
                        ...sources.map((s) => ({ value: s.source, label: s.source })),
                      ],
                    },
                  ]
                : []
            }
          />
          {chip(undefined, "All", searched.length)}
          {chip("unmatched", "No matching deposit", counts.unmatched)}
          {chip("other", "Not a credit", counts.other)}
          <span className="admin-result-count">Newest first</span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <th>Received</th>
                <th>Message</th>
                <th className="admin-num-right">Amount</th>
                <th>UTR</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow cols={5} message="No messages match." />
              ) : (
                rows.map((m) => {
                  const r = resultOf(m);
                  return (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div>{receivedLabel(m.receivedAt)}</div>
                        <div className="admin-cell-sub">{m.sender ?? "Unknown sender"}</div>
                      </td>
                      <td style={{ maxWidth: 460, color: r === "other" ? "var(--admin-faint)" : "var(--admin-ink-2)", fontSize: 13, lineHeight: 1.45 }}>
                        {m.body}
                      </td>
                      <td className="admin-num-right">
                        {m.parsedAmountInr != null ? (
                          <span className="admin-amount">{inrFromMinor(m.parsedAmountInr)}</span>
                        ) : (
                          <span className="admin-cell-sub">—</span>
                        )}
                      </td>
                      <td>{m.parsedUtr ? <span className="mono">{m.parsedUtr}</span> : <span className="admin-cell-sub">—</span>}</td>
                      <td>
                        {r === "matched" ? (
                          <Pill tone="pos">Matched to a deposit</Pill>
                        ) : r === "unmatched" ? (
                          <Link href="/admin/deposits?tab=unmatched" style={{ textDecoration: "none" }}>
                            <Pill tone="warn">No matching deposit</Pill>
                          </Link>
                        ) : r === "unrecorded" ? (
                          <Pill tone="warn">Credit not recorded</Pill>
                        ) : (
                          <Pill tone="muted">Not a credit</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
      </section>
    </>
  );
}
