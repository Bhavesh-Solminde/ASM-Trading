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

/**
 * EVM (BNB Smart Chain) boundary. Every value here is already decoded:
 * addresses and tx hashes are lowercase "0x"-prefixed, block numbers and
 * token values are bigint (never a JS number — an 18-decimal value overflows
 * 2^53 at well under one token). Every method THROWS on any provider failure
 * (network, HTTP, JSON-RPC error, malformed payload) — callers treat a throw as
 * "this step failed, change nothing" and retry next tick.
 */
export interface EvmTransferLog {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  fromAddress: string;
  toAddress: string;
  rawValue: bigint;
  /** Set by the node when the log belonged to a block that was since reorged out. */
  removed: boolean;
}

export interface EvmReceiptLog {
  logIndex: number;
  /** The emitting contract, lowercase. */
  address: string;
  /** Lowercase 32-byte hex topics. */
  topics: string[];
  data: string;
}

export interface EvmReceipt {
  status: 0 | 1;
  blockNumber: bigint;
  logs: EvmReceiptLog[];
}

export interface EvmChainProvider {
  getChainId(): Promise<number>;
  getTokenDecimals(tokenContract: string): Promise<number>;
  getLatestBlockNumber(): Promise<bigint>;
  getFinalizedBlockNumber(): Promise<bigint>;
  /** Transfer(from, to, value) logs of `tokenContract` whose `to` is `toAddress`, in the inclusive block range. */
  getTransferLogs(params: {
    tokenContract: string;
    toAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<EvmTransferLog[]>;
  getBlockTimestampMs(blockNumber: bigint): Promise<number>;
  /** Null when the node has no receipt for this hash (not mined, or reorged out). */
  getReceipt(txHash: string): Promise<EvmReceipt | null>;
}
