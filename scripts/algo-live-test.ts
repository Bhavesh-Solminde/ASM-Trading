/**
 * End-to-end algorithm test with 100 concurrent traders.
 *
 * Scenario: 50 users place UP, 50 users place DOWN on NIFTY50 with a
 * 30-second duration. DOWN carries 2× the money at stake → the algorithm
 * should push the shown chart UP (making DOWN lose), gradually across the
 * trade lifetime, then decay back toward the honest feed after expiry.
 *
 * The script seeds the 100 users if they don't already exist, logs each in
 * via HTTP, opens their trades in chunked parallel batches, then polls the
 * chart via Prisma + the API to record the price trajectory. Results print
 * at the end.
 *
 * Requires the local dev servers (web on :3000, engine on :4001) to be up.
 * Run with:  pnpm tsx scripts/algo-live-test.ts
 */

import {
  createAccountsForUser,
  prisma,
} from "@asm/db";

const WEB_BASE = process.env["WEB_BASE"] ?? "http://localhost:3000";
// Fully synthetic OTC market — no external anchor, so the algo's bias has
// full authority and the effect is measurable without a real feed pulling
// against it. Real-feed markets (BTCUSDT) also get the manipulation but it
// stays within one tick-sigma of noise, invisible against the live feed.
const SYMBOL = process.env["SYMBOL"] ?? "NIFTY50";
const DURATION_SEC = 30;
// Reuses the algo-seed password already hashed on the seeded users — we
// copy that user's passwordHash into every test user rather than depending
// on argon2 being installed at the repo root. Env-overridable so the same
// script can target prod with a user whose password is known at runtime.
const SEED_USER_EMAIL_FOR_HASH =
  process.env["SEED_USER_EMAIL_FOR_HASH"] ?? "deposited-calibrated@algo.asmtrade.local";
const PASSWORD = process.env["PASSWORD"] ?? "asm-algo-test-2026";
const N_USERS = Number(process.env["N_USERS"] ?? 100);
const LIVE_BALANCE_PAISE = 10_000_000; // ₹1,00,000
// Chunk size for parallel HTTP calls — 100 users opening a trade in one
// Promise.all melts the dev web server's connection pool, so we open in
// chunks with a tiny delay in between.
const OPEN_CHUNK = Number(process.env["OPEN_CHUNK"] ?? 20);
const OPEN_CHUNK_DELAY_MS = Number(process.env["OPEN_CHUNK_DELAY_MS"] ?? 100);

// Canonical scenario — 50% UP, 50% DOWN. UP_STAKE and DOWN_STAKE are per
// trade; DOWN carries 2× the liability per trader, so with equal counts the
// book-side ratio is 2× DOWN. Under house-first the chart should push UP.
const UP_STAKE = Number(process.env["UP_STAKE"] ?? 50_000); // ₹500
const DOWN_STAKE = Number(process.env["DOWN_STAKE"] ?? 100_000); // ₹1000
const UP_COUNT = Math.floor(N_USERS / 2);
const DOWN_COUNT = N_USERS - UP_COUNT;
const TRADES = [
  ...Array.from({ length: UP_COUNT }, (_, i) => ({
    direction: "UP" as const,
    stakePaise: UP_STAKE,
    userIndex: i + 1,
  })),
  ...Array.from({ length: DOWN_COUNT }, (_, i) => ({
    direction: "DOWN" as const,
    stakePaise: DOWN_STAKE,
    userIndex: UP_COUNT + i + 1,
  })),
];

