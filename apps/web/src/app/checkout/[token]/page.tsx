import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getDepositByToken } from "@asm/db";
import { UpiStatusPoller } from "./UpiStatusPoller";
import { DepositResult } from "./DepositResult";
import { UsdtStatusPoller } from "./UsdtStatusPoller";
import { usdtNetworkDisplay } from "@/lib/usdt-network-display";
import { buildUpiDeepLink } from "@/lib/upi";
import { upiCollection, upiManualClaimDelaySec } from "@/lib/upi-collection";

export const dynamic = "force-dynamic";

/**
 * Provider-style hosted checkout.
 *
 * Deliberately light-themed and visually unlike the platform — the handoff
 * to a provider-branded page is intentional.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deposit = await getDepositByToken(token);
  if (!deposit) notFound();

  const resolvedStatus =
    deposit.status === "COMPLETED" || deposit.status === "REJECTED" || deposit.status === "EXPIRED"
      ? deposit.status
      : null;

  const isUsdt = deposit.method === "USDT";
  // Payment-gateway deposit: a receiving address issued to this deposit
  // alone, matched by address — any amount at or above the request credits.
  const isGateway = isUsdt && deposit.gateway !== null;
  // Every network label/warning comes from the deposit's own stored network.
  const net = usdtNetworkDisplay(deposit.network);

  // A real UPI deep link to the VPA stored on this deposit (the collection
  // account configured when it was opened) — only relevant for the UPI-rail
  // methods. A USDT deposit's QR just encodes the bare
  // receiving address: no crypto deep-link scheme (tron:, etc.) is universal
  // enough across wallets to rely on, whereas a bare address is exactly what
  // any wallet's "scan to fill recipient" expects.
  const rupees = (deposit.amountInr / 100).toFixed(2);
  const usdtAmount = deposit.amountUsdtMinor != null ? (deposit.amountUsdtMinor / 100).toFixed(2) : "0.00";
  const collection = upiCollection();
  const upiUri = buildUpiDeepLink({
    vpa: deposit.vpa,
    payeeName: collection.payeeName,
    amountInr: deposit.amountInr,
    merchantCode: collection.merchantCode,
    note: `IXT-${deposit.id.slice(0, 8)}`,
  });

  const qrDataUri = await QRCode.toDataURL(isUsdt ? (deposit.receivingAddress ?? "") : upiUri, {
    width: 260,
    margin: 1,
    color: { dark: "#241436", light: "#ffffff" },
  });

  return (
    <main
      className="flex min-h-screen justify-center px-4 py-10"
      style={{ background: "#f6f4fb", color: "#241436" }}
    >
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/asm-logo.png" alt="IndianxTrade" className="h-7 w-7 rounded-lg object-cover" />
            <span className="text-lg font-bold" style={{ color: "#5b2d9e" }}>
              {deposit.method}
            </span>
          </span>
          <span className="text-xs font-semibold text-[#6b5a8a]">EN</span>
        </header>

        {resolvedStatus ? (
          <DepositResult deposit={deposit} status={resolvedStatus} token={token} />
        ) : isUsdt ? (
          <>
            <section className="rounded-xl bg-white p-6 text-center shadow-sm phone:p-5">
              <span className="inline-block rounded-full bg-[#5b2d9e] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Step 1
              </span>
              <h1 className="mt-3 text-sm font-bold" style={{ color: "#5b2d9e" }}>
                Send {net.assetLabel} to this address
              </h1>
              <p className="mt-2 text-3xl font-bold tabular-nums">{usdtAmount} USDT</p>
              {isGateway ? (
                <p className="mt-1 text-[11px] font-semibold text-[#6b5a8a]">
                  This address is unique to this deposit
                </p>
              ) : null}
              <p className="mt-2">
                <span className="inline-block rounded-full border border-[#5b2d9e]/30 bg-[#5b2d9e]/10 px-3 py-0.5 text-[11px] font-bold text-[#5b2d9e]">
                  Network: {net.shortLabel}
                </span>
              </p>
              {net.warning ? (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-[#c2410c]/30 bg-[#fff7ed] px-3 py-2 text-left text-xs font-semibold leading-relaxed text-[#9a3412]"
                >
                  {net.warning}
                </p>
              ) : null}
              <img
                src={qrDataUri}
                alt="Receiving address QR code"
                className="mx-auto mt-4 aspect-square h-auto w-full max-w-[260px]"
              />
            </section>

            <section className="rounded-xl bg-white p-5 shadow-sm">
              <div className="mb-3 text-center">
                <span className="inline-block rounded-full bg-[#5b2d9e] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Step 2
                </span>
              </div>
              <UsdtStatusPoller token={token} expiresAtMs={deposit.expiresAt.getTime()} />
            </section>

            <section className="rounded-xl bg-white p-5 text-center shadow-sm">
              <p className="text-xs font-bold" style={{ color: "#5b2d9e" }}>
                Or copy the address manually
              </p>
              <dl className="mt-3 flex flex-col gap-3 text-sm">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    Amount
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
                    Address
                  </dt>
                  <dd className="break-all font-mono text-xs">{deposit.receivingAddress}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-[#8a7aa8]">
                {isGateway ? (
                  <>
                    Send at least this amount, on the {net.label} network only.
                    Anything above it is credited too. A transfer on any other
                    network, or of a token other than USDT, may be unrecoverable.
                  </>
                ) : (
                  <>
                    Send this exact amount, on the {net.label} network only. A
                    different amount, or a transfer on any other network, cannot be
                    matched automatically and may be unrecoverable.
                  </>
                )}
              </p>
            </section>

            {isGateway ? null : (
            <p className="text-center">
              <a
                href={`/checkout/${token}/claim`}
                className="text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
              >
                Sent a different amount? Submit your transaction &rarr;
              </a>
            </p>
            )}
          </>
        ) : (
          <>
            <section className="rounded-xl bg-white p-6 text-center shadow-sm phone:p-5">
              <span className="inline-block rounded-full bg-[#5b2d9e] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                Step 1
              </span>
              <h1 className="mt-3 text-sm font-bold" style={{ color: "#5b2d9e" }}>
                Scan QR to pay
              </h1>
              <p className="mt-2 text-3xl font-bold tabular-nums">₹ {rupees}</p>
              <img
                src={qrDataUri}
                alt={`UPI payment QR code for ₹${rupees}`}
                className="mx-auto mt-4 aspect-square h-auto w-full max-w-[260px]"
              />
            </section>

            <p className="text-center text-xs font-semibold text-[#6b5a8a]">OR</p>

            <section className="rounded-xl bg-white p-5 text-center shadow-sm">
              <p className="text-xs font-bold" style={{ color: "#5b2d9e" }}>
                Open any app that allows UPI payments
              </p>
              <dl className="mt-3 flex flex-col gap-3 text-sm">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    Amount
                  </dt>
                  <dd className="tabular-nums">{rupees} INR</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-[#6b5a8a]">
                    UPI ID
                  </dt>
                  <dd className="break-all">{deposit.vpa}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-[#8a7aa8]">
                Pay this exact amount. The paise are what identify your payment — a
                different amount cannot be matched automatically.
              </p>
            </section>

            <UpiStatusPoller
              token={token}
              depositId={deposit.id}
              createdAtMs={deposit.createdAt.getTime()}
              revealAfterSec={upiManualClaimDelaySec()}
            />
          </>
        )}

        <p className="text-center text-[11px] text-[#8a7aa8]">
          Secure payment processing by IndianxTrade
        </p>
      </div>
    </main>
  );
}
