export {
  GATEWAY_NETWORKS,
  isTatumProvider,
  listTatumEnabledNetworks,
  readTatumConfig,
  tatumChainId,
  type Env,
  type GatewayNetwork,
  type TatumNetworkConfig,
} from "./config";
export { TatumError, resetTatumPacing } from "./http";
export type { GatewayChain, VerifiedTransfer, VerifiedTx } from "./chain";
export { createTronChain, tronBase58ToHex, tronHexToBase58, TRON_FINALITY_CONFIRMATIONS } from "./tron";
export { createBscChain, BSC_MAX_LOOKBACK_BLOCKS } from "./bsc";
export { createIncomingTokenSubscription, deleteSubscription, enableWebhookHmac } from "./subscriptions";
export { parseTatumWebhook, verifyTatumSignature, type TatumWebhookEvent } from "./webhook";

import type { GatewayChain } from "./chain";
import type { TatumNetworkConfig } from "./config";
import { createBscChain } from "./bsc";
import { createTronChain } from "./tron";

/** The adapter for a configured network. */
export function createGatewayChain(cfg: TatumNetworkConfig, fetchImpl: typeof fetch = fetch): GatewayChain {
  return cfg.network === "tron" ? createTronChain(cfg, fetchImpl) : createBscChain(cfg, fetchImpl);
}
export {
  closedDepositIds,
  recheckDetectedCredits,
  recordAndSettleTransfer,
  releaseDepositAlert,
  scanGatewayDeposit,
  type ProcessorLog,
  type SettledOutcome,
} from "./processor";
