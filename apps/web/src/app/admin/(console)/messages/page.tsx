import { listRelayMessages, prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { EmptyRow, Pager, StatusPill } from "../../_components/ui";
import { fmtDateTime, inrFromMinor } from "../../_lib/format";

export const dynamic = "force-dynamic";

const PER_PAGE = 15;
const PATH = "/admin/messages";

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

  const filtered = q
    ? all.filter((m) =>
        [m.body, m.sender, m.parsedUtr, m.deviceLabel].some((v) => v?.toLowerCase().includes(q)),
      )
    : all;

  const total = filtered.length;
  const rows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const spForLinks: Record<string, string | undefined> = { q: sp.q, source: sp.source };

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <TableControls
          searchKey="q"
          placeholder="Search body, sender, UTR…"
          filters={[
            {
              param: "source",
              label: "Source",
              options: [
                { value: "all", label: "All sources" },
                ...sources.map((s) => ({ value: s.source, label: s.source })),
              ],
            },
          ]}
        />
        <div className="admin-spacer" />
        <span className="admin-result-count">
          {total} message{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Source</th>
              <th>Sender</th>
              <th>Body</th>
              <th className="admin-num-right">Amount</th>
              <th>UTR</th>
              <th>Matched</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow cols={7} message="No messages match." />
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <td className="admin-cell-sub" style={{ whiteSpace: "nowrap" }}>
                    {fmtDateTime(m.receivedAt)}
                  </td>
                  <td>
                    <span className="admin-tag">{m.source}</span>
                    {m.deviceLabel ? (
                      <div className="admin-cell-sub" style={{ marginTop: 2 }}>
                        {m.deviceLabel}
                      </div>
                    ) : null}
                  </td>
                  <td className="admin-cell-sub">{m.sender ?? "—"}</td>
                  <td style={{ maxWidth: 280 }}>
                    <div
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={m.body}
                    >
                      {m.body}
                    </div>
                  </td>
                  <td className="num admin-num-right">
                    {m.parsedAmountInr != null ? inrFromMinor(m.parsedAmountInr) : "—"}
                  </td>
                  <td className="mono admin-cell-sub">{m.parsedUtr ?? "—"}</td>
                  <td>
                    {m.bankCreditId ? (
                      <StatusPill status="COMPLETED" />
                    ) : m.isCredit ? (
                      <span className="admin-pill admin-pill--warn">Unmatched</span>
                    ) : (
                      <span className="admin-pill admin-pill--muted">Not a credit</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
    </div>
  );
}
