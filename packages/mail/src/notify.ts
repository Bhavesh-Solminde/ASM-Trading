import { sendEmail, type SendResult } from "./send";
import {
  depositCreditedEmail,
  formatDateLabel,
  formatDateTimeLabel,
  passwordChangedEmail,
  passwordResetEmail,
  shortRef,
  siteUrl,
  welcomeEmail,
  withdrawalPaidEmail,
  withdrawalRejectedEmail,
  withdrawalRequestedEmail,
  type CertificateData,
  type RenderedEmail,
} from "./templates";

/**
 * One sender per email. Each fixes the idempotency key (so a re-run trigger
 * never sends twice) and the dashboard tag. Callers pass already-formatted
 * money labels: formatMoney lives in @asm/db, which this package can't import.
 */

interface Recipient {
  to: string;
  cid?: string | undefined;
}

function deliver(r: Recipient, email: RenderedEmail, idempotencyKey: string, tag: string): Promise<SendResult> {
  return sendEmail({ to: r.to, subject: email.subject, html: email.html, idempotencyKey, tag, cid: r.cid });
}

export function sendWelcomeEmail(input: Recipient & { userId: string; name: string; firstDepositBonusPercent: number }) {
  return deliver(input, welcomeEmail(input), `welcome/${input.userId}`, "welcome");
}

export function sendPasswordResetEmail(
  input: Recipient & { tokenId: string; name: string; resetUrl: string; ttlMinutes: number },
) {
  return deliver(input, passwordResetEmail(input), `password-reset/${input.tokenId}`, "password_reset");
}

export function sendPasswordChangedEmail(input: Recipient & { userId: string; name: string; changedAt: Date }) {
  const email = passwordChangedEmail({
    name: input.name,
    changedAtLabel: formatDateTimeLabel(input.changedAt),
    resetUrl: siteUrl("/forgot-password"),
  });
  return deliver(input, email, `password-changed/${input.userId}/${input.changedAt.getTime()}`, "password_changed");
}

export function sendDepositCreditedEmail(
  input: Recipient & { depositId: string; name: string; creditLabel: string; bonusLabel: string | null; totalLabel: string },
) {
  const email = depositCreditedEmail({
    name: input.name,
    creditLabel: input.creditLabel,
    bonusLabel: input.bonusLabel,
    totalLabel: input.totalLabel,
    dateLabel: formatDateLabel(new Date()),
    refId: shortRef(input.depositId),
  });
  return deliver(input, email, `deposit-credited/${input.depositId}`, "deposit_credited");
}

export function sendWithdrawalRequestedEmail(
  input: Recipient & { withdrawalId: string; name: string; amountLabel: string; payToLabel: string; held: boolean },
) {
  const email = withdrawalRequestedEmail({ ...input, refId: shortRef(input.withdrawalId) });
  return deliver(input, email, `withdrawal-requested/${input.withdrawalId}`, "withdrawal_requested");
}

export function sendWithdrawalPaidEmail(
  input: Recipient & { withdrawalId: string; certificate: CertificateData; payToLabel: string },
) {
  const email = withdrawalPaidEmail({ certificate: input.certificate, payToLabel: input.payToLabel });
  return deliver(input, email, `withdrawal-paid/${input.withdrawalId}`, "withdrawal_paid");
}

export function sendWithdrawalRejectedEmail(
  input: Recipient & { withdrawalId: string; name: string; amountLabel: string; reason: string },
) {
  const email = withdrawalRejectedEmail({ ...input, refId: shortRef(input.withdrawalId) });
  return deliver(input, email, `withdrawal-rejected/${input.withdrawalId}`, "withdrawal_rejected");
}
