// Audit-log actions in plain words, shared by the overview feed and the audit
// log. Unknown actions fall back to a readable form of their raw name.

const WORDS: Record<string, string> = {
  "asset.payout_changed": "Changed a market's payout",
  "deposit.approve": "Approved a deposit",
  "deposit.approved_auto": "Deposit auto-approved, UTR matched",
  "deposit.reject": "Rejected a deposit",
  "deposit.rejected": "Rejected a deposit",
  "deposit.reverse_usdt": "Reversed a USDT deposit",
  "deposit.reversed": "Reversed a USDT deposit",
  "deposit.usdt_payment_claimed": "Credited a USDT payment",
  "chain_credit.resolve": "Credited an on-chain payment",
  "chain_credit.dismiss": "Dismissed an on-chain payment",
  "chain_credit.dismissed": "Dismissed an on-chain payment",
  "chain_credit.requeued_after_reversal": "Re-queued an on-chain payment",
  "withdrawal.approve": "Approved a withdrawal",
  "withdrawal.approved": "Approved a withdrawal",
  "withdrawal.reject": "Rejected a withdrawal",
  "withdrawal.rejected": "Rejected a withdrawal",
  "withdrawal.paid": "Marked a withdrawal paid",
  "withdrawal.hold_released": "Released a held withdrawal",
  "kyc.approved": "Approved a KYC submission",
  "kyc.verified": "Approved a KYC submission",
  "kyc.rejected": "Rejected a KYC submission",
  "user.updated": "Updated a user's account",
  "user.unfreeze": "Unfroze a user",
  "user.status.flagged": "Flagged a user",
  "user.status.frozen": "Froze a user",
  "user.status.banned": "Banned a user",
  "user.status.active": "Reactivated a user",
  "fraud.confirm_freeze": "Confirmed a fraud flag and froze the accounts",
  "fraud.confirm_ban": "Confirmed a fraud flag and banned the accounts",
  "fraud.dismiss": "Dismissed a fraud flag",
  "fraud.flag_confirmed": "Confirmed a fraud flag",
  "fraudFlag.confirmed": "Confirmed a fraud flag",
  "fraudFlag.dismissed": "Dismissed a fraud flag",
  "affiliate.created": "Created an affiliate",
  "affiliate.deleted": "Deleted an affiliate",
  "affiliate.balance_set": "Set an affiliate account balance",
  "affiliate.password_reset": "Reset an affiliate's password",
  "auth.password_reset": "Reset a user's password",
  "affiliate.status_changed": "Changed an affiliate's status",
  "affiliate.rate_assigned": "Assigned an affiliate rate",
  "program.setting_changed": "Scheduled an affiliate program setting",
  "program.withdrawal.approve": "Approved a program withdrawal",
  "program.withdrawal.reject": "Rejected a program withdrawal",
  "program.withdrawal.paid": "Marked a program withdrawal paid",
  "program.earning_released": "Released a held program earning",
  "program.earning_voided": "Voided a held program earning",
  "program.earning_review_cleared": "Cleared a program earning review flag",
  "program.adjustment": "Made a program balance adjustment",
};

export function auditSentence(action: string, after?: unknown): string {
  if (action === "asset.open_toggled") {
    const isOpen = (after as { isOpen?: boolean } | null)?.isOpen;
    return isOpen === true ? "Opened a market" : isOpen === false ? "Paused a market" : "Changed a market's open status";
  }
  return WORDS[action] ?? action.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Dot colour for an action: green approvals, red rejections, amber holds. */
export function auditTone(action: string): "pos" | "neg" | "warn" | "" {
  if (/reject|confirm|ban|dismissed$|revers/i.test(action)) return "neg";
  if (/frozen|freeze|hold/i.test(action)) return "warn";
  if (/approv|paid|verified|resolve|claimed|unfreeze|created/i.test(action)) return "pos";
  return "";
}
