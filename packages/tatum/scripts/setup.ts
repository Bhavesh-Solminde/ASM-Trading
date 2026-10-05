/**
 * One-time Tatum account setup for the USDT gateway: registers
 * TATUM_WEBHOOK_HMAC_SECRET so every alert webhook carries x-payload-hash.
 * HMAC is per API key, so run once per environment (testnet key, mainnet key):
 *
 *   pnpm --filter @asm/tatum setup
 */
import { GATEWAY_NETWORKS, enableWebhookHmac, readTatumConfig } from "../src";

const cfg = GATEWAY_NETWORKS.map((n) => readTatumConfig(n)).find((c) => c !== null);
if (!cfg) {
  console.error("No Tatum network is fully configured (TATUM_* env). Nothing to set up.");
  process.exit(1);
}
if (!cfg.hmacSecret) {
  console.error("TATUM_WEBHOOK_HMAC_SECRET is not set.");
  process.exit(1);
}
await enableWebhookHmac(cfg);
console.log(`HMAC webhook digest enabled for the ${cfg.testnet ? "testnet" : "MAINNET"} Tatum key.`);
