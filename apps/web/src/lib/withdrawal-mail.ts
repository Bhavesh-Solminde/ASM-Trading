import { payoutDestinationLabel } from "@asm/contracts";
import { formatMoney, getWithdrawalNotice } from "@asm/db";
import { logger } from "@asm/logger";
import { sendWithdrawalPaidEmail, sendWithdrawalRejectedEmail } from "@asm/mail";
import { displayName, formatDateLabel, payToLabel, personName, shortRef } from "@asm/mail/templates";

/**
 * Emails for the admin's withdrawal decisions. Both run after the decision is
 * committed and never throw: a mail failure must not surface as a failed
 * admin action, because the payout or refund already happened.
 */

export async function emailWithdrawalPaid(withdrawalId: string): Promise<void> {
  try {
    const w = await getWithdrawalNotice(withdrawalId);
    if (!w || w.status !== "PAID") return;
    await sendWithdrawalPaidEmail({
      to: w.user.email,
      withdrawalId: w.id,
      name: personName(w.user),
      payToLabel: payToLabel(w.method, payoutDestinationLabel(w)),
      certificate: {
        name: displayName(w.user),
        amountLabel: formatMoney(w.amount, w.currency),
        dateLabel: formatDateLabel(new Date()),
        refId: shortRef(w.id),
      },
    });
  } catch (err) {
    logger.warn({ evt: "withdrawal.mail_failed", kind: "paid", withdrawalId, err: String(err) }, "withdrawal paid email failed");
  }
}

export async function emailWithdrawalRejected(withdrawalId: string): Promise<void> {
  try {
    const w = await getWithdrawalNotice(withdrawalId);
    if (!w || w.status !== "REJECTED") return;
    await sendWithdrawalRejectedEmail({
      to: w.user.email,
      withdrawalId: w.id,
      name: personName(w.user),
      amountLabel: formatMoney(w.amount, w.currency),
      reason: w.reason ?? "We couldn't send this payout",
    });
  } catch (err) {
    logger.warn({ evt: "withdrawal.mail_failed", kind: "rejected", withdrawalId, err: String(err) }, "withdrawal rejected email failed");
  }
}
