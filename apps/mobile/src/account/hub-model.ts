import type { Tone } from "@asm/client-core";
import type { KycStatus } from "@/kyc/verify-model";

const clean = (s: string | null | undefined) => (s ?? "").trim();

/**
 * The name the Account hub shows: first and last name (whichever are on file), else the nickname, else the part of
 * the email before the `@`. Empty while nothing is loaded.
 */
export function identityName(p: { firstName: string | null; lastName: string | null; nickname: string | null; email: string }): string {
  const full = [clean(p.firstName), clean(p.lastName)].filter((s) => s !== "").join(" ");
  if (full !== "") return full;
  const nickname = clean(p.nickname);
  if (nickname !== "") return nickname;
  return clean(p.email).split("@")[0] ?? "";
}

/** The avatar's letters: the first character of the first two words, upper-cased. Whole code points, so an emoji is not split. */
export function identityInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, 2)
    .map((w) => (Array.from(w)[0] ?? "").toUpperCase())
    .join("");
}

/** The KYC stamp on the identity row: its tone and the i18n key of its words. Status is always a word, never only a colour. */
export function kycTag(status: KycStatus): { tone: Tone; labelKey: string } {
  switch (status) {
    case "VERIFIED":
      return { tone: "up", labelKey: "account.kycVerified" };
    case "PENDING":
      return { tone: "caution", labelKey: "account.kycReview" };
    case "REJECTED":
      return { tone: "down", labelKey: "account.kycRejected" };
    case "NOT_STARTED":
      return { tone: "neutral", labelKey: "account.kycNotDone" };
  }
}

/** The "verify your account" card is only for someone with something to do. */
export function showVerifyCard(status: KycStatus): boolean {
  return status === "NOT_STARTED" || status === "REJECTED";
}

/** i18n key of the value beside "Security and app lock". An enabled lock with no method cannot unlock anything, so it reads Off. */
export function lockValueKey(lock: { enabled: boolean; method: "biometric" | "pin" | null }): string {
  if (!lock.enabled || lock.method === null) return "account.lockOff";
  return lock.method === "biometric" ? "account.lockFingerprint" : "account.lockPin";
}

interface AccountLike {
  id: string;
  type: "LIVE" | "DEMO";
  currency: string;
}

/** The LIVE account's currency (the one Currency changes and every money screen shows), or null without one. */
export function liveCurrency(accounts: readonly AccountLike[] | undefined): string | null {
  return accounts?.find((a) => a.type === "LIVE")?.currency ?? null;
}

/**
 * The DEMO account's id, the only id the reset ever sends. Null without a demo account: the row is not offered, so a
 * LIVE id can never reach the demo-balance route from here.
 */
export function demoAccountId(accounts: readonly AccountLike[] | undefined): string | null {
  return accounts?.find((a) => a.type === "DEMO")?.id ?? null;
}
