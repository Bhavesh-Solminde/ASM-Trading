import { NextResponse, type NextRequest } from "next/server";
import { findGatewayDepositByAddress } from "@asm/db";
import { childLogger } from "@asm/logger";
import {
  closedDepositIds,
  createGatewayChain,
  parseTatumWebhook,
  recordAndSettleTransfer,
  releaseDepositAlert,
  tatumChainId,
  verifyTatumSignature,
} from "@asm/tatum";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestContext } from "@/lib/request-context";
import { getGatewayUsdtConfig, usdtGatewayActive } from "@/lib/usdt-networks";

// Machine-to-machine; Tatum may burst retries. Generous, but bounded.
const RATE_LIMIT = 120;
const RATE_WINDOW_SEC = 60;

/**
 * Tatum INCOMING_FUNGIBLE_TX alerts for gateway deposit addresses.
 *
 * The body is a WAKE-UP signal only: after the HMAC check we take just
 * (address, txId, chain) and hand them to the shared processor, which
 * re-fetches the transaction from Tatum and decides from the chain itself.
 * Amount, sender and token in the body are never used.
 *
 * Once the signature is valid we always answer 200 — even if processing
 * hits a Tatum error — so Tatum stops retrying; the engine poller is the
 * safety net for anything this misses.
 */
export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  if (!(await checkRateLimit(`rl:tatum-webhook:${ctx.ip}`, RATE_LIMIT, RATE_WINDOW_SEC))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const secret = (process.env["TATUM_WEBHOOK_HMAC_SECRET"] ?? "").trim();
  const raw = await req.text();
  // Fail closed: without a configured secret nothing can be authenticated.
  if (!secret || !verifyTatumSignature(raw, req.headers.get("x-payload-hash"), secret)) {
    log.warn({ evt: "security.webhook_rejected", route: "webhooks/tatum" }, "Tatum webhook failed HMAC verification");
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = parseTatumWebhook(JSON.parse(raw) as unknown);
  if (!event || !event.network || !usdtGatewayActive()) {
    return NextResponse.json({ ok: true, ignored: "unsupported" });
  }

  const cfg = getGatewayUsdtConfig(event.network);
  if (!cfg || event.chain !== tatumChainId(cfg)) {
    log.warn({ evt: "tatum.webhook_ignored", chain: event.chain }, "webhook for a chain this server is not configured for");
    return NextResponse.json({ ok: true, ignored: "chain" });
  }

  const deposit = await findGatewayDepositByAddress(cfg.network, event.address);
  if (!deposit) {
    return NextResponse.json({ ok: true, ignored: "address" });
  }

  try {
    const result = await recordAndSettleTransfer(createGatewayChain(cfg), { txHash: event.txId, toAddress: event.address }, log);
    for (const depositId of closedDepositIds(result.settled)) await releaseDepositAlert(cfg, depositId, log);
    log.info(
      { evt: "tatum.webhook_processed", depositId: deposit.id, txId: event.txId, recorded: result.recorded, settled: result.settled.length },
      "Tatum webhook processed",
    );
  } catch (err) {
    log.warn(
      { evt: "tatum.webhook_processing_failed", depositId: deposit.id, txId: event.txId, err: (err as Error).message },
      "Tatum webhook processing failed; poller will retry",
    );
  }
  return NextResponse.json({ ok: true });
}
