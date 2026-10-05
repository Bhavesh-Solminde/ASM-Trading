import type { Deposit } from "@asm/db";
import { usdtNetworkDisplay } from "@/lib/usdt-network-display";

export type ResolvedDepositStatus = "COMPLETED" | "REJECTED" | "EXPIRED";

type ResultDeposit = Pick<
  Deposit,
  "id" | "method" | "network" | "gateway" | "amountInr" | "amountUsdtMinor"
>;

const PRIMARY_BUTTON =
  "mt-5 block w-full rounded-lg bg-[#5b2d9e] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#4b2d86] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2d9e]";
const SECONDARY_LINK =
  "mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4";

/**
 * The checkout page's terminal state — what a customer lands on the moment
 * UsdtStatusPoller reloads on a terminal status, and what anyone reopening
 * an old checkout link sees.
 *
 * Amounts: a USDT deposit shows amountUsdtMinor only. The gateway rewrites
 * it to what actually arrived on-chain, so an overpayment shows correctly,
 * while amountInr holds a negative uniqueness sentinel and amountUsd is 0
 * (see createUsdtDepositIntent) — never display either for USDT. Every other
 * method is an INR rail, where amountInr is exactly what was paid.
 */
export function DepositResult({
  deposit,
  status,
  token,
}: {
  deposit: ResultDeposit;
  status: ResolvedDepositStatus;
  token: string;
}) {
  const isUsdt = deposit.method === "USDT";
  const net = usdtNetworkDisplay(deposit.network);
  const reference = `ASM-${deposit.id.slice(0, 8)}`;

  const amount = isUsdt
    ? deposit.amountUsdtMinor != null && deposit.amountUsdtMinor > 0
      ? `${(deposit.amountUsdtMinor / 100).toFixed(2)} USDT`
      : null
    : `₹ ${(deposit.amountInr / 100).toFixed(2)}`;

  return (
    <>
      <section className="rounded-xl bg-white p-6 text-center shadow-sm phone:p-5">
        {status === "COMPLETED" ? (
          <>
            <StatusIcon kind="success" />
            <h1 className="mt-4 text-lg font-bold">Deposit credited</h1>
            {amount ? (
              <p className="mt-2 text-3xl font-bold tabular-nums">{amount}</p>
            ) : null}
            <p className="mt-1 text-[11px] font-semibold text-[#6b5a8a]">
              Added to your live account
            </p>
            <a href="/trade" className={PRIMARY_BUTTON}>
              Back to trading
            </a>
          </>
        ) : status === "REJECTED" ? (
          <>
            <StatusIcon kind="rejected" />
            <h1 className="mt-4 text-lg font-bold">Deposit not credited</h1>
            <p className="mt-2 text-xs leading-relaxed text-[#6b5a8a]">
              Our team reviewed this deposit and declined it, so nothing was
              added to your account. If you&rsquo;ve already paid, contact
              support and quote the reference below.
            </p>
            <a href="/support" className={PRIMARY_BUTTON}>
              Contact support
            </a>
            <a href="/trade" className={SECONDARY_LINK}>
              Back to trading
            </a>
          </>
        ) : (
          <>
            <StatusIcon kind="expired" />
            <h1 className="mt-4 text-lg font-bold">This deposit has expired</h1>
            <p className="mt-2 text-xs leading-relaxed text-[#6b5a8a]">
              {isUsdt ? (
                <>
                  The payment window closed before any payment was credited, so
                  nothing was added to your account. Don&rsquo;t send USDT to
                  this address &mdash; start a new deposit instead.
                </>
              ) : (
                <>
                  The payment window closed before any payment was credited, so
                  nothing was added to your account. Don&rsquo;t pay using this
                  QR code &mdash; start a new deposit instead.
                </>
              )}
            </p>
            <a href="/deposit" className={PRIMARY_BUTTON}>
              Start a new deposit
            </a>
            {/* A manual (shared-address) USDT deposit can still be claimed
                after expiry; a gateway one lands in admin review on its own. */}
            {isUsdt && deposit.gateway === null ? (
              <a href={`/checkout/${token}/claim`} className={SECONDARY_LINK}>
                Already sent it? Submit your transaction &rarr;
              </a>
            ) : (
              <a href="/support" className={SECONDARY_LINK}>
                {isUsdt
                  ? "Already sent it? Contact support with your transaction hash"
                  : "Already paid? Contact support with your UTR"}
              </a>
            )}
          </>
        )}
      </section>

      <section className="rounded-xl bg-white p-5 text-center shadow-sm">
        <dl className="flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
              Method
            </dt>
            <dd>{deposit.method}</dd>
          </div>
          {isUsdt ? (
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                Network
              </dt>
              <dd>{net.shortLabel}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
              Reference
            </dt>
            <dd className="font-mono text-xs">{reference}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

const ICON_STYLES = {
  success: "bg-[#e6f6ec] text-[#15803d]",
  rejected: "bg-[#fdecef] text-[#b8384c]",
  expired: "bg-[#fff7ed] text-[#c2410c]",
} as const;

function StatusIcon({ kind }: { kind: keyof typeof ICON_STYLES }) {
  return (
    <span
      className={`mx-auto flex size-12 items-center justify-center rounded-full ${ICON_STYLES[kind]}`}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === "success" ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : kind === "rejected" ? (
          <path d="M7 7l10 10M17 7L7 17" />
        ) : (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4.5l3 2" />
          </>
        )}
      </svg>
    </span>
  );
}
