import type { GatewayNetwork } from "../config";
import type { Signer } from "./keys";

/** What one token transfer out of a deposit address will cost, and the gas settings to send it with. */
export interface SweepQuote {
  /** Native units (sun / wei) the deposit address must hold before it sends the token. */
  requiredNative: bigint;
  /**
   * What the gas wallet pays ON TOP of the top-up itself: its own tx fee, plus
   * TRON's account-activation fee when the address has never held TRX.
   * Used for the "can the gas wallet afford this run" check and the plan totals.
   */
  topUpOverhead: bigint;
  /** TRON: fee_limit (sun) the transfer is sent with. */
  feeLimit?: bigint;
  /** BSC: gas limit and legacy gas price (wei) the transfer is sent with. */
  gasLimit?: bigint;
  gasPrice?: bigint;
  /** Human summary for the plan table, e.g. "13045 energy". */
  note: string;
}

export type TxOutcome = "success" | "failed" | "pending";

/**
 * One chain's sweep operations. Keys only ever touch `sendNative`/`sendToken`,
 * which sign locally and broadcast raw — Tatum never sees a private key.
 */
export interface ChainSweeper {
  readonly network: GatewayNetwork;
  readonly nativeSymbol: "TRX" | "BNB";
  readonly nativeDecimals: number;
  tokenBalance(address: string): Promise<bigint>;
  nativeBalance(address: string): Promise<bigint>;
  quoteSweep(from: string, to: string, amount: bigint): Promise<SweepQuote>;
  /** Sends `amount` native units from `signer` to `to`. Returns the tx hash once broadcast. */
  sendNative(signer: Signer, to: string, amount: bigint): Promise<string>;
  /** Sends `amount` of the configured token from `signer` to `to` with the quote's gas settings. */
  sendToken(signer: Signer, to: string, amount: bigint, quote: SweepQuote): Promise<string>;
  /** Polls until the tx is in a block (success/failed) or `timeoutMs` passes (pending). */
  waitForTx(txHash: string, timeoutMs?: number): Promise<TxOutcome>;
}
