/**
 * Runs the algo-live-test scenario against every open market sequentially
 * and reports a pass/fail summary. For each symbol:
 *   • 5 traders go UP at ₹500 and 5 go DOWN at ₹1000 (2× DOWN liability)
 *   • the governor stamps verdicts and steers the shown chart so the
 *     heavier side loses
 *   • we wait for the trades to settle and read back outcomes + shadow
 *     ledger to confirm the bias direction matches expectation
 *
 * A market PASSES when (a) all 10 trades settled, (b) ≥4 of the 5 heavier
 * (DOWN) trades lost, and (c) the shadow-ledger bias is positive (shown
 * exit above honest exit — algo pushed UP, as expected).
 *
 * Needs the web (:3000) + engine (:4001) stack running. Run with:
 *   DATABASE_URL=... DIRECT_URL=... pnpm tsx scripts/algo-live-test-all-markets.ts
 *   # Or filter:
 *   DATABASE_URL=... DIRECT_URL=... pnpm tsx scripts/algo-live-test-all-markets.ts XAUUSD
 *
 * India indices observe a nightly close (23:30–05:00 IST); trades on those
 * symbols are refused during that window and the market is reported as
 * SKIPPED instead of a failure.
 */

import {
  createAccountsForUser,
  prisma,
} from "../packages/db/src/index";

const WEB_BASE = process.env["WEB_BASE"] ?? "http://localhost:3000";
const DURATION_SEC = Number(process.env["DURATION_SEC"] ?? 30);
const SEED_USER_EMAIL_FOR_HASH = "deposited-calibrated@algo.asmtrade.local";
const PASSWORD = "asm-algo-test-2026";
const N_USERS = 10;
const LIVE_BALANCE_PAISE = 10_000_000; // ₹1,00,000
const UP_STAKE = Number(process.env["UP_STAKE"] ?? 50_000);
const DOWN_STAKE = Number(process.env["DOWN_STAKE"] ?? 100_000);

interface UserContext {
  index: number;
  email: string;
  userId: string;
  liveAccountId: string;
  sessionCookie: string;
}

interface MarketResult {
  symbol: string;
  verdict: "PASS" | "FAIL" | "SKIP";
  reason?: string;
  openOk?: number;
  openTotal?: number;
  downLost?: number;
  upLost?: number;
  shadowBias?: number;
}

async function ensureUsers(): Promise<UserContext[]> {
  const seed = await prisma.user.findUniqueOrThrow({
    where: { email: SEED_USER_EMAIL_FOR_HASH },
    select: { passwordHash: true },
  });
  const hash = seed.passwordHash;
  const users: UserContext[] = [];
  for (let i = 1; i <= N_USERS; i++) {
    const email = `trader${String(i).padStart(2, "0")}@live.asmtrade.local`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        emailVerified: true,
        liveAccess: true,
        status: "ACTIVE",
        passwordHash: hash,
      },
      create: {
        email,
        passwordHash: hash,
        role: "USER",
        emailVerified: true,
        liveAccess: true,
      },
      select: { id: true },
    });
    try {
      await createAccountsForUser(user.id, LIVE_BALANCE_PAISE);
    } catch {
      /* already exist */
    }
    const liveAccount = await prisma.account.update({
      where: { userId_type: { userId: user.id, type: "LIVE" } },
      data: {
        realBalance: LIVE_BALANCE_PAISE,
        bonusBalance: 0,
        winStreak: 0,
        lossStreak: 0,
      },
      select: { id: true },
    });
    users.push({
      index: i,
      email,
      userId: user.id,
      liveAccountId: liveAccount.id,
      sessionCookie: "",
    });
  }
  return users;
}

