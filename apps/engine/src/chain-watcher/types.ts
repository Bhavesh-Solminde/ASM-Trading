/**
 * Network-agnostic boundary between blockchain-specific code (TronProvider,
 * and any future EVM/other-network adapter) and the deposit domain. Nothing
 * past this interface ever sees a raw TronGrid (or any other provider's)
 * response shape — see the design doc's "provider abstraction" section.
 */

/** One page of a bounded [minTimestampMs, maxTimestampMs] discovery query. */
export interface RawTrc20Row {
  transactionId: string;
  fromAddress: string;
  toAddress: string;
  /** The raw on-chain value, as returned by the provider — a decimal integer string, never parsed as a float. */
  rawValue: string;
  tokenContract: string;
  tokenDecimals: number;
  blockTimestampMs: number;
}

export interface TransferPage {
  rows: RawTrc20Row[];
  /** Opaque — persisted and replayed verbatim to resume a pagination session (see ChainScanCursor). Null means no further pages. */
  nextFingerprint: string | null;
}

export type EventResolution =
  | { kind: "resolved"; eventIndex: number; blockNumber: bigint }
  | { kind: "ambiguous"; candidateEventIndexes: number[] }
  | { kind: "not_found" }
  | { kind: "provider_error"; retryable: boolean; message: string };

export type ExecutionResult =
  | { state: "solidified"; success: boolean }
  | { state: "not_yet_solidified" }
  | { state: "not_found_on_solidity_node"; alsoMissingOnFullNode: boolean }
  | { state: "provider_error"; retryable: boolean; message: string };

export interface ChainProvider {
  /** Discovery: bounded time window, one page per call, paginated via `fingerprint`. */
  fetchTransferPage(params: {
    receivingAddress: string;
    tokenContract: string;
    minTimestampMs: number;
    maxTimestampMs: number;
    fingerprint: string | null;
  }): Promise<TransferPage>;

  /**
   * Resolves the authoritative event index for one discovered transfer by
   * decoding the transaction's full event log and matching on
   * (contract, to, value) — never assumed, never defaulted to 0. See the
   * design doc's event-identity section for the full algorithm and why
   * "ambiguous" (more than one matching event in the same transaction) is a
   * distinct, never-guessed outcome.
   */
  resolveTransferEvent(params: {
    txHash: string;
    expectedToAddress: string;
    expectedTokenContract: string;
    expectedRawAmount: bigint;
  }): Promise<EventResolution>;

  /** The authoritative re-check used at finality time — never trust the first observation. */
  getExecutionResult(txHash: string): Promise<ExecutionResult>;

  /** Independently verifies the configured contract's decimals at startup — never trusted from provider metadata alone. */
  getTokenDecimals(tokenContract: string): Promise<number>;
}
