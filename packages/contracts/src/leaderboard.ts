import { z } from "zod";

export const LeaderboardEntrySchema = z.object({
  accountId: z.string(),
  userId: z.string(),
  nickname: z.string().nullable(),
  /** ISO alpha-2, normalized server-side. */
  country: z.string().nullable(),
  /** The board's display currency; every entry shares it. */
  currency: z.string(),
  /** Today's P/L in minor units of `currency`; illustrative when source is demo. */
  pnlMinor: z.number().int(),
  market: z.string().optional(),
  returnPct: z.number().nullable().optional(),
});
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResultSchema = z.object({
  source: z.enum(["demo", "live"]).optional(),
  entries: z.array(LeaderboardEntrySchema),
  you: z.object({
    rank: z.number().int().positive().nullable(),
    entry: LeaderboardEntrySchema.nullable(),
  }),
});
export type LeaderboardResultDto = z.infer<typeof LeaderboardResultSchema>;
