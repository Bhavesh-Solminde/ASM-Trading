import type { TatumNetworkConfig } from "./config";
import { TRANSFER_TOPIC, type GatewayChain, type VerifiedTransfer, type VerifiedTx } from "./chain";
import { TATUM_API_BASE, TatumError, tatumRequest, tatumRpc } from "./http";

/** Tatum's gateway rejects eth_getLogs ranges over 10 000 blocks; keep a margin. */
export const BSC_MAX_LOOKBACK_BLOCKS = 9_900;
/** BSC block time is ~0.45 s; scan a bit wider than the elapsed time implies. */
const BSC_BLOCK_MS = 450;
const LOOKBACK_MARGIN_BLOCKS = 400n;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const TX_HASH = /^0x[0-9a-f]{64}$/;

function gatewayUrl(testnet: boolean): string {
  return testnet ? "https://bsc-testnet.gateway.tatum.io/" : "https://bsc-mainnet.gateway.tatum.io/";
}

const toBig = (hex: string) => BigInt(hex);
const toHex = (n: bigint) => `0x${n.toString(16)}`;
const topicFor = (address: string) => `0x${"0".repeat(24)}${address.toLowerCase().replace(/^0x/, "")}`;
const addressFromTopic = (topic: string) => `0x${topic.toLowerCase().slice(-40)}`;

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: string;
  transactionHash?: string;
  removed?: boolean;
}
interface RpcReceipt {
  status: string;
  blockNumber: string;
  logs: RpcLog[];
}

export function createBscChain(cfg: TatumNetworkConfig, fetchImpl: typeof fetch = fetch): GatewayChain {
  const url = gatewayUrl(cfg.testnet);
  const rpc = <T>(method: string, params: unknown[]) => tatumRpc<T>(fetchImpl, cfg.apiKey, url, method, params);
  const contract = cfg.tokenContract.toLowerCase();
  const transferTopic = `0x${TRANSFER_TOPIC}`;

  return {
    network: "bsc",
    tokenContract: contract,
    tokenDecimals: cfg.tokenDecimals,

    async deriveAddress(index) {
      const res = await tatumRequest<{ address?: string }>(
        fetchImpl,
        cfg.apiKey,
        `${TATUM_API_BASE}/v3/bsc/address/${encodeURIComponent(cfg.xpub)}/${index}`,
      );
      const address = res?.address?.toLowerCase();
      if (!address || !EVM_ADDRESS.test(address)) {
        throw new TatumError("Tatum returned no valid BSC address.", null);
      }
      return address;
    },

    async listIncomingTxHashes(address, sinceMs) {
      const latest = toBig(await rpc<string>("eth_blockNumber", []));
      const elapsedBlocks = BigInt(Math.max(0, Math.ceil((Date.now() - sinceMs) / BSC_BLOCK_MS))) + LOOKBACK_MARGIN_BLOCKS;
      const lookback = elapsedBlocks < BigInt(BSC_MAX_LOOKBACK_BLOCKS) ? elapsedBlocks : BigInt(BSC_MAX_LOOKBACK_BLOCKS);
      const fromBlock = latest > lookback ? latest - lookback : 0n;
      const logs = await rpc<RpcLog[]>("eth_getLogs", [
        {
          address: contract,
          fromBlock: toHex(fromBlock),
          toBlock: toHex(latest),
          topics: [transferTopic, null, topicFor(address)],
        },
      ]);
      const hashes = new Set<string>();
      for (const log of logs ?? []) {
        const h = log.transactionHash?.toLowerCase();
        if (!log.removed && h) hashes.add(h);
      }
      return [...hashes];
    },

    async verifyTransfer(txHash, toAddress): Promise<VerifiedTx> {
      const hash = txHash.toLowerCase();
      if (!TX_HASH.test(hash)) return { kind: "not_found" };
      const receipt = await rpc<RpcReceipt | null>("eth_getTransactionReceipt", [hash]);
      if (!receipt) return { kind: "not_found" };
      if (toBig(receipt.status) !== 1n) return { kind: "failed" };

      const toTopic = topicFor(toAddress);
      const transfers: VerifiedTransfer[] = [];
      for (const log of receipt.logs ?? []) {
        if (log.removed) continue;
        if (log.address.toLowerCase() !== contract) continue;
        const topics = log.topics.map((t) => t.toLowerCase());
        if (topics.length !== 3 || topics[0] !== transferTopic || topics[2] !== toTopic) continue;
        transfers.push({
          eventIndex: Number(toBig(log.logIndex)),
          fromAddress: addressFromTopic(topics[1]!),
          rawValue: toBig(log.data === "0x" ? "0x0" : log.data),
        });
      }

      const blockNumber = toBig(receipt.blockNumber);
      const [finalized, block] = await Promise.all([
        rpc<{ number: string } | null>("eth_getBlockByNumber", ["finalized", false]),
        rpc<{ timestamp: string } | null>("eth_getBlockByNumber", [receipt.blockNumber, false]),
      ]);
      if (!finalized || !block) throw new TatumError("BSC gateway returned no block.", null);

      return {
        kind: "ok",
        final: blockNumber <= toBig(finalized.number),
        blockNumber,
        blockTimestampMs: Number(toBig(block.timestamp)) * 1000,
        transfers,
      };
    },
  };
}