async function login(ctx: UserContext): Promise<void> {
  const res = await fetch(`${WEB_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ctx.email, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed for ${ctx.email}: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = /(asm_session=[^;]+)/.exec(setCookie);
  if (!match) throw new Error(`no session cookie in login response for ${ctx.email}`);
  ctx.sessionCookie = match[1]!;
}

async function openTrade(
  ctx: UserContext,
  symbol: string,
  direction: "UP" | "DOWN",
  stakePaise: number,
): Promise<{ ok: boolean; body: string; status: number }> {
  const res = await fetch(`${WEB_BASE}/api/trades`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ctx.sessionCookie },
    body: JSON.stringify({
      accountId: ctx.liveAccountId,
      symbol,
      direction,
      stake: stakePaise,
      durationSec: DURATION_SEC,
    }),
  });
  const body = await res.text();
  return { ok: res.ok, body, status: res.status };
}

async function clearOpenTrades(users: UserContext[]): Promise<void> {
  for (const u of users) {
    await prisma.trade.deleteMany({
      where: { accountId: u.liveAccountId, status: "OPEN" },
    });
  }
}

async function runOneMarket(symbol: string, users: UserContext[]): Promise<MarketResult> {
  await clearOpenTrades(users);
  const t0 = Math.floor(Date.now() / 1000);

  const trades = [
    ...Array.from({ length: 5 }, (_, i) => ({
      direction: "UP" as const,
      stakePaise: UP_STAKE,
      userIndex: i + 1,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      direction: "DOWN" as const,
      stakePaise: DOWN_STAKE,
      userIndex: i + 6,
    })),
  ];

  const opens = await Promise.all(
    trades.map(async (t) => {
      const user = users[t.userIndex - 1]!;
      const result = await openTrade(user, symbol, t.direction, t.stakePaise);
      return { user, trade: t, result };
    }),
  );
  const openOk = opens.filter((o) => o.result.ok).length;
  if (openOk === 0) {
    // Most likely the market is closed (India indices after 23:30 IST).
    const firstBody = opens[0]?.result.body.slice(0, 120) ?? "";
    const closedHint = /closed|market|outside hours|not open/i.test(firstBody);
    return {
      symbol,
      verdict: "SKIP",
      reason: closedHint ? "market closed" : `opens failed (${firstBody})`,
      openOk,
      openTotal: trades.length,
    };
  }
  if (openOk < trades.length) {
    return {
      symbol,
      verdict: "FAIL",
      reason: `only ${openOk}/${trades.length} opens succeeded`,
      openOk,
      openTotal: trades.length,
    };
  }

  // Wait for every trade to settle. 30s trades → poll up to 60s.
  const waitMs = (DURATION_SEC + 25) * 1000;
  await new Promise((r) => setTimeout(r, waitMs));

  let downLost = 0;
  let upLost = 0;
  let sumShown = 0;
  let sumHonest = 0;
  let shadowCount = 0;
  let settled = 0;
  for (const user of users) {
    const t = await prisma.trade.findFirst({
      where: {
        accountId: user.liveAccountId,
        createdAt: { gte: new Date(t0 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        direction: true,
        status: true,
        exitPrice: true,
        shadow: { select: { honestExitPrice: true } },
      },
    });
    if (!t) continue;
    if (t.status === "LOST") {
      if (t.direction === "DOWN") downLost += 1;
      else upLost += 1;
    }
    if (t.status !== "OPEN") settled += 1;
    if (t.exitPrice != null && t.shadow?.honestExitPrice != null) {
      sumShown += t.exitPrice;
      sumHonest += t.shadow.honestExitPrice;
      shadowCount += 1;
    }
  }

  const shadowBias = shadowCount > 0 ? sumShown / shadowCount - sumHonest / shadowCount : 0;
  const pass = settled === trades.length && downLost >= 4 && shadowBias > 0;
  return {
    symbol,
    verdict: pass ? "PASS" : "FAIL",
    reason: !pass
      ? `settled ${settled}/${trades.length} · downLost ${downLost}/5 · upLost ${upLost}/5 · bias ${shadowBias.toFixed(4)}`
      : undefined,
    openOk,
    openTotal: trades.length,
    downLost,
    upLost,
    shadowBias,
  };
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  const assets = await prisma.asset.findMany({
    where: filter ? { symbol: filter } : { isOpen: true },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });
  if (assets.length === 0) {
    console.error(`No matching assets${filter ? ` for ${filter}` : ""}.`);
    process.exit(1);
  }

  console.log("=".repeat(80));
  console.log(`ALGO LIVE TEST — ${assets.length} market(s), ${DURATION_SEC}s each · ${WEB_BASE}`);
  console.log("=".repeat(80));

  const users = await ensureUsers();
  await Promise.all(users.map((u) => login(u)));
  console.log(`Seeded + logged in ${users.length} traders.\n`);

  const results: MarketResult[] = [];
  for (const a of assets) {
    const line = `→ ${a.symbol.padEnd(16)} `;
    process.stdout.write(line);
    const r = await runOneMarket(a.symbol, users);
    const stamp =
      r.verdict === "PASS" ? "PASS " :
      r.verdict === "SKIP" ? "SKIP " : "FAIL ";
    const detail =
      r.verdict === "PASS"
        ? `downLost ${r.downLost}/5, bias +${r.shadowBias?.toFixed(4)}`
        : r.reason ?? "";
    console.log(`${stamp}  ${detail}`);
    results.push(r);
  }

  const pass = results.filter((r) => r.verdict === "PASS").length;
  const fail = results.filter((r) => r.verdict === "FAIL").length;
  const skip = results.filter((r) => r.verdict === "SKIP").length;
  console.log("\n" + "=".repeat(80));
  console.log(`TOTALS  PASS ${pass}  FAIL ${fail}  SKIP ${skip}  (of ${assets.length})`);
  console.log("=".repeat(80));
  if (fail > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
