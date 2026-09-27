import { NextResponse, type NextRequest } from "next/server";
import { CreateDepositSchema, type DepositView } from "@asm/contracts";
import {
  AmountSpaceExhausted,
  createDepositIntent,
  createUsdtDepositIntent,
  listDepositsForActor,
} from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";

// Read directly via process.env, not piped through @asm/config's strict
// shared schema — same precedent as SMS_RELAY_SECRET (see .env.example) and
// the engine's own chain-watcher/runner.ts, since these are specific to this
// one feature. Mirrors the exact set runner.ts requires before it treats the
// watcher as "configured" — a deposit created when the watcher would stay
// idle could never be detected or credited, so this route must refuse it
// rather than hand the user an address nothing is watching.
function usdtDepositConfig(): { network: string; tokenContract: string; receivingAddress: string } | null {
  const network = process.env["USDT_NETWORK"] ?? "";
  const trongridNetwork = process.env["USDT_TRONGRID_NETWORK"] ?? "";
  const tokenContract = process.env["USDT_TOKEN_CONTRACT"] ?? "";
  const receivingAddress = process.env["USDT_RECEIVING_ADDRESS"] ?? "";
  const trongridNetworkValid = trongridNetwork === "mainnet" || trongridNetwork === "nile";
  if (network !== "tron" || !trongridNetworkValid || !tokenContract || !receivingAddress) return null;
  return { network, tokenContract, receivingAddress };
}

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:deposit:${session.userId}`, 10, 300))) {
    log.warn({ evt: "security.rate_limited", route: "deposits" }, "deposit throttled");
    return NextResponse.json(
      { error: "Too many deposit attempts. Wait a few minutes." },
      { status: 429 },
    );
  }

  const parsed = CreateDepositSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn(
      { evt: "security.validation_rejected", route: "deposits" },
      "rejected deposit payload",
    );
    return NextResponse.json({ error: "Check the deposit details." }, { status: 400 });
  }

  try {
    if (parsed.data.method === "USDT") {
      const config = usdtDepositConfig();
      if (!config) {
        log.warn({ evt: "deposit.usdt_unavailable", route: "deposits" }, "USDT deposit requested but not configured");
        return NextResponse.json(
          { error: "USDT deposits are temporarily unavailable. Try again later." },
          { status: 503 },
        );
      }

      const deposit = await createUsdtDepositIntent({
        userId: session.userId,
        amountUsdtMinorRequested: parsed.data.amountUsdtMinor,
        network: config.network,
        tokenContract: config.tokenContract,
        receivingAddress: config.receivingAddress,
        correlationId: ctx.cid,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      log.info(
        {
          evt: "deposit.intent",
          depositId: deposit.id,
          method: deposit.method,
          amountUsdtMinor: deposit.amountUsdtMinor,
        },
        "USDT deposit intent created",
      );

      return NextResponse.json({ checkoutToken: deposit.checkoutToken }, { status: 201 });
    }

    const deposit = await createDepositIntent({
      userId: session.userId,
      method: parsed.data.method,
      amountInrMinor: parsed.data.amountInr,
      correlationId: ctx.cid,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    log.info(
      {
        evt: "deposit.intent",
        depositId: deposit.id,
        method: deposit.method,
        amountInr: deposit.amountInr,
      },
      "deposit intent created",
    );

    return NextResponse.json({ checkoutToken: deposit.checkoutToken }, { status: 201 });
  } catch (err) {
    if (err instanceof AmountSpaceExhausted) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof Error && /minimum|maximum/i.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const deposits = await listDepositsForActor(session.userId, 50);
  const view: DepositView[] = deposits.map((d) => ({
    id: d.id,
    method: d.method,
    amountUsd: d.amountUsd,
    // A USDT deposit stores -amountUsdtMinor here as a reservation sentinel
    // (see createUsdtDepositIntent) — never a real INR amount, so it's not
    // surfaced as one.
    amountInr: d.method === "USDT" ? 0 : d.amountInr,
    amountUsdtMinor: d.amountUsdtMinor,
    network: d.network,
    status: d.status,
    claimedUtr: d.claimedUtr,
    claimedTxHash: d.claimedTxHash,
    createdAt: Math.floor(d.createdAt.getTime() / 1000),
  }));

  return NextResponse.json({ deposits: view }, { headers: { "Cache-Control": "no-store" } });
}
