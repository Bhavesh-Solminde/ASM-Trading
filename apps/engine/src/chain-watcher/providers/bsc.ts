import { logger } from "@asm/logger";
import {
  TRANSFER_TOPIC,
  addressToTopic,
  parseHexQuantity,
  parseHexSafeInteger,
  parseUint256Data,
  toHexQuantity,
  topicToAddress,
} from "../evm-codec";
import type { EvmChainProvider, EvmReceipt, EvmReceiptLog, EvmTransferLog } from "../types";

/**
 * Read-only BNB Smart Chain adapter over raw Ethereum JSON-RPC (POST, JSON) —
 * no keys, no signing, no web3 library. Methods used (all standard):
 * eth_chainId, eth_call (decimals()), eth_blockNumber,
 * eth_getBlockByNumber ("finalized" — BSC fast finality, BEP-126 — and by
 * number for timestamps), eth_getLogs, eth_getTransactionReceipt.
 *
 * The RPC URL is ALWAYS the caller's configuration — never hardcoded here:
 * the official bnbchain.org endpoints refuse eth_getLogs, so which provider
 * to use is an operator decision.
 *
 * Every failure (network, timeout, HTTP status, malformed JSON, a JSON-RPC
 * `error` object, a malformed/missing result) throws. Nothing is ever guessed
 * or defaulted — callers treat a throw as "change nothing, retry next tick".
 */

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
const DECIMALS_SELECTOR = "0x313ce567"; // decimals()
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_20 = /^0x[0-9a-fA-F]{40}$/;

export interface BscProviderOptions {
  rpcUrl: string;
  /** Per-request timeout. */
  timeoutMs?: number;
}

export class EvmRpcError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EvmRpcError";
  }
}

