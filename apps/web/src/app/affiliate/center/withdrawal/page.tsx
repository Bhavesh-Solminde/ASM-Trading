import { listProgramActivity } from "@asm/db";
import { Questions, type Question } from "@/components/affiliate-center/Questions";
import { readAffiliateSummary, requireAffiliate } from "@/components/affiliate-center/server";
import { ProgramEarningsPanel } from "@/components/program/ProgramEarningsPanel";
import styles from "@/components/affiliate-center/center.module.css";

const QUESTIONS: Question[] = [
  { question: "What do Pending and Processing mean?", answer: "Pending means we received your request. You can cancel it in History while it’s pending. Processing means your request has been approved and the payout is being arranged." },
  { question: "What does Paid mean?", answer: "The payout has been sent to the method you selected." },
  { question: "What happens if a withdrawal is rejected or cancelled?", answer: "The amount returns to your available affiliate balance. If we rejected the request, History shows the reason when one is available." },
];

export default async function AffiliateWithdrawalPage() {
  const user = await requireAffiliate();
  const [summary, activity] = await Promise.all([
    readAffiliateSummary(user.id),
    listProgramActivity(user.id, { limit: 50 }),
  ]);
  const {
    isAffiliate, affiliateStatus, pendingMinor, heldMinor, availableMinor, reservedMinor, transferredMinor,
    paidMinor, carryForwardMinor, used, canTransfer, canWithdraw, blockers, terms: { minWithdrawalMinor, limits },
  } = summary;

  return (
    <>
      <div className={styles.heading}>
        <h1>Withdrawal</h1>
        <p>Request a payout or move your affiliate earnings to your live trading balance.</p>
      </div>
      <ProgramEarningsPanel
        standalone
        summary={{
          isAffiliate, affiliateStatus, pendingMinor, heldMinor, availableMinor, reservedMinor, transferredMinor,
          paidMinor, carryForwardMinor, used, canTransfer, canWithdraw, blockers, terms: { minWithdrawalMinor, limits },
        }}
        activity={activity.map((item) => ({
          ...item, reason: item.type === "WITHDRAWAL" && item.status === "REJECTED" ? item.reason : null,
        }))}
      />
      <section className={styles.panel} aria-labelledby="withdrawal-statuses">
        <h2 className="mb-3" id="withdrawal-statuses">Withdrawal status FAQ</h2>
        <Questions items={QUESTIONS} />
      </section>
    </>
  );
}
