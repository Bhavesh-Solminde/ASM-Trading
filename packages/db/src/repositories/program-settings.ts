import { prisma, type DbTransaction } from "../client";
import type { ProgramSettingKey } from "../../generated/prisma/client";
import type { ProgramSetting } from "../models";

export const PROGRAM_SETTING_KEYS = [
  "MIN_QUALIFYING_DEPOSIT_INR_MINOR",
  "MIN_QUALIFYING_TRADE_INR_MINOR",
  "USER_REFERRAL_REWARD_INR_MINOR",
  "AFFILIATE_DEPOSIT_REWARD_BPS",
  "INVITE_EXTRA_BONUS_PCT",
] as const satisfies readonly ProgramSettingKey[];

export interface ProgramSettings {
  values: Record<ProgramSettingKey, number>;
  /** The ProgramSetting row each value came from — snapshot these on anything earned. */
  ids: Record<ProgramSettingKey, string>;
}

type SettingRow = Pick<ProgramSetting, "id" | "key" | "value" | "effectiveFrom" | "createdAt">;

/**
 * The values in force at `at`: per key, the row with the latest effectiveFrom <= at
 * (a later-created row wins a tie). Throws if a key has no version yet — the
 * migration seeds every key from the epoch, so that means a broken database.
 */
export function settingsAt(rows: readonly SettingRow[], at: Date): ProgramSettings {
  const best = new Map<ProgramSettingKey, SettingRow>();
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > at.getTime()) continue;
    const cur = best.get(row.key);
    if (
      !cur ||
      row.effectiveFrom.getTime() > cur.effectiveFrom.getTime() ||
      (row.effectiveFrom.getTime() === cur.effectiveFrom.getTime() && row.createdAt.getTime() > cur.createdAt.getTime())
    ) {
      best.set(row.key, row);
    }
  }
  const values = {} as Record<ProgramSettingKey, number>;
  const ids = {} as Record<ProgramSettingKey, string>;
  for (const key of PROGRAM_SETTING_KEYS) {
    const row = best.get(key);
    if (!row) throw new Error(`No ProgramSetting ${key} in force at ${at.toISOString()}.`);
    values[key] = row.value;
    ids[key] = row.id;
  }
  return { values, ids };
}

/** Every setting version (a handful of rows; settings change rarely). */
export async function listProgramSettingRows(
  client: Pick<DbTransaction, "programSetting"> = prisma,
): Promise<SettingRow[]> {
  return client.programSetting.findMany({
    select: { id: true, key: true, value: true, effectiveFrom: true, createdAt: true },
  });
}

export async function getProgramSettings(
  at: Date,
  client: Pick<DbTransaction, "programSetting"> = prisma,
): Promise<ProgramSettings> {
  return settingsAt(await listProgramSettingRows(client), at);
}
