import { tatumChainId, type TatumNetworkConfig } from "./config";
import { TATUM_API_BASE, TatumError, tatumRequest } from "./http";

const typeParam = (cfg: TatumNetworkConfig) => (cfg.testnet ? "testnet" : "mainnet");

/**
 * Creates an INCOMING_FUNGIBLE_TX alert for one deposit address (50 credits
 * per day per alert + 50 per notification — so alerts are deleted as soon as
 * a deposit closes). Requires cfg.webhookUrl. Returns the alert id.
 */
export async function createIncomingTokenSubscription(
  cfg: TatumNetworkConfig,
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!cfg.webhookUrl) throw new TatumError("No TATUM_WEBHOOK_URL configured.", null);
  const res = await tatumRequest<{ id?: string }>(
    fetchImpl,
    cfg.apiKey,
    `${TATUM_API_BASE}/v4/subscription?type=${typeParam(cfg)}`,
    {
      method: "POST",
      body: { type: "INCOMING_FUNGIBLE_TX", attr: { address, chain: tatumChainId(cfg), url: cfg.webhookUrl } },
    },
  );
  if (!res?.id) throw new TatumError("Tatum returned no subscription id.", null);
  return res.id;
}

/** Deletes an alert. A 404 (already gone) counts as success. */
export async function deleteSubscription(cfg: TatumNetworkConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await tatumRequest(
    fetchImpl,
    cfg.apiKey,
    `${TATUM_API_BASE}/v4/subscription/${encodeURIComponent(id)}?type=${typeParam(cfg)}`,
    { method: "DELETE", allow404: true },
  );
}

/** Registers cfg.hmacSecret for every webhook this API key fires (one-time setup — scripts/tatum-setup.ts). */
export async function enableWebhookHmac(cfg: TatumNetworkConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!cfg.hmacSecret) throw new TatumError("No TATUM_WEBHOOK_HMAC_SECRET configured.", null);
  await tatumRequest(fetchImpl, cfg.apiKey, `${TATUM_API_BASE}/v4/subscription?type=${typeParam(cfg)}`, {
    method: "PUT",
    body: { hmacSecret: cfg.hmacSecret },
  });
}
