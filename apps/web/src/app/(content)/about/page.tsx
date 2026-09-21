import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = buildMetadata({
  title: `About ${SITE_NAME}`,
  description: `What ${SITE_NAME} is, who it is for, and the principles behind it — a fast, honest, mobile-first binary options platform for short-term traders.`,
  path: "/about",
  keywords: [`about ${SITE_NAME}`, "asm trade company", "who owns asm trade"],
});

export default function AboutPage() {
  return (
    <div>
      <h1 className="text-3xl font-black tracking-tight text-ink md:text-4xl">
        About {SITE_NAME}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-2">
        {SITE_NAME} is a mobile-first binary options trading platform built for
        short-term traders who want a fast, honest Up/Down experience across
        forex, crypto, commodities and stocks.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">Why we built it</h2>
        <p className="mt-4 leading-relaxed text-ink-2">
          Too many short-term platforms feel opaque: unclear pricing, slow
          withdrawals, and interfaces that fight your thumb on a phone. We built{" "}
          {SITE_NAME} around three commitments &mdash; transparent settlement, a
          genuinely usable mobile experience, and local payment rails for the
          markets we serve across South Asia.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">
          What we stand for
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          <li>
            <span className="font-semibold text-ink">Transparency.</span> A live
            engine and an audited ledger you can inspect &mdash; no re-quotes.
          </li>
          <li>
            <span className="font-semibold text-ink">Fixed, honest risk.</span>{" "}
            You never lose more than your stake, and we say plainly that most
            short-term traders lose money.
          </li>
          <li>
            <span className="font-semibold text-ink">Practice first.</span> Every
            account starts with a free, resettable $10,000 demo so you can learn
            before you risk anything.
          </li>
          <li>
            <span className="font-semibold text-ink">Local access.</span> UPI and
            bank transfer alongside card and crypto.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">Risk disclosure</h2>
        <p className="mt-4 leading-relaxed text-ink-2">
          {SITE_NAME} offers high-risk binary options trading. Trading is not
          suitable for everyone and you can lose your entire stake. Availability
          is restricted in some jurisdictions and your eligibility is checked at
          sign-up.
        </p>
      </section>
    </div>
  );
}
