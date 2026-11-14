import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatMoney, getProgramSummary, listProgramActivity } from "@asm/db";
import { PageFrame } from "@/components/shell/PageFrame";
import { ProgramEarningsPanel } from "@/components/program/ProgramEarningsPanel";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export const metadata: Metadata = { title: "Referral earnings", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const whole = (minor: number) => formatMoney(minor, "INR").replace(/\.00$/, "");

export default async function ReferralEarningsPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  if (session.role === "AFFILIATE") redirect("/affiliate/dashboard");

  const [summary, activity] = await Promise.all([
    getProgramSummary(session.userId),
    listProgramActivity(session.userId, { limit: 50 }),
  ]);
  const t = summary.terms;

  return (
    <PageFrame
      width="base"
      title="Referral earnings"
      description="Rewards from friends you invited."
      back={{ href: "/referral", label: "Referral program" }}
    >
      <ProgramEarningsPanel summary={summary} activity={activity} />

      <section aria-labelledby="program-rules" className="rounded-xl border border-rule bg-panel p-5 phone:p-4">
        <h2 id="program-rules" className="text-sm font-bold text-ink">
          How rewards work
        </h2>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-ink-2">
          <li>
            You earn <span className="font-semibold text-ink">{whole(t.userRewardMinor)}</span> once for each invited friend
            who qualifies.
          </li>
          <li>
            A friend qualifies after a completed deposit of at least {whole(t.minQualifyingDepositMinor)} and a settled live
            trade of at least {whole(t.minQualifyingTradeMinor)} of their own money. Bonus funds and demo trades don&apos;t
            count.
          </li>
          {t.inviteExtraBonusPct > 0 ? (
            <li>
              Your friend gets an extra {t.inviteExtraBonusPct}% on top of the usual first-deposit bonus when they join with
              your link or code.
            </li>
          ) : null}
          <li>
            A reward becomes available after the day it was earned closes (midnight IST). You can then move it to your
            trading balance, or withdraw it from {whole(t.minWithdrawalMinor)} once your identity is verified.
          </li>
        </ul>
      </section>
    </PageFrame>
  );
}
