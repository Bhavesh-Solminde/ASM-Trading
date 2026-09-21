import { z } from "zod";

export const LeaderboardEntrySchema = z.object({
  accountId: z.string(),
  userId: z.string(),
  nickname: z.string().nullable(),
  country: z.string().nullable(),
  currency: z.string(),
  pnlMinor: z.number().int(),
});
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResultSchema = z.object({
  entries: z.array(LeaderboardEntrySchema),
  you: z.object({
    rank: z.number().int().positive().nullable(),
    entry: LeaderboardEntrySchema.nullable(),
  }),
});
export type LeaderboardResultDto = z.infer<typeof LeaderboardResultSchema>;
