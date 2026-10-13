import Link from "next/link";
import { prisma, type Prisma } from "@asm/db";
import { requireAdmin } from "@/lib/admin-auth";
import { TableControls } from "../../_components/TableControls";
import { EmptyRow, PageHead, Pager, SortableTh } from "../../_components/ui";
import { hrefWith } from "../../_lib/format";
import { PayoutStepper } from "./_components/PayoutStepper";
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

  const [total, assets, openGroups] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy: { [sort]: dir },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.asset.groupBy({ by: ["isOpen"], _count: { _all: true } }),
  ]);
  const openCount = openGroups.find((g) => g.isOpen)?._count._all ?? 0;
  const pausedCount = openGroups.find((g) => !g.isOpen)?._count._all ?? 0;

  const spForLinks: Record<string, string | undefined> = {
    q: q || undefined,
    kind: sp.kind,
    status: sp.status,
    sort,
    dir,
  };

  const chip = (value: string | undefined, label: string, count: number) => (
    <Link
      key={label}
      href={hrefWith(PATH, spForLinks, { status: value ?? null, page: null })}
      className={`admin-chip${status === value ? " active" : ""}`}
    >
      {label}
      <span className="n">{count}</span>
    </Link>
  );

  return (
    <>
      <PageHead
        title="Markets"
        desc={`${openCount + pausedCount} markets, ${pausedCount ? `${pausedCount} paused` : "all open"}. Payout changes apply to new trades only; open positions settle on the terms they were opened at.`}
      />

      <section className="admin-card">
        <div className="admin-toolbar">
          <TableControls searchKey="q" placeholder="Search symbol or name" />
          {chip(undefined, "All", openCount + pausedCount)}
          {chip("open", "Open", openCount)}
          {chip("paused", "Paused", pausedCount)}
          <span className="admin-result-count">{sort === "symbol" ? "A–Z" : "Sorted"}</span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-table--stack">
            <thead>
              <tr>
                <SortableTh label="Market" colKey="symbol" path={PATH} sp={spForLinks} />
                <SortableTh label="Payout" colKey="payoutPct" path={PATH} sp={spForLinks} />
                <th className="admin-num-right">Ref. price</th>
                <SortableTh label="Open for trading" colKey="isOpen" path={PATH} sp={spForLinks} />
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 ? (
                <EmptyRow cols={4} message="No markets match these filters." />
              ) : (
                assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="admin-cell-user">
                        <span className="admin-avatar" style={{ width: 32, height: 32, fontSize: 10 }}>
                          {a.symbol.slice(0, 3)}
                        </span>
                        <div>
                          <div className="admin-cell-strong" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {a.displayName}
                            <span className="admin-kind">{a.kind}</span>
                          </div>
                          <div className="admin-cell-sub">{a.symbol}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <PayoutStepper assetId={a.id} symbol={a.symbol} initial={a.payoutPct} action={setAssetPayoutAction} />
                    </td>
                    <td className="admin-num-right">
                      {a.basePrice.toLocaleString("en-US", {
                        minimumFractionDigits: a.precision,
                        maximumFractionDigits: a.precision,
                      })}
                    </td>
                    <td>
                      <form action={toggleAssetOpenAction}>
                        <input type="hidden" name="assetId" value={a.id} />
                        <button
                          type="submit"
                          role="switch"
                          aria-checked={a.isOpen}
                          aria-label={`${a.displayName} open for trading`}
                          title={a.isOpen ? "Open — click to pause" : "Paused — click to open"}
                          className={`admin-toggle${a.isOpen ? " on" : ""}`}
                        >
                          <span className="track" />
                          <span className="admin-toggle__txt">{a.isOpen ? "Open" : "Paused"}</span>
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pager total={total} page={page} perPage={PER_PAGE} path={PATH} sp={spForLinks} />
      </section>
    </>
  );
}
