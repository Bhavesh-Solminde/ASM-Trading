import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addIstDays, getProgramSummary, istDay, istDayStart, istLimitWindows, prisma, type Bucket, type Range } from "@asm/db";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const requireAffiliate = cache(async (nonAffiliateRedirect = "/trade") => {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/affiliate/login");
  if (session.role !== "AFFILIATE") redirect(nonAffiliateRedirect);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, legacySimulated: true, email: true, emailVerified: true, createdAt: true },
  });
  if (!user) redirect("/affiliate/login");
  if (user.role !== "AFFILIATE" || user.legacySimulated) redirect("/trade");
  return user;
});

export const readAffiliateSummary = cache(getProgramSummary);

export type CenterQuery = Record<string, string | string[] | undefined>;

export function queryValue(query: CenterQuery, key: string): string {
  const value = query[key];
  return typeof value === "string" ? value : "";
}

function validDay(day: string): boolean {
  try {
    return istDay(istDayStart(day)) === day;
  } catch {
    return false;
  }
}

export function affiliateMonth(now: Date): Range {
  return { from: istLimitWindows(now).monthStart, to: istDayStart(addIstDays(istDay(now), 1)) };
}

export function affiliateAllTime(createdAt: Date, now: Date): Range {
  return { from: istLimitWindows(createdAt).dayStart, to: istDayStart(addIstDays(istDay(now), 1)) };
}

export function statisticsPeriod(query: CenterQuery, createdAt: Date, now: Date) {
  const today = istDay(now);
  const requested = queryValue(query, "period");
  const presetDays: Record<string, number> = { week: 7, month: 30, year: 365 };
  const period = ["week", "month", "year", "all", "custom"].includes(requested) ? requested : "week";
  let from = period === "all" ? istDay(createdAt) : addIstDays(today, 1 - (presetDays[period] ?? 7));
  let to = today;
  let error: string | undefined;

  if (period === "custom") {
    const start = queryValue(query, "from");
    const end = queryValue(query, "to");
    if (validDay(start) && validDay(end) && start <= end && end <= today) {
      from = start;
      to = end;
    } else {
      error = "Choose a start and end date in order, up to today. Showing the last 7 days.";
    }
  }

  return { period, from, to, today, error, range: { from: istDayStart(from), to: istDayStart(addIstDays(to, 1)) } };
}

export function chartBucket(query: CenterQuery, spanInDays: number): Bucket {
  const bucket = queryValue(query, "bucket");
  if (bucket === "day" || bucket === "week" || bucket === "month") return bucket;
  return spanInDays > 110 ? "month" : spanInDays > 35 ? "week" : "day";
}

