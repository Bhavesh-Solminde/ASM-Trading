/**
 * Offline sweep tool internals. Deliberately NOT re-exported from the
 * package root: the web app and engine import "@asm/tatum", and must never
 * bundle key-handling code or tronweb/ethers. Import "@asm/tatum/src/sweep"
 * (only scripts/sweep.ts does).
 */
import type { TatumNetworkConfig } from "../config";
import { createBscSweeper } from "./bsc";
import { createTronSweeper } from "./tron";
import type { ChainSweeper } from "./types";

export {
  ACCOUNT_PATHS,
  MAINNET_ACCOUNT_PATH,
  WrongMnemonicError,
  addressForPrivateKey,
  createHdSigner,
  generateGatewayWallets,
  signerFromPrivateKey,
  type GeneratedGatewayWallets,
  type HdSigner,
  type Signer,
} from "./keys";
export { UnsafeTransactionError, createTronSweeper, verifyBuiltTx } from "./tron";
export { createBscSweeper } from "./bsc";
export type { ChainSweeper, SweepQuote, TxOutcome } from "./types";
export {
  AddressMismatchError,
  InsufficientGasError,
  executeSweep,
  gasNeeded,
  planSweep,
  reconcileOpenSweeps,
  type PlanItem,
  type SweepContext,
  type SweepDb,
  type SweepOptions,
  type SweepResult,
} from "./run";

export function createChainSweeper(
  cfg: TatumNetworkConfig,
  opts: { maxGasPriceWei?: bigint } = {},
  fetchImpl: typeof fetch = fetch,
): ChainSweeper {
  return cfg.network === "tron" ? createTronSweeper(cfg, fetchImpl) : createBscSweeper(cfg, fetchImpl, opts);
}
