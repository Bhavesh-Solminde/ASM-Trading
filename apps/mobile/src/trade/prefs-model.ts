import { z } from "zod";
import { TimeframeSchema, type Timeframe } from "@asm/contracts";
import type { ChartType } from "@/chart/types";

/** Everything the Trade screen remembers for one user. */
export interface UserPrefs {
  accountId: string | null;
  symbol: string | null;
  timeframe: Timeframe;
  chartType: ChartType;
  favourites: string[];
  /** Typed stake per account currency: ₹5,000 must never reappear as $5,000 on a USD account. */
  stakeByCurrency: Readonly<Record<string, string>>;
  expirySec: number;
}

export type PrefsByUser = Readonly<Record<string, UserPrefs>>;

export const DEFAULT_PREFS: UserPrefs = {
  accountId: null,
  symbol: null,
  timeframe: "1m",
  chartType: "candles",
  favourites: [],
  stakeByCurrency: {},
  expirySec: 60,
};

/** One user's prefs. A user with none saved gets the shared `DEFAULT_PREFS` object (never mutated), so selectors stay stable. */
export function prefsFor(all: PrefsByUser, userId: string | null): UserPrefs {
  return (userId ? all[userId] : undefined) ?? DEFAULT_PREFS;
}

export function withPrefs(all: PrefsByUser, userId: string, partial: Partial<UserPrefs>): PrefsByUser {
  return { ...all, [userId]: { ...prefsFor(all, userId), ...partial } };
}

const UserPrefsSchema = z.object({
  accountId: z.string().nullable().catch(DEFAULT_PREFS.accountId),
  symbol: z.string().nullable().catch(DEFAULT_PREFS.symbol),
  timeframe: TimeframeSchema.catch(DEFAULT_PREFS.timeframe),
  chartType: z.enum(["candles", "line", "area", "bars"]).catch(DEFAULT_PREFS.chartType),
  favourites: z.array(z.string()).catch([]),
  // The old single `stake` has no currency, so it is not migrated (unknown keys are stripped): defaults apply.
  stakeByCurrency: z.record(z.string(), z.string()).catch({}),
  expirySec: z.number().int().positive().catch(DEFAULT_PREFS.expirySec),
});

/**
 * Reads what was persisted. A bad field falls back to its default rather than dropping the user's other
 * choices; anything that is not a map of objects reads as empty.
 */
export function parsePersisted(raw: unknown): Record<string, UserPrefs> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, UserPrefs> = {};
  for (const [userId, value] of Object.entries(raw)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const parsed = UserPrefsSchema.safeParse(value);
    if (parsed.success) out[userId] = parsed.data;
  }
  return out;
}
