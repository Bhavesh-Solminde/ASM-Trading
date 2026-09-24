import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { EmptyRow, Pager, SortableTh, StatusPill } from "../../_components/ui";
import { avatarColor } from "../../_lib/format";
import { setAssetPayoutAction, toggleAssetOpenAction } from "./actions";

export const dynamic = "force-dynamic";

const PER_PAGE = 10;
const PATH = "/admin/markets";
const SORT_COLS = new Set(["symbol", "payoutPct", "isOpen", "createdAt"]);

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const q = sp.q?.trim() ?? "";
  const kind = sp.kind && sp.kind !== "all" ? sp.kind : undefined;
  const status = sp.status && sp.status !== "all" ? sp.status : undefined;
  const sort = sp.sort && SORT_COLS.has(sp.sort) ? sp.sort : "symbol";
  const dir: "asc" | "desc" = sp.dir === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.AssetWhereInput = {
    ...(kind ? { kind: kind as "OTC" } : {}),
    ...(status ? { isOpen: status === "open" } : {}),
    ...(q
      ? {
          OR: [
            { symbol: { contains: q, mode: "insensitive" } },
            { displayName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, assets] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy: { [sort]: dir },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
  ]);

  const spForLinks: Record<string, string | undefined> = {
    q: q || undefined,
    kind: sp.kind,
    status: sp.status,
    sort,
    dir,
  };

  return (
    <div className="admin-card">
      <div className="admin-toolbar">
        <TableControls
          searchKey="q"
          placeholder="Search symbol or name…"
          filters={[
            {
              param: "status",
              label: "Status",
              options: [
                { value: "all", label: "All status" },
                { value: "open", label: "Open" },
                { value: "paused", label: "Paused" },
              ],
            },
          ]}
        />
        <div className="admin-spacer" />
        <span className="admin-result-count">
          {total} market{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="admin-banner" style={{ margin: "14px 16px 0" }}>
        <StatusPill status="COMPLETED" />
        <span>
          Payout changes apply to new trades only — every open position settles on the terms it was
          opened at.
        </span>
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 4 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh label="Market" colKey="symbol" path={PATH} sp={spForLinks} />
              <th>Type</th>
              <SortableTh label="Payout" colKey="payoutPct" path={PATH} sp={spForLinks} align="right" />
              <th className="admin-num-right">Ref. price</th>
              <SortableTh label="Status" colKey="isOpen" path={PATH} sp={spForLinks} />
              <th style={{ textAlign: "right", minWidth: 260 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <EmptyRow cols={6} message="No markets match your filters." />
            ) : (
              assets.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div className="admin-cell-user">
                      <span
                        className="admin-avatar"
                        style={{ background: avatarColor(a.symbol), width: 30, height: 30, fontSize: 10 }}
                      >
                        {a.symbol.slice(0, 3)}
                      </span>
                      <div>
                        <div className="admin-cell-strong">{a.displayName}</div>
                        <div className="admin-cell-sub">{a.symbol}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={a.kind} />
                  </td>
                  <td className="num admin-num-right">{a.payoutPct}%</td>
                  <td className="num admin-num-right">{a.basePrice.toFixed(a.precision)}</td>
                  <td>
                    <span className={`admin-pill admin-pill--${a.isOpen ? "pos" : "warn"}`}>
                      {a.isOpen ? "Open" : "Paused"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      <form
                        action={setAssetPayoutAction}
                        style={{ display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <input type="hidden" name="assetId" value={a.id} />
                        <input
                          name="payoutPct"
                          type="number"
                          min={1}
                          max={200}
                          defaultValue={a.payoutPct}
                          aria-label={`Payout percent for ${a.symbol}`}
                          className="admin-input num"
                          style={{ width: 68, padding: "6px 8px" }}
                        />
                        <button type="submit" className="admin-btn admin-btn--sm admin-btn--subtle">
                          Set %
                        </button>
                      </form>
                      <form action={toggleAssetOpenAction}>
                        <input type="hidden" name="assetId" value={a.id} />
                        <button
                          type="submit"
                          className={`admin-btn admin-btn--sm ${a.isOpen ? "admin-btn--danger" : "admin-btn--primary"}`}
                        >
                          {a.isOpen ? "Pause" : "Open"}
                        </button>
                      </form>
                    </div>
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
