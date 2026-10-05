import type { TatumNetworkConfig } from "./config";
import { TATUM_API_BASE, TatumError, tatumRequest } from "./http";

/**
 * Asks Tatum which network the API key serves and compares it with
 * TATUM_NETWORK. A key's text says nothing about its network (Tatum issues
 * "t-"-prefixed keys for both), but GET /v3/tron/info answers with the key's
 * own `testnet` flag. Throws TatumError when Tatum gives no answer — callers
 * treat that as "unknown, ask again later", never as a match.
 */
export async function checkTatumKeyNetwork(
  cfg: Pick<TatumNetworkConfig, "apiKey" | "testnet">,
  fetchImpl: typeof fetch = fetch,
): Promise<"ok" | "mismatch"> {
  const info = await tatumRequest<{ testnet?: unknown }>(fetchImpl, cfg.apiKey, `${TATUM_API_BASE}/v3/tron/info`);
  if (typeof info?.testnet !== "boolean") throw new TatumError("Tatum /v3/tron/info carried no testnet flag", null);
  return info.testnet === cfg.testnet ? "ok" : "mismatch";
}
