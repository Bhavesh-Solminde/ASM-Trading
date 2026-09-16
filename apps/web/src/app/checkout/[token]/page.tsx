import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getDepositByToken } from "@asm/db";
import { ClaimForm } from "./ClaimForm";

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

  const rupees = (deposit.amountInr / 100).toFixed(2);

  // A real UPI deep link, pointing at a fictitious demo VPA.
  const upiUri =
    `upi://pay?pa=${encodeURIComponent(deposit.vpa)}` +
    `&pn=${encodeURIComponent("ASM Trade")}` +
    `&am=${encodeURIComponent(rupees)}` +
    `&cu=INR&tn=${encodeURIComponent(`ASM-${deposit.id.slice(0, 8)}`)}`;

  const qrDataUri = await QRCode.toDataURL(upiUri, {
    width: 260,
    margin: 1,
    color: { dark: "#241436", light: "#ffffff" },
  });

  const resolved =
    deposit.status === "COMPLETED" || deposit.status === "REJECTED" || deposit.status === "EXPIRED";

  return (
    <main
      className="flex min-h-screen justify-center px-4 py-10"
      style={{ background: "#f6f4fb", color: "#241436" }}
    >
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex items-center justify-between">
          <p className="text-lg font-bold" style={{ color: "#5b2d9e" }}>
            {deposit.method}
          </p>
          <span className="text-xs font-semibold text-[#6b5a8a]">EN</span>
        </header>

        {resolved ? (
          <div className="rounded-xl bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-semibold">
              This payment is already {deposit.status.toLowerCase()}.
            </p>
            <a
              href="/trade"
              className="mt-3 inline-block text-xs font-semibold text-[#5b2d9e] underline underline-offset-4"
            >
              Back to trading
            </a>
          </div>
        ) : (
          <>
            <section className="rounded-xl bg-white p-6 text-center shadow-sm">
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
                className="mx-auto mt-4 h-[260px] w-[260px]"
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

            <section className="rounded-xl bg-white p-5 shadow-sm">
              <div className="mb-3 text-center">
                <span className="inline-block rounded-full bg-[#5b2d9e] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                  Step 2
                </span>
              </div>
              <ClaimForm depositId={deposit.id} />
            </section>
          </>
        )}

        <p className="text-center text-[11px] text-[#8a7aa8]">
          Secure payment processing by ASM Trade
        </p>
      </div>
    </main>
  );
}
