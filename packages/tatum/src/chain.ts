import type { GatewayNetwork } from "./config";

/** keccak256("Transfer(address,address,uint256)") — the ERC-20/TRC-20 Transfer event topic. */
export const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface VerifiedTransfer {
  /** Position of the Transfer log within the tx — part of ChainCredit's identity. */
  eventIndex: number;
  /** TRON base58 / BSC lowercase 0x hex. */
  fromAddress: string;
  rawValue: bigint;
}

export type VerifiedTx =
  | { kind: "not_found" }
  | { kind: "failed" }
  | { kind: "ok"; final: boolean; blockNumber: bigint; blockTimestampMs: number; transfers: VerifiedTransfer[] };

/**
 * One gateway network, backed by Tatum. Every method throws TatumError on a
 * provider failure; nothing here writes to the DB.
 */
export interface GatewayChain {
  readonly network: GatewayNetwork;
  readonly tokenContract: string;
  readonly tokenDecimals: number;
  /** HD-derive the receiving address at `index` from the configured xpub (Tatum computes it; no keys involved). */
  deriveAddress(index: number): Promise<string>;
  /** Hashes of recent transactions that moved OUR token into `address`. Discovery only — never trusted for amounts. */
  listIncomingTxHashes(address: string, sinceMs: number): Promise<string[]>;
  /** The authoritative check: re-fetches the tx and decodes every Transfer of our token into `toAddress`. */
  verifyTransfer(txHash: string, toAddress: string): Promise<VerifiedTx>;
}
