import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = buildMetadata({
  title: `Security at ${SITE_NAME}`,
  description: `How ${SITE_NAME} protects your account and funds: encrypted connections, strict browser security headers, verified withdrawals and anti-fraud checks.`,
  path: "/security",
  keywords: [`${SITE_NAME} security`, "is asm trade safe", "trading account security"],
});

export default function SecurityPage() {
  return (
    <div>
      <h1 className="text-3xl font-black tracking-tight text-ink md:text-4xl">
        Security at {SITE_NAME}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-2">
        Protecting your account and your money is a baseline, not a feature. Here
        is how we do it.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">Your connection</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          <li>All traffic is served over encrypted HTTPS.</li>
          <li>
            Strict browser security headers &mdash; a locked-down Content
            Security Policy, clickjacking protection, and a no-referrer policy
            &mdash; are enforced on every page.
          </li>
          <li>The platform cannot be embedded in a frame, blocking clickjacking.</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">Your funds</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          <li>
            Withdrawals go to verified destinations, usually the method you
            deposited with &mdash; standard anti-fraud practice.
          </li>
          <li>
            A one-time identity check (KYC) may apply to your first withdrawal to
            prevent fraud and money laundering.
          </li>
          <li>Every trade is recorded in an audited ledger you can inspect.</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-bold text-ink md:text-2xl">
          What you can do
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          <li>Use a strong, unique password.</li>
          <li>Never share your login or one-time codes with anyone.</li>
          <li>
            {SITE_NAME} will never ask for your password by email or message.
          </li>
        </ul>
      </section>
    </div>
  );
}
