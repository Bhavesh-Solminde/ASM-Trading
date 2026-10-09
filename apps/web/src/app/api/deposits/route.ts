import { NextResponse, type NextRequest } from "next/server";
import { CreateDepositSchema, USDT_NETWORK_INFO, type DepositView } from "@asm/contracts";
import {
  AmountSpaceExhausted,
  MAX_DEPOSIT_USDT_MINOR,
  MIN_DEPOSIT_USDT_MINOR,
  allocateGatewayAddressIndex,
  createDepositIntent,
  createGatewayUsdtDeposit,
  createUsdtSlotDepositIntent,
  listDepositsForActor,
  setGatewaySubscriptionId,
  UsdtSlotBusy,
} from "@asm/db";
import { createGatewayChain, createIncomingTokenSubscription } from "@asm/tatum";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getGatewayUsdtConfig,
  getUsdtNetworkConfig,
  listEnabledUsdtNetworks,
  usdtGatewayActive,
} from "@/lib/usdt-networks";
import { pickCollectionVpa, upiDepositsEnabled } from "@/lib/upi-collection";
import { checkNetwork, vpnBlockedResponse } from "@/lib/network-guard/guard";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if ((await checkNetwork({ ip: ctx.ip, route: "deposits", log, userId: session.userId })).blocked) {
    return vpnBlockedResponse();
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

  // UPI rails stay closed until UPI_DEPOSITS_ENABLED=on — the picker shows
  // them as "Coming soon" meanwhile. Reject here too so a crafted request
  // can't open an INR deposit intent no relay phone is there to settle.
  if (parsed.data.method !== "USDT" && !upiDepositsEnabled()) {
    log.warn(
      { evt: "deposit.upi_disabled", route: "deposits", method: parsed.data.method },
      "UPI deposit requested while UPI rails are disabled",
    );
    return NextResponse.json(
      { error: `${parsed.data.method} deposits are coming soon. Use USDT for now.` },
      { status: 503 },
    );
  }

  try {
    if (parsed.data.method === "USDT" && usdtGatewayActive(parsed.data.network)) {
      // Payment gateway (Tatum): a fresh receiving address per deposit,
      // derived from the gateway's xpub; matched by address, not amount.
      const network = parsed.data.network;
      const amount = parsed.data.amountUsdtMinor;
      const cfg = getGatewayUsdtConfig(network);
      if (!cfg) {
        log.warn(
          { evt: "deposit.usdt_unavailable", route: "deposits", network, provider: "tatum" },
          "USDT gateway deposit requested on a network that is not configured",
        );
        return NextResponse.json(
          { error: `USDT on ${USDT_NETWORK_INFO[network].label} is temporarily unavailable. Try again later.` },
          { status: 503 },
        );
      }
      // Bounds first, so a rejected amount never burns an address index or a Tatum call.
      if (amount < MIN_DEPOSIT_USDT_MINOR || amount > MAX_DEPOSIT_USDT_MINOR) {
        return NextResponse.json(
          {
            error: `Deposit between $${(MIN_DEPOSIT_USDT_MINOR / 100).toLocaleString("en-US")} and $${(MAX_DEPOSIT_USDT_MINOR / 100).toLocaleString("en-US")}.`,
          },
          { status: 400 },
        );
      }

      let addressIndex: number;
      let address: string;
      try {
        addressIndex = await allocateGatewayAddressIndex(cfg.network);
        address = await createGatewayChain(cfg).deriveAddress(addressIndex);
      } catch (err) {
        log.error(
          { evt: "deposit.gateway_address_failed", network, err: (err as Error).message },
          "could not derive a gateway deposit address",
        );
        return NextResponse.json(
          { error: `USDT on ${USDT_NETWORK_INFO[network].label} is temporarily unavailable. Try again later.` },
          { status: 503 },
        );
      }

      const deposit = await createGatewayUsdtDeposit({
        userId: session.userId,
        amountUsdtMinorRequested: amount,
        network: cfg.network,
        tokenContract: cfg.tokenContract,
        receivingAddress: address,
        addressIndex,
        correlationId: ctx.cid,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });

      // Webhook alert = faster detection. Best-effort: the engine poller
      // watches every live gateway address regardless, so a Tatum alerts
      // outage never blocks a deposit.
      if (cfg.webhookUrl) {
        try {
          await setGatewaySubscriptionId(deposit.id, await createIncomingTokenSubscription(cfg, address));
        } catch (err) {
          log.warn(
            { evt: "deposit.gateway_alert_failed", depositId: deposit.id, err: (err as Error).message },
            "could not create Tatum alert; poller will cover this address",
          );
        }
      }

      log.info(
        {
          evt: "deposit.intent",
          depositId: deposit.id,
          method: deposit.method,
          network: cfg.network,
          gateway: deposit.gateway,
          addressIndex,
          amountUsdtMinor: deposit.amountUsdtMinor,
        },
        "USDT gateway deposit intent created",
      );
      return NextResponse.json({ checkoutToken: deposit.checkoutToken }, { status: 201 });
    }

    if (parsed.data.method === "USDT") {
      // Manual provider: the user's own amount on a shared receiving address
      // that this deposit holds alone for its 5-minute slot (rotating across
      // the configured addresses). Only the requested network's config is
      // consulted: a deposit on a network whose watcher would stay idle could
      // never be detected or credited, so refuse it rather than hand out an
      // unwatched address.
      const network = parsed.data.network;
      const config = getUsdtNetworkConfig(network);
      if (!config) {
        log.warn(
          { evt: "deposit.usdt_unavailable", route: "deposits", network },
          "USDT deposit requested on a network that is not configured",
        );
        return NextResponse.json(
          { error: `USDT on ${USDT_NETWORK_INFO[network].label} is temporarily unavailable. Try again later.` },
          { status: 503 },
        );
      }

      const sender = parsed.data.senderAddress ?? null;
      if (sender && (network === "tron") !== sender.startsWith("T")) {
        return NextResponse.json(
          { error: `That wallet address is not a ${USDT_NETWORK_INFO[network].label} address.` },
          { status: 400 },
        );
      }

      let deposit;
      try {
        deposit = await createUsdtSlotDepositIntent({
          userId: session.userId,
          amountUsdtMinorRequested: parsed.data.amountUsdtMinor,
          network: config.network,
          tokenContract: config.tokenContract,
          receivingAddresses: config.receivingAddresses,
          // EVM addresses are stored lowercase, like the watcher's ChainCredit rows.
          senderAddress: sender && network === "bsc" ? sender.toLowerCase() : sender,
          correlationId: ctx.cid,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
        });
      } catch (err) {
        if (!(err instanceof UsdtSlotBusy)) throw err;
        const minutes = Math.max(1, Math.ceil((err.retryAt.getTime() - Date.now()) / 60_000));
        const alternative = listEnabledUsdtNetworks().find((n) => n !== network);
        log.info({ evt: "deposit.usdt_slot_busy", network, retryAt: err.retryAt.toISOString() }, "every USDT slot is busy");
        return NextResponse.json(
          {
            error:
              `Other ${USDT_NETWORK_INFO[network].label} deposits are in progress. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}` +
              (alternative ? `, or use ${USDT_NETWORK_INFO[alternative].label} (recommended) — no waiting.` : "."),
            retryAt: err.retryAt.toISOString(),
          },
          { status: 409 },
        );
      }

      log.info(
        {
          evt: "deposit.intent",
          depositId: deposit.id,
          method: deposit.method,
          network: config.network,
          amountUsdtMinor: deposit.amountUsdtMinor,
          slotAddress: deposit.receivingAddress,
          withSender: sender !== null,
        },
        "USDT slot deposit intent created",
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
      vpa: pickCollectionVpa(),
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
