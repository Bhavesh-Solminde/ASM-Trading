import type { UserStatus } from "@asm/db";

/** Canned reason codes for a status change. Free-text notes are appended
 *  as "<label> — <note>" so historical rows stay readable without the lookup. */
export const USER_STATUS_REASONS = [
  { code: "bonus_abuse", label: "Bonus abuse" },
  { code: "chargeback", label: "Chargeback / payment dispute" },
  { code: "kyc_fraud", label: "KYC fraud" },
  { code: "duplicate_account", label: "Duplicate / linked account" },
  { code: "support_request", label: "Support request" },
  { code: "manual_review", label: "Manual review" },
  { code: "reactivated", label: "Reactivated" },
  { code: "other", label: "Other" },
] as const;

export type UserStatusReasonCode = (typeof USER_STATUS_REASONS)[number]["code"];

const REASON_LABEL: Record<string, string> = Object.fromEntries(
  USER_STATUS_REASONS.map((r) => [r.code, r.label]),
);

export function reasonLabel(code: string): string {
  return REASON_LABEL[code] ?? code;
}

export function formatStatusReason(code: string, note: string | null | undefined): string {
  const label = reasonLabel(code);
  const trimmed = (note ?? "").trim();
  return trimmed ? `${label} — ${trimmed}` : label;
}

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Active",
  FLAGGED: "Flagged",
  FROZEN: "Frozen",
  BANNED: "Banned",
};
