import { payoutDestinationLabel } from "@asm/contracts";
import { formatMoney, getWithdrawalNotice } from "@asm/db";
import { logger } from "@asm/logger";
import { sendWithdrawalPaidEmail, sendWithdrawalRejectedEmail } from "@asm/mail";
import { displayName, payToLabel, personName, shortRef, type CertificateData } from "@asm/mail/templates";
import { renderCertificateJpeg } from "./withdrawal-certificate";

/**
 * Emails for the admin's withdrawal decisions. Both run after the decision is
 * committed and never throw: a mail failure must not surface as a failed
 * admin action, because the payout or refund already happened.
 */

export async function emailWithdrawalPaid(withdrawalId: string): Promise<void> {
  try {
    const w = await getWithdrawalNotice(withdrawalId);
    if (!w || w.status !== "PAID") return;
    const certificate = {
      name: displayName(w.user),
      amountLabel: formatMoney(w.amount, w.currency),
      dateLabel: formatCertificateDate(new Date()),
      refId: shortRef(w.id),
    };
    await sendWithdrawalPaidEmail({
      to: w.user.email,
      withdrawalId: w.id,
      name: personName(w.user),
      payToLabel: payToLabel(w.method, payoutDestinationLabel(w)),
      certificate,
      certificateJpegBase64: await renderCertificateBase64(withdrawalId, certificate),
    });
  } catch (err) {
    logger.warn({ evt: "withdrawal.mail_failed", kind: "paid", withdrawalId, err: String(err) }, "withdrawal paid email failed");
  }
}

/** DD/MM/YYYY in India time, as the certificate artwork shows it. */
function formatCertificateDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

/** A render failure must not stop the email: it falls back to the HTML certificate. */
async function renderCertificateBase64(withdrawalId: string, certificate: CertificateData): Promise<string | null> {
  try {
    return (await renderCertificateJpeg(certificate)).toString("base64");
  } catch (err) {
    logger.warn({ evt: "withdrawal.certificate_render_failed", withdrawalId, err: String(err) }, "certificate image render failed");
    return null;
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
