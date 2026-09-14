import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@asm/db";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/admin-session";
import { setAssetPayoutAction, toggleAssetOpenAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminAssetsPage() {
  const store = await cookies();
  const authed = await readAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!authed) redirect("/admin/login");

  const assets = await prisma.asset.findMany({ orderBy: { symbol: "asc" } });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">
          Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Assets</h1>
        <p className="mt-1 text-xs text-[var(--color-ink-2)]">
          Payout changes take effect for new trades only. Open positions settle on the terms they
          were opened at.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3"
          >
            <div className="min-w-[140px]">
              <p className="text-sm font-semibold">{asset.displayName}</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-ink-2)]">
                {asset.kind}
              </p>
            </div>

            <form action={setAssetPayoutAction} className="flex items-center gap-2">
              <input type="hidden" name="assetId" value={asset.id} />
              <input
                name="payoutPct"
                type="number"
                min={1}
                max={200}
                defaultValue={asset.payoutPct}
                className="w-20 rounded-md border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm tabular-nums"
              />
              <span className="text-xs text-[var(--color-ink-2)]">%</span>
              <button
                type="submit"
                className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-xs font-bold text-white"
              >
                Set payout
              </button>
            </form>

            <form action={toggleAssetOpenAction} className="ml-auto">
              <input type="hidden" name="assetId" value={asset.id} />
              <button
                type="submit"
                className="rounded-md border border-[var(--color-edge)] px-3 py-1.5 text-xs font-bold"
              >
                {asset.isOpen ? "Close" : "Open"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
