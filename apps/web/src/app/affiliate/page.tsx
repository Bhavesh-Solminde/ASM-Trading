import type { Metadata } from "next";
import Link from "next/link";
import { ContentShell } from "@/components/content/ContentShell";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = buildMetadata({
  title: "Affiliate Program",
  description: `Invite friends to ${SITE_NAME}. Earn a reward on each referred friend's first qualifying deposit plus a share of revenue from their trading, while they get an enhanced first-deposit bonus.`,
  path: "/affiliate",
  keywords: [`${SITE_NAME} affiliate`, "trading affiliate program", "refer and earn trading"],
});

const PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brand px-6 text-sm font-black text-brand-ink transition hover:brightness-110";
const SECONDARY =
  "inline-flex h-12 items-center justify-center rounded-full border border-rule px-6 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand";

const STEPS = [
  {
    title: "Open an affiliate account",
    body: "It is separate from any regular trading account, so you can sign up with the same email.",
  },
  { title: "Verify your email", body: "We send a link to your inbox. Verifying it activates your affiliate access." },
  { title: "Invite friends", body: "Share your personal invitation link from the affiliate dashboard." },
  { title: "Earn as they trade", body: "Rewards build up in your affiliate account as your referred friends deposit and trade." },
] as const;

function CtaRow() {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <Link href="/affiliate/register" className={PRIMARY}>
        Become an affiliate <span aria-hidden>→</span>
      </Link>
      <Link href="/affiliate/login" className={SECONDARY}>
        Affiliate log in
      </Link>
    </div>
  );
}

export default function AffiliateLandingPage() {
  return (
    <ContentShell cta={{ href: "/affiliate/register", label: "Join" }}>
      <p className="legend text-brand">Affiliate program</p>
      <h1 className="mt-3 text-3xl font-black tracking-tight text-ink md:text-4xl">
        Invite friends to {SITE_NAME}. Earn as they trade.
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-2">
        Share {SITE_NAME} with people you know. You earn from the friends you bring in, and they start with a
        better welcome offer than a regular sign-up.
      </p>
      <CtaRow />

      <section className="mt-12 grid gap-4 sm:grid-cols-2" aria-label="What everyone gets">
        <div className="rounded-xl border border-rule bg-panel p-5">
          <h2 className="text-lg font-bold text-ink">What you earn</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-2">
            <li>A reward on each referred friend&apos;s first qualifying deposit.</li>
            <li>A share of the revenue from your referred friends&apos; trading.</li>
          </ul>
        </div>
        <div className="rounded-xl border border-rule bg-panel p-5">
          <h2 className="text-lg font-bold text-ink">What your friends get</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-2">
            <li>An enhanced bonus on their first deposit when they join through your invitation.</li>
          </ul>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold text-ink md:text-2xl">How it works</h2>
        <ol className="mt-5 grid gap-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-3">
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-full border border-rule text-sm font-bold text-brand"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold text-ink">{step.title}</h3>
                <p className="mt-1 text-ink-2">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold text-ink md:text-2xl">Good to know</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          <li>
            Affiliate accounts are separate from regular accounts, with their own password, balance and history. You
            can use the same email for both.
          </li>
          <li>Email verification is required to activate your affiliate access.</li>
          <li>Identity verification is required before your first withdrawal of earnings.</li>
          <li>You can trade from your affiliate account under the same rules as any other account.</li>
        </ul>
      </section>

      <CtaRow />
    </ContentShell>
  );
}
