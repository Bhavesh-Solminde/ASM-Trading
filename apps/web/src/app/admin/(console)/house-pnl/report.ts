import { convertMinorBetween, houseDateForInstant, prisma } from "@asm/db";

export const DAILY_TARGET_MINOR = 1_000_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HISTORY_DAYS = 30;

type DailyTotals = {
  date: string;
  stakes: number;
  payouts: number;
  settled: number;
};

type CurrencyTotals = {
  date: string;
  currency: string;
  stakes: string;
  payouts: string;
  settled: bigint;
};

export async function readDailyOtcVault(now = new Date()) {
  const today = houseDateForInstant(now).getTime();
  const oldestDay = today - (HISTORY_DAYS - 1) * DAY_MS;
  const startsAt = new Date(oldestDay - IST_OFFSET_MS);

  // Group the immutable settlement amounts in the trade's opening currency.
  // Prisma stores closedAt as a UTC timestamp without a timezone.
  const rows = await prisma.$queryRaw<CurrencyTotals[]>`
    SELECT to_char(t."closedAt" + interval '5 hours 30 minutes', 'YYYY-MM-DD') AS date,
           coalesce(t.currency, a.currency) AS currency,
           sum(t.stake)::text AS stakes,
           sum(t.stake + t.pnl)::text AS payouts,
           count(*) AS settled
    FROM "Trade" t
    JOIN "Account" a ON a.id = t."accountId"
    JOIN "User" u ON u.id = a."userId"
    WHERE t.mode = 'OTC_FIXED'
      AND t.status IN ('WON', 'LOST', 'REFUNDED')
      AND a.type = 'LIVE'
      AND u.role = 'USER'
      AND t."closedAt" >= ${startsAt}
      AND t."closedAt" <= ${now}
    GROUP BY 1, 2
  `;

  const totals = new Map<string, DailyTotals>();
  for (const row of rows) {
    const day = totals.get(row.date) ?? { date: row.date, stakes: 0, payouts: 0, settled: 0 };
    day.stakes += convertMinorBetween(Number(row.stakes), row.currency, "INR");
    day.payouts += convertMinorBetween(Number(row.payouts), row.currency, "INR");
    day.settled += Number(row.settled);
    totals.set(row.date, day);
  }

  return Array.from({ length: HISTORY_DAYS }, (_, index) => {
    const date = new Date(today - index * DAY_MS).toISOString().slice(0, 10);
    const day = totals.get(date) ?? { date, stakes: 0, payouts: 0, settled: 0 };
    return { ...day, profit: day.stakes - day.payouts };
  });
}
