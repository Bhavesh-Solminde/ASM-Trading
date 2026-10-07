import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDepositByToken } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { usdtNetworkDisplay } from "@/lib/usdt-network-display";
import { UsdtClaimForm } from "../UsdtClaimForm";

export const dynamic = "force-dynamic";

/**
 * "I already paid" for USDT: a transfer that couldn't be auto-matched (wrong
 * amount, or sent after the window closed) lands in the admin review queue.
 * This page lets the depositor attach their transaction hash so the admin can
 * see who it belongs to. It never credits anything by itself.
 *
 * Unlike the checkout page, this one requires a session and ownership — the
 * token may arrive via a query param on /deposit, so it must not be trusted
 * on its own.
 */
export default async function UsdtClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const { token } = await params;
  const deposit = await getDepositByToken(token);
  if (!deposit || deposit.userId !== session.userId || deposit.method !== "USDT") notFound();

  // Until the Prisma client is regenerated with the new column, the field
  // isn't on the type — read it defensively so this compiles either way.
  const existingTxHash =
    (deposit as { claimedTxHash?: string | null }).claimedTxHash ?? null;

  const net = usdtNetworkDisplay(deposit.network);
  // Claims are stored as bare lowercase hex; show an EVM hash the way the
  // user's wallet shows it (0x-prefixed) so it is recognisable.
  const shownTxHash =
    existingTxHash && deposit.network === "bsc" && !existingTxHash.startsWith("0x")
      ? `0x${existingTxHash}`
      : existingTxHash;

  const usdtAmount =
    deposit.amountUsdtMinor != null ? (deposit.amountUsdtMinor / 100).toFixed(2) : "0.00";

  return (
    <main
      className="flex min-h-screen justify-center px-4 py-10"
      style={{ background: "#f6f4fb", color: "#241436" }}
    >
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/indianxtrade-logo-light.png" alt="IndianxTrade" className="h-7 w-7 rounded-lg object-cover" />
            <span className="text-lg font-bold" style={{ color: "#5b2d9e" }}>
              USDT
            </span>
          </span>
          <span className="text-xs font-semibold text-[#6b5a8a]">EN</span>
        </header>

        {deposit.status === "COMPLETED" ? (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-semibold">This deposit is already credited.</p>
            <a
              href="/trade"
              className="mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
            >
              Back to trading
            </a>
          </div>
        ) : deposit.status === "REJECTED" ? (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-semibold">This deposit was closed — contact support.</p>
            <a
              href="/trade"
              className="mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
            >
              Back to trading
            </a>
          </div>
        ) : (
          <>
            <section className="rounded-xl bg-white p-6 text-center shadow-sm phone:p-5">
              <h1 className="text-sm font-bold" style={{ color: "#5b2d9e" }}>
                Submit your USDT transaction
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-[#6b5a8a]">
                Sent a different amount, or paid after the timer ran out? Paste
                your transaction hash and our team will match it to your
                account. Crediting is not instant.
              </p>
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    Reserved amount
                  </dt>
                  <dd className="tabular-nums">{usdtAmount} USDT</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    Network
                  </dt>
                  <dd>{net.shortLabel}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    Receiving address
                  </dt>
                  <dd className="break-all font-mono text-xs">{deposit.receivingAddress}</dd>
                </div>
              </dl>
              {net.warning ? (
                <p
                  role="note"
                  className="mt-4 rounded-lg border border-[#c2410c]/30 bg-[#fff7ed] px-3 py-2 text-left text-xs font-semibold leading-relaxed text-[#9a3412]"
                >
                  {net.warning}
                </p>
              ) : null}
            </section>

            <section className="rounded-xl bg-white p-5 shadow-sm">
              {existingTxHash ? (
                <div className="mb-4 rounded-lg bg-[#f6f1ff] p-3 text-center">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    Proof submitted
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-[#4b2d86]">
                    {shownTxHash}
                  </p>
                  <p className="mt-2 text-[11px] text-[#6b5a8a]">
                    Our team will review it. Wrong hash? Update your proof below.
                  </p>
                </div>
              ) : null}
              <UsdtClaimForm
                depositId={deposit.id}
                existingTxHash={existingTxHash}
                network={deposit.network}
              />
            </section>
          </>
        )}

        <p className="text-center text-[11px] text-[#8a7aa8]">
          Secure payment processing by IndianxTrade
        </p>
      </div>
    </main>
  );
}