export function createBscProvider(opts: BscProviderOptions): EvmChainProvider {
  if (!opts.rpcUrl) throw new Error("createBscProvider: rpcUrl is required");
  const rpcUrl = opts.rpcUrl;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let nextId = 1;

  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw fail(method, true, err instanceof Error ? err.message : "network error");
    }
    if (!res.ok) throw fail(method, RETRYABLE_HTTP_STATUS.has(res.status), `HTTP ${res.status}`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw fail(method, true, "malformed JSON response");
    }
    if (typeof body !== "object" || body === null) throw fail(method, true, "non-object JSON-RPC response");

    const envelope = body as { result?: unknown; error?: { code?: unknown; message?: unknown } };
    if (envelope.error !== undefined && envelope.error !== null) {
      const code = typeof envelope.error.code === "number" ? envelope.error.code : "?";
      const message = typeof envelope.error.message === "string" ? envelope.error.message : "unknown";
      // e.g. -32005 "limit exceeded" (range too large / eth_getLogs refused) — not retryable by waiting alone.
      throw fail(method, false, `JSON-RPC error ${code}: ${message}`);
    }
    if (!("result" in envelope)) throw fail(method, true, "JSON-RPC response has no result");
    return envelope.result;
  }

  function fail(method: string, retryable: boolean, message: string): EvmRpcError {
    logger.warn({ evt: "chain.provider.error", network: "bsc", op: method, retryable, reason: message }, "BSC JSON-RPC call failed");
    return new EvmRpcError(`${method}: ${message}`, retryable);
  }

  async function getBlock(tag: string): Promise<Record<string, unknown>> {
    const block = await rpc("eth_getBlockByNumber", [tag, false]);
    if (typeof block !== "object" || block === null) {
      throw new EvmRpcError(`eth_getBlockByNumber(${tag}): block not available`, true);
    }
    return block as Record<string, unknown>;
  }

  return {
    async getChainId(): Promise<number> {
      return parseHexSafeInteger(await rpc("eth_chainId", []), "chainId");
    },

    async getTokenDecimals(tokenContract: string): Promise<number> {
      const result = await rpc("eth_call", [{ to: tokenContract, data: DECIMALS_SELECTOR }, "latest"]);
      // "0x" (no code at that address) or anything not one 32-byte word is rejected by parseUint256Data.
      const decimals = parseUint256Data(result);
      if (decimals > 255n) throw new Error(`getTokenDecimals: out-of-range decimals() result for ${tokenContract}`);
      return Number(decimals);
    },

    async getLatestBlockNumber(): Promise<bigint> {
      return parseHexQuantity(await rpc("eth_blockNumber", []), "blockNumber");
    },

    async getFinalizedBlockNumber(): Promise<bigint> {
      const block = await getBlock("finalized");
      return parseHexQuantity(block["number"], "finalized.number");
    },

    async getTransferLogs(params): Promise<EvmTransferLog[]> {
      if (params.fromBlock > params.toBlock) return [];
      const result = await rpc("eth_getLogs", [
        {
          address: params.tokenContract,
          fromBlock: toHexQuantity(params.fromBlock),
          toBlock: toHexQuantity(params.toBlock),
          topics: [TRANSFER_TOPIC, null, addressToTopic(params.toAddress)],
        },
      ]);
      if (!Array.isArray(result)) throw new EvmRpcError("eth_getLogs: result is not an array", true);

      // A malformed log throws rather than being skipped — skipping it would
      // let the cursor advance past a transfer that was never persisted.
      return result.map((raw: unknown): EvmTransferLog => {
        const log = raw as {
          transactionHash?: unknown;
          logIndex?: unknown;
          blockNumber?: unknown;
          topics?: unknown;
          data?: unknown;
          removed?: unknown;
        };
        if (typeof log.transactionHash !== "string" || !TX_HASH.test(log.transactionHash)) {
          throw new EvmRpcError(`eth_getLogs: malformed transactionHash ${String(log.transactionHash)}`, false);
        }
        if (!Array.isArray(log.topics) || log.topics.length !== 3 || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC) {
          throw new EvmRpcError(`eth_getLogs: unexpected topics on ${log.transactionHash}`, false);
        }
        return {
          txHash: log.transactionHash.toLowerCase(),
          logIndex: parseHexSafeInteger(log.logIndex, "logIndex"),
          blockNumber: parseHexQuantity(log.blockNumber, "blockNumber"),
          fromAddress: topicToAddress(log.topics[1]),
          toAddress: topicToAddress(log.topics[2]),
          rawValue: parseUint256Data(log.data),
          removed: log.removed === true,
        };
      });
    },

    async getBlockTimestampMs(blockNumber: bigint): Promise<number> {
      const block = await getBlock(toHexQuantity(blockNumber));
      return parseHexSafeInteger(block["timestamp"], "block.timestamp") * 1000;
    },

    async getReceipt(txHash: string): Promise<EvmReceipt | null> {
      const result = await rpc("eth_getTransactionReceipt", [txHash]);
      if (result === null) return null;
      if (typeof result !== "object") throw new EvmRpcError("eth_getTransactionReceipt: malformed result", true);
      const receipt = result as { status?: unknown; blockNumber?: unknown; logs?: unknown };

      const status = parseHexQuantity(receipt.status, "receipt.status");
      if (status !== 0n && status !== 1n) throw new EvmRpcError(`eth_getTransactionReceipt: unexpected status ${String(receipt.status)}`, false);
      if (!Array.isArray(receipt.logs)) throw new EvmRpcError("eth_getTransactionReceipt: logs is not an array", true);

      const logs = receipt.logs.map((raw: unknown): EvmReceiptLog => {
        const log = raw as { logIndex?: unknown; address?: unknown; topics?: unknown; data?: unknown };
        if (typeof log.address !== "string" || !ADDRESS_20.test(log.address)) {
          throw new EvmRpcError("eth_getTransactionReceipt: malformed log address", false);
        }
        if (!Array.isArray(log.topics) || !log.topics.every((t) => typeof t === "string")) {
          throw new EvmRpcError("eth_getTransactionReceipt: malformed log topics", false);
        }
        if (typeof log.data !== "string") throw new EvmRpcError("eth_getTransactionReceipt: malformed log data", false);
        return {
          logIndex: parseHexSafeInteger(log.logIndex, "receipt.logIndex"),
          address: log.address.toLowerCase(),
          topics: (log.topics as string[]).map((t) => t.toLowerCase()),
          data: log.data.toLowerCase(),
        };
      });

      return {
        status: status === 1n ? 1 : 0,
        blockNumber: parseHexQuantity(receipt.blockNumber, "receipt.blockNumber"),
        logs,
      };
    },
  };
}
