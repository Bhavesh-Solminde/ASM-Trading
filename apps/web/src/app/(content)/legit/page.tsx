import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";
import { JsonLd, faqSchema } from "@/components/seo/JsonLd";

const faqs = [
  {
    q: `Is ${SITE_NAME} legit or a scam?`,
    a: `${SITE_NAME} is a real trading platform with a live settlement engine and an audited ledger that records every trade's open, close and settle tick. You can verify it yourself: open a free demo with no card, place trades, and inspect how they settle before depositing any money.`,
  },
  {
    q: "How do I know the prices are fair?",
    a: "Prices are streamed live from an engine that aggregates multiple liquidity providers. Every trade's open, close and settle price is recorded in a ledger you can inspect, so nothing is re-quoted after you click.",
  },
  {
    q: "Can I actually withdraw my money?",
    a: "Yes. Unspent deposits are not locked. Bank and card withdrawals typically settle within one business day of approval; crypto usually within an hour. A one-time identity check (KYC) may apply to your first withdrawal.",
  },
  {
    q: "Is there a catch with the free demo?",
    a: "No. The demo is genuinely free: an email gets you $10,000 in practice funds with no card and no deposit. It exists so you can judge the platform before risking real money.",
  },
];

export const metadata: Metadata = buildMetadata({
  title: `Is ${SITE_NAME} Legit? How to Verify Before You Deposit`,
  description: `Honest answers on whether ${SITE_NAME} is legit: how to verify the platform with a free demo, how prices and settlement work, and how withdrawals are processed.`,
  path: "/legit",
  keywords: [`is ${SITE_NAME} legit`, "asm trade scam", "asm trade review", "is asm trade safe"],
});

export default function LegitPage() {
  return (
    <div>
      <JsonLd data={faqSchema(faqs)} />

      <h1 className="text-3xl font-black tracking-tight text-ink md:text-4xl">
        Is {SITE_NAME} legit?
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-2">
        A fair question to ask of any trading platform. The honest answer is:
        don&rsquo;t take our word for it &mdash; verify it yourself before you
        deposit a cent.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">
          Verify it in five minutes
        </h2>
        <ol className="mt-4 space-y-3 text-ink-2">
          <li>1. Open a free demo &mdash; email only, no card, no deposit.</li>
          <li>2. Place a few trades and watch them settle on the tick.</li>
          <li>3. Inspect the ledger: open, close and settle prices are recorded.</li>
          <li>4. Only then decide whether to fund a live account.</li>
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">
          What makes it real
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          <li>A live settlement engine with no re-quote on close.</li>
          <li>An audited ledger for every trade you place.</li>
          <li>Withdrawals of unspent deposits &mdash; nothing is locked.</li>
          <li>Clear, fixed risk: you never lose more than your stake.</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">
          An honest warning
        </h2>
        <p className="mt-4 leading-relaxed text-ink-2">
          Being legitimate does not make trading safe. This is
          high-risk, short-term speculation and most short-term traders lose
          money. A real platform is one that tells you this plainly. Trade only
          with money you can afford to lose.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">
          Frequently asked questions
        </h2>
        <dl className="mt-4 space-y-5">
          {faqs.map((faq, i) => (
            <div key={i}>
              <dt className="font-semibold text-ink">{faq.q}</dt>
              <dd className="mt-1 text-ink-2">{faq.a}</dd>
            </div>
))}
        </dl>
      </section>

      <div className="mt-12 rounded-2xl border border-rule bg-panel p-6">
        <p className="text-lg font-bold text-ink">See for yourself</p>
        <p className="mt-2 text-ink-2">
          Open a free demo and inspect how {SITE_NAME} settles trades before you
          deposit.
        </p>
        <Link
          href="/register"
          className="mt-4 inline-flex rounded-full bg-brand px-5 py-2 font-semibold text-brand-ink"
        >
          Open a free demo
        </Link>
      </div>
    </div>
);
}