async function chunkedParallel<T, R>(
  items: T[],
  size: number,
  delayMs: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const results = await Promise.all(slice.map(fn));
    out.push(...results);
    if (i + size < items.length && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return out;
}

interface UserContext {
  index: number;
  email: string;
  userId: string;
  liveAccountId: string;
  sessionCookie: string;
}

async function ensureUsers(): Promise<UserContext[]> {
  const seed = await prisma.user.findUniqueOrThrow({
    where: { email: SEED_USER_EMAIL_FOR_HASH },
    select: { passwordHash: true },
  });
  const hash = seed.passwordHash;
  const users: UserContext[] = [];

  for (let i = 1; i <= N_USERS; i++) {
    // 3-digit padding supports N_USERS up to 999. Pre-existing trader01..10
    // rows from older 2-digit runs stay orphaned in the DB but do not affect
    // this test (we only touch our own padded emails).
    const email = `trader${String(i).padStart(3, "0")}@live.asmtrade.local`;
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
      /* accounts already exist */
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
    // Clean out any prior open trades that would still be in the engine's
    // book — a stale OPEN row would pollute this test's imbalance.
    await prisma.trade.deleteMany({
      where: { accountId: liveAccount.id, status: "OPEN" },
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
  direction: "UP" | "DOWN",
  stakePaise: number,
): Promise<{ ok: boolean; body: string; status: number }> {
  const res = await fetch(`${WEB_BASE}/api/trades`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: ctx.sessionCookie,
    },
    body: JSON.stringify({
      accountId: ctx.liveAccountId,
      symbol: SYMBOL,
      direction,
      stake: stakePaise,
      durationSec: DURATION_SEC,
    }),
  });
  const body = await res.text();
  return { ok: res.ok, body, status: res.status };
}

async function readAssetState(): Promise<{ id: string; sym: string; kind: string }> {
  const asset = await prisma.asset.findFirstOrThrow({
    where: { symbol: SYMBOL },
    select: { id: true, symbol: true, kind: true },
  });
  return { id: asset.id, sym: asset.symbol, kind: asset.kind };
}

async function readCandles(assetId: string, since: number): Promise<
  { ts: number; c: number }[]
> {
  const rows = await prisma.candle.findMany({
    where: {
      assetId,
      timeframe: "1m",
      openTs: { gte: new Date(since * 1000) },
    },
    orderBy: { openTs: "asc" },
    select: { openTs: true, c: true },
  });
  return rows.map((r) => ({
    ts: Math.floor(r.openTs.getTime() / 1000),
    c: r.c,
  }));
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log(`ALGO LIVE TEST — ${N_USERS} traders, ${SYMBOL}, ${DURATION_SEC}s`);
  console.log("=".repeat(72));

  const asset = await readAssetState();
  console.log(`Asset: ${asset.sym} (${asset.kind}) id=${asset.id.slice(0, 8)}`);

  const t0 = Math.floor(Date.now() / 1000);
  console.log(`\n[T-0] Seeding + logging in ${N_USERS} users...`);
  const users = await ensureUsers();
  await chunkedParallel(users, OPEN_CHUNK, OPEN_CHUNK_DELAY_MS, (u) => login(u));
  console.log(`      Done. Sessions established for ${users.length} traders.`);

  console.log(
    `\n[T-0] Opening trades — ${UP_COUNT} × ₹${UP_STAKE / 100} UP + ${DOWN_COUNT} × ₹${DOWN_STAKE / 100} DOWN ` +
      `(chunked ${OPEN_CHUNK} at a time)`,
  );
  const opens = await chunkedParallel(TRADES, OPEN_CHUNK, OPEN_CHUNK_DELAY_MS, async (t) => {
    const user = users[t.userIndex - 1]!;
    const result = await openTrade(user, t.direction, t.stakePaise);
    return { user, trade: t, result };
  });
  const okOpens = opens.filter((o) => o.result.ok);
  console.log(`      ${okOpens.length}/${opens.length} trades opened successfully.`);
  for (const o of opens) {
    if (!o.result.ok) {
      console.log(
        `      FAIL trader${String(o.user.index).padStart(3, "0")}: ` +
          `${o.result.status} ${o.result.body.slice(0, 100)}`,
      );
    }
  }
  // Accept small open-side flakiness on 100-user runs: a few 429/503s under
  // load would otherwise fail an otherwise-good imbalance signal. Need at
  // least 80% of each side to see the effect clearly.
  const upOk = okOpens.filter((o) => o.trade.direction === "UP").length;
  const downOk = okOpens.filter((o) => o.trade.direction === "DOWN").length;
  if (upOk < UP_COUNT * 0.8 || downOk < DOWN_COUNT * 0.8) {
    console.log(
      `\n  Aborting — opens too thin to measure (${upOk}/${UP_COUNT} UP, ${downOk}/${DOWN_COUNT} DOWN).`,
    );
    return;
  }

  const upLiability = upOk * UP_STAKE * 0.87;
  const downLiability = downOk * DOWN_STAKE * 0.87;
  console.log(`\n[T-0] Book imbalance recorded:`);
  console.log(`         UP  liability = ${upLiability.toLocaleString()} paise (${(upLiability / 100).toLocaleString()} ₹)`);
  console.log(`         DOWN liability = ${downLiability.toLocaleString()} paise (${(downLiability / 100).toLocaleString()} ₹)`);
  console.log(`         ratio          = ${(downLiability / upLiability).toFixed(2)}× DOWN`);
  console.log(`         → the algo should push chart UP so DOWN loses.\n`);

  const startPrice = (await prisma.candle.findFirst({
    where: { assetId: asset.id, timeframe: "1m" },
    orderBy: { openTs: "desc" },
    select: { c: true },
  }))?.c;
  console.log(`[T-0] Starting price: ${startPrice}`);

  // Poll for 75s (60s trade + 15s decay observation)
  console.log(`\nWatching price for ${DURATION_SEC + 15}s...\n`);
  const samples: { t: number; c: number | undefined }[] = [];
  for (let sec = 0; sec <= DURATION_SEC + 15; sec += 5) {
    await new Promise((r) => setTimeout(r, 5_000));
    const latest = await prisma.candle.findFirst({
      where: { assetId: asset.id, timeframe: "1m" },
      orderBy: { openTs: "desc" },
      select: { c: true },
    });
    samples.push({ t: sec, c: latest?.c });
    console.log(`  T+${String(sec).padStart(2, " ")}s  price=${latest?.c ?? "?"}`);
  }

  // Fetch trade outcomes + the shadow ledger. TradeShadow records the honest
  // (unbiased) exit price the market would have shown alongside the actual
  // (biased) exit price. The gap between them is exactly the algo's
  // manipulation for this bucket.
  console.log(`\n[T+${DURATION_SEC + 15}s] Trade outcomes:`);
  const outcomes = { WON: 0, LOST: 0, REFUNDED: 0, OPEN: 0 };
  let sumShown = 0;
  let sumHonest = 0;
  let shadowCount = 0;
  for (const user of users) {
    const trades = await prisma.trade.findMany({
      where: {
        accountId: user.liveAccountId,
        createdAt: { gte: new Date(t0 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: {
        id: true,
        direction: true,
        stake: true,
        status: true,
        exitPrice: true,
        entryPrice: true,
        pnl: true,
        shadow: { select: { honestExitPrice: true, biasApplied: true } },
      },
    });
    const t = trades[0];
    if (!t) {
      console.log(`  trader${String(user.index).padStart(2, "0")}: no trade found`);
      continue;
    }
    outcomes[t.status as keyof typeof outcomes] += 1;
    const rupeePnl = (t.pnl / 100).toFixed(2);
    const honest = t.shadow?.honestExitPrice ?? null;
    const bias = t.shadow?.biasApplied ?? null;
    if (t.exitPrice != null && honest != null) {
      sumShown += t.exitPrice;
      sumHonest += honest;
      shadowCount += 1;
    }
    console.log(
      `  trader${String(user.index).padStart(2, "0")}: ${t.direction} ` +
        `stake=₹${(t.stake / 100).toString().padStart(6, " ")} ` +
        `${t.status.padEnd(9)} pnl=₹${rupeePnl.padStart(10, " ")} ` +
        `entry=${t.entryPrice} exit=${t.exitPrice ?? "-"} ` +
        `honest=${honest ?? "-"} bias=${bias ?? "-"}`,
    );
  }
  console.log(`\n  Totals: WON=${outcomes.WON} LOST=${outcomes.LOST} REFUNDED=${outcomes.REFUNDED} OPEN=${outcomes.OPEN}`);
  if (shadowCount > 0) {
    const avgShown = sumShown / shadowCount;
    const avgHonest = sumHonest / shadowCount;
    const delta = avgShown - avgHonest;
    console.log(
      `  Average shown exit vs honest exit: ${avgShown.toFixed(4)} vs ${avgHonest.toFixed(4)} → algo bias = ${delta.toFixed(4)} ${delta > 0 ? "(pushed UP)" : "(pushed DOWN)"}`,
    );
  }

  console.log("\n=".repeat(72));
  console.log("DONE");
  console.log("=".repeat(72));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
