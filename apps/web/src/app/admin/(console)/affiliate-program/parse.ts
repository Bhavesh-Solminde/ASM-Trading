// Form-input parsing for the affiliate-program admin actions. Money is integer
// paise and rates are integer basis points; nothing here goes through floats.

export type SettingUnit = "inr" | "bps" | "pct" | "count" | "bool";

/** Plain labels and units for every ProgramSettingKey (value is stored as paise / bps / whole number). */
export const SETTING_META: Record<string, { label: string; unit: SettingUnit; help: string }> = {
  MIN_QUALIFYING_DEPOSIT_INR_MINOR: {
    label: "Minimum qualifying deposit",
    unit: "inr",
    help: "A referred user's first deposit must reach this to count.",
  },
  MIN_QUALIFYING_TRADE_INR_MINOR: {
    label: "Minimum qualifying trade",
    unit: "inr",
    help: "Real-money stake of the settled trade that qualifies a referral.",
  },
  USER_REFERRAL_REWARD_INR_MINOR: {
    label: "Regular inviter reward",
    unit: "inr",
    help: "Paid to a regular user per qualified referral.",
  },
  AFFILIATE_DEPOSIT_REWARD_BPS: {
    label: "Affiliate deposit reward",
    unit: "bps",
    help: "Share of the first qualifying deposit, unless the affiliate has an override.",
  },
  INVITE_EXTRA_BONUS_PCT: {
    label: "Invited friend extra bonus",
    unit: "pct",
    help: "Extra bonus on an invited friend's first deposit.",
  },
  PROGRAM_MIN_WITHDRAWAL_INR_MINOR: {
    label: "Minimum withdrawal",
    unit: "inr",
    help: "Smallest program withdrawal a user can request.",
  },
  PROGRAM_WITHDRAWALS_PER_DAY: { label: "Withdrawals per IST day", unit: "count", help: "Requested, approved and paid count." },
  PROGRAM_WITHDRAWALS_PER_WEEK: { label: "Withdrawals per week (Mon–Sun)", unit: "count", help: "Requested, approved and paid count." },
  PROGRAM_WITHDRAWALS_PER_MONTH: { label: "Withdrawals per calendar month", unit: "count", help: "Requested, approved and paid count." },
  AFFILIATE_REQUIRES_APPROVAL: {
    label: "New affiliates need approval",
    unit: "bool",
    help: "When on, a verified affiliate waits for admin approval before becoming active.",
  },
};

/** "₹1,999.50", "-50" → paise. Up to 12 rupee digits and 2 decimals; commas ignored. */
export function rupeesToPaise(input: string, { signed = false } = {}): number | null {
  const m = /^([+-])?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(input.replace(/[₹,\s]/g, ""));
  if (!m || (m[1] && !signed)) return null;
  const paise = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" ? -paise : paise;
}

/** "12.5" (%) → 1250 bps. 0–100% with up to two decimals. */
export function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ""));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** Human input for a setting → its stored integer, or null if invalid. */
export function settingValueFromInput(key: string, input: string): number | null {
  const unit = SETTING_META[key]?.unit;
  const v = input.trim();
  if (unit === "inr") return rupeesToPaise(v);
  if (unit === "bps") return percentToBps(v);
  if (unit === "pct") return /^\d{1,3}$/.test(v) && Number(v) <= 100 ? Number(v) : null;
  if (unit === "count") return /^\d{1,4}$/.test(v) ? Number(v) : null;
  if (unit === "bool") return v === "1" || v === "0" ? Number(v) : null;
  return null;
}

export function formatSettingValue(key: string, value: number): string {
  const unit = SETTING_META[key]?.unit;
  if (unit === "inr") {
    const dp = value % 100 ? 2 : 0;
    return "₹" + (value / 100).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  if (unit === "bps") return `${value / 100}%`;
  if (unit === "pct") return `${value}%`;
  if (unit === "bool") return value ? "On" : "Off";
  return String(value);
}

/** A `datetime-local` value read as IST (UTC+05:30). Empty → `now`. */
export function parseIstDateTime(input: string, now: Date): Date | null {
  const v = input.trim();
  if (!v) return now;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - 330 * 60_000;
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Date/time in IST, the way operators read program times. */
export function fmtIst(date: Date | string | number): string {
  return (
    new Date(date).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " IST"
  );
}
