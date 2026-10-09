import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getDepositByToken } from "@asm/db";
import { UpiStatusPoller } from "./UpiStatusPoller";
import { DepositResult } from "./DepositResult";
import { UsdtStatusPoller } from "./UsdtStatusPoller";
import { BackCancelGuard } from "./BackCancelGuard";
import { usdtNetworkDisplay } from "@/lib/usdt-network-display";
import { buildUpiDeepLink } from "@/lib/upi";
import { upiCollection, upiManualClaimDelaySec } from "@/lib/upi-collection";
import { GatewayIcon } from "@/components/deposit/GatewayIcon";
import { checkoutTheme } from "@/components/deposit/checkout-theme";

export const dynamic = "force-dynamic";

/**
 * Provider-style hosted checkout.
 *
 * Deliberately light-themed and visually unlike the platform — the handoff
 * to a provider-branded page is intentional. The palette shifts with the
 * chosen rail (PhonePe purple, Paytm blue, Gpay Google blue, UPI green,
 * USDT violet) so the page reads as the app the user picked.
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
  const isGateway = isUsdt && deposit.gateway !== null;
  // Time-slot deposit: a shared address held by this deposit alone for its window.
  const isSlot = isUsdt && deposit.usdtMatch === "SLOT";
  const net = usdtNetworkDisplay(deposit.network);
  const theme = checkoutTheme(deposit.method);

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
    color: { dark: theme.qrDark, light: "#ffffff" },
  });

  return (
    <main
      className="flex min-h-screen justify-center px-4 py-10"
      style={
        {
          background: theme.bg,
          color: theme.text,
          "--ck-primary": theme.primary,
          "--ck-primary-ink": theme.primaryInk,
          "--ck-text": theme.text,
          "--ck-muted": theme.muted,
          "--ck-surface": theme.surface,
          "--ck-soft-bg": theme.softBg,
          "--ck-soft-border": theme.softBorder,
          "--ck-soft-ink": theme.softInk,
        } as React.CSSProperties
      }
    >
      {resolvedStatus ? null : <BackCancelGuard brand={deposit.method} />}
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <GatewayIcon method={deposit.method} className="h-8 w-8 flex-none rounded-lg" />
            <span className="text-lg font-bold" style={{ color: theme.primary }}>
              {deposit.method}
            </span>
          </span>
          <span className="text-xs font-semibold" style={{ color: theme.muted }}>EN</span>
        </header>

        {resolvedStatus ? (
          <DepositResult deposit={deposit} status={resolvedStatus} token={token} />
        ) : isUsdt ? (
          <>
            <section
              className="rounded-xl p-6 text-center shadow-sm phone:p-5"
              style={{ background: theme.surface }}
            >
              <span
                className="inline-block rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ background: theme.primary, color: theme.primaryInk }}
              >
                Step 1
              </span>
              <h1 className="mt-3 text-sm font-bold" style={{ color: theme.primary }}>
                Send {net.assetLabel} to this address
              </h1>
              <p className="mt-2 text-3xl font-bold tabular-nums">{usdtAmount} USDT</p>
              {isGateway || isSlot ? (
                <p className="mt-1 text-[11px] font-semibold" style={{ color: theme.muted }}>
                  {isGateway ? "This address is unique to this deposit" : "This address is reserved for you until the timer ends"}
                </p>
              ) : null}
              <p className="mt-2">
                <span
                  className="inline-block rounded-full border px-3 py-0.5 text-[11px] font-bold"
                  style={{
                    borderColor: theme.softBorder,
                    background: theme.softBg,
                    color: theme.softInk,
                  }}
                >
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUri}
                alt="Receiving address QR code"
                className="mx-auto mt-4 aspect-square h-auto w-full max-w-[260px]"
              />
            </section>

            <section className="rounded-xl p-5 shadow-sm" style={{ background: theme.surface }}>
              <div className="mb-3 text-center">
                <span
                  className="inline-block rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: theme.primary, color: theme.primaryInk }}
                >
                  Step 2
                </span>
              </div>
              <UsdtStatusPoller token={token} expiresAtMs={deposit.expiresAt.getTime()} />
            </section>

            <section
              className="rounded-xl p-5 text-center shadow-sm"
              style={{ background: theme.surface }}
            >
              <p className="text-xs font-bold" style={{ color: theme.primary }}>
                Or copy the address manually
              </p>
              <dl className="mt-3 flex flex-col gap-3 text-sm">
                <div>
                  <dt
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: theme.muted }}
                  >
                    Amount
                  </dt>
                  <dd className="tabular-nums">{usdtAmount} USDT</dd>
                </div>
                <div>
                  <dt
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: theme.muted }}
                  >
                    Network
                  </dt>
                  <dd>{net.shortLabel}</dd>
                </div>
                <div>
                  <dt
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: theme.muted }}
                  >
                    Address
                  </dt>
                  <dd className="break-all font-mono text-xs">{deposit.receivingAddress}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: theme.muted }}>
                {isGateway ? (
                  <>
                    Send at least this amount, on the {net.label} network only.
                    Anything above it is credited too. A transfer on any other
                    network, or of a token other than USDT, may be unrecoverable.
                  </>
                ) : isSlot ? (
                  <>
                    Send this amount before the timer ends, on the {net.label}{" "}
                    network only. Anything within 3% of it is credited automatically
                    {deposit.senderAddress ? <>, and any amount sent from your wallet {deposit.senderAddress.slice(0, 6)}…{deposit.senderAddress.slice(-4)}</> : null}
                    . A transfer on any other network, or of a token other than USDT,
                    may be unrecoverable.
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
                  className="text-xs font-semibold underline underline-offset-4"
                  style={{ color: theme.primary }}
                >
                  Sent a different amount? Submit your transaction &rarr;
                </a>
              </p>
            )}
          </>
        ) : (
          <>
            <section
              className="rounded-xl p-6 text-center shadow-sm phone:p-5"
              style={{ background: theme.surface }}
            >
              <span
                className="inline-block rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ background: theme.primary, color: theme.primaryInk }}
              >
                Step 1
              </span>
              <h1 className="mt-3 text-sm font-bold" style={{ color: theme.primary }}>
                Scan QR to pay
              </h1>
              <p className="mt-2 text-3xl font-bold tabular-nums">₹ {rupees}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUri}
                alt={`UPI payment QR code for ₹${rupees}`}
                className="mx-auto mt-4 aspect-square h-auto w-full max-w-[260px]"
              />
            </section>

            <p className="text-center text-xs font-semibold" style={{ color: theme.muted }}>OR</p>

            <section
              className="rounded-xl p-5 text-center shadow-sm"
              style={{ background: theme.surface }}
            >
              <p className="text-xs font-bold" style={{ color: theme.primary }}>
                Open any app that allows UPI payments
              </p>
              <dl className="mt-3 flex flex-col gap-3 text-sm">
                <div>
                  <dt
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: theme.muted }}
                  >
                    Amount
                  </dt>
                  <dd className="tabular-nums">{rupees} INR</dd>
                </div>
                <div>
                  <dt
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: theme.muted }}
                  >
                    UPI ID
                  </dt>
                  <dd className="break-all">{deposit.vpa}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: theme.muted }}>
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

        <p className="text-center text-[11px]" style={{ color: theme.muted }}>
          Secure payment processing by IndianxTrade
        </p>
      </div>
    </main>
  );
}
