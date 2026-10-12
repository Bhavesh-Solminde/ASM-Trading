/** Name, initials and KYC wording for the Account hub header. Pure, so it is unit-tested. */

export interface ProfileNames {
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  email: string;
}

/** Real name if KYC details exist, else nickname, else the part of the email before "@". */
export function displayName(p: ProfileNames): string {
  const full = [p.firstName, p.lastName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  if (p.nickname?.trim()) return p.nickname.trim();
  return p.email.split("@")[0] || p.email;
}

/** Up to two upper-case letters: first + last word of the name, or the first two characters. */
export function initialsFor(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

export type KycTone = "up" | "caution" | "down" | "neutral";

export const KYC_BADGE: Record<string, { label: string; tone: KycTone }> = {
  VERIFIED: { label: "Verified", tone: "up" },
  PENDING: { label: "In review", tone: "caution" },
  REJECTED: { label: "Rejected", tone: "down" },
  NOT_STARTED: { label: "Not verified", tone: "neutral" },
};

export function kycBadge(status: string): { label: string; tone: KycTone } {
  return KYC_BADGE[status] ?? KYC_BADGE.NOT_STARTED!;
}
