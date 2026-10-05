import { createHash } from "node:crypto";
import type { TatumNetworkConfig } from "./config";
import { TRANSFER_TOPIC, type GatewayChain, type VerifiedTransfer, type VerifiedTx } from "./chain";
import { TATUM_API_BASE, TatumError, tatumRequest } from "./http";

/**
 * TRON solidifies a block once 19 later blocks exist (>2/3 of the 27 super
 * representatives built on it). 20 confirmations gives one block of margin.
 */
export const TRON_FINALITY_CONFIRMATIONS = 20;

// ── base58check <-> hex (TRON addresses are 0x41-prefixed 21-byte payloads) ──
// Implemented here (≈30 lines, node:crypto only) instead of pulling tronweb
// into the web bundle just for this; verified against Tatum's own
// owner_address/ownerAddressBase58 pairs in tron.test.ts.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();

function base58Decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`Invalid base58 character "${ch}".`);
    n = n * 58n + BigInt(i);
  }
  const hex = n === 0n ? "" : n.toString(16);
  const body = Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
  const leadingZeros = s.length - s.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(leadingZeros), body]);
}

function base58Encode(b: Buffer): string {
  let n = BigInt(`0x${b.toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of b) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** "T…" -> "41" + 40 hex chars (lowercase). Throws on a bad checksum. */
export function tronBase58ToHex(address: string): string {
  const raw = base58Decode(address);
  if (raw.length !== 25) throw new Error("Invalid TRON address length.");
  const payload = raw.subarray(0, 21);
  const checksum = raw.subarray(21);
  if (!sha256(sha256(payload)).subarray(0, 4).equals(checksum)) throw new Error("Invalid TRON address checksum.");
  return payload.toString("hex");
}

/** "41…" (21 bytes) or a bare 20-byte hex (as in event logs/topics) -> "T…". */
export function tronHexToBase58(hex: string): string {
  let h = hex.toLowerCase().replace(/^0x/, "");
  if (h.length === 40) h = `41${h}`;
  if (h.length !== 42 || !h.startsWith("41")) throw new Error(`Not a TRON hex address: ${hex}`);
  const payload = Buffer.from(h, "hex");
  return base58Encode(Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]));
}

/** Last 20 bytes of a 32-byte topic/word, as a TRON-hex body (no 41 prefix). */
function wordToAddress20(word: string): string {
  return word.toLowerCase().replace(/^0x/, "").slice(-40);
}

// ── Tatum v3 TRON response shapes (only the fields we read) ──

interface Trc20Row {
  txID: string;
  to: string;
  tokenInfo?: { address?: string };
}
interface TronTx {
  txID?: string;
  blockNumber?: number;
  ret?: { contractRet?: string }[];
  log?: { address: string; topics?: string[]; data?: string }[];
}

export function createTronChain(cfg: TatumNetworkConfig, fetchImpl: typeof fetch = fetch): GatewayChain {
  const get = <T>(path: string, allow404 = false) =>
    tatumRequest<T>(fetchImpl, cfg.apiKey, `${TATUM_API_BASE}${path}`, { allow404 });
  // Log emitter addresses are bare 20-byte hex; compare on that form.
  const contract20 = tronBase58ToHex(cfg.tokenContract).slice(2);

  return {
    network: "tron",
    tokenContract: cfg.tokenContract,
    tokenDecimals: cfg.tokenDecimals,

    async deriveAddress(index) {
      const res = await get<{ address?: string }>(`/v3/tron/address/${encodeURIComponent(cfg.xpub)}/${index}`);
      const address = res?.address;
      if (!address || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
        throw new TatumError("Tatum returned no valid TRON address.", null);
      }
      return address;
    },

    // TRC-20 history rows carry no timestamp, so `sinceMs` can't filter here;
    // a per-deposit address only ever sees a handful of transfers anyway.
    async listIncomingTxHashes(address) {
      const res = await get<{ transactions?: Trc20Row[] }>(
        `/v3/tron/transaction/account/${encodeURIComponent(address)}/trc20`,
      );
      const hashes = new Set<string>();
      for (const row of res?.transactions ?? []) {
        if (row.to === address && row.tokenInfo?.address === cfg.tokenContract && /^[0-9a-fA-F]{64}$/.test(row.txID)) {
          hashes.add(row.txID.toLowerCase());
        }
      }
      return [...hashes];
    },

    async verifyTransfer(txHash, toAddress): Promise<VerifiedTx> {
      if (!/^[0-9a-fA-F]{64}$/.test(txHash)) return { kind: "not_found" };
      const tx = await get<TronTx>(`/v3/tron/transaction/${txHash}`, true);
      if (!tx || !tx.txID) return { kind: "not_found" };
      const result = tx.ret?.[0]?.contractRet;
      if (result && result !== "SUCCESS") return { kind: "failed" };
      // Not in a block yet: nothing to record.
      if (typeof tx.blockNumber !== "number") return { kind: "not_found" };

      const to20 = tronBase58ToHex(toAddress).slice(2);
      const transfers: VerifiedTransfer[] = [];
      (tx.log ?? []).forEach((log, i) => {
        const topics = (log.topics ?? []).map((t) => t.toLowerCase().replace(/^0x/, ""));
        if (wordToAddress20(log.address) !== contract20) return;
        if (topics.length !== 3 || topics[0] !== TRANSFER_TOPIC) return;
        if (wordToAddress20(topics[2]!) !== to20) return;
        const data = (log.data ?? "").replace(/^0x/, "");
        if (!/^[0-9a-fA-F]{1,64}$/.test(data)) return;
        transfers.push({
          eventIndex: i,
          fromAddress: tronHexToBase58(wordToAddress20(topics[1]!)),
          rawValue: BigInt(`0x${data}`),
        });
      });

      const [info, block] = await Promise.all([
        get<{ blockNumber?: number }>("/v3/tron/info"),
        // The BLOCK timestamp — tx.rawData.timestamp is chosen by the sender
        // and must never decide whether a payment was on time.
        get<{ timestamp?: number }>(`/v3/tron/block/${tx.blockNumber}`),
      ]);
      if (typeof info?.blockNumber !== "number") throw new TatumError("Tatum /v3/tron/info had no blockNumber.", null);
      if (typeof block?.timestamp !== "number") throw new TatumError("Tatum TRON block had no timestamp.", null);

      return {
        kind: "ok",
        final: info.blockNumber - tx.blockNumber >= TRON_FINALITY_CONFIRMATIONS,
        blockNumber: BigInt(tx.blockNumber),
        blockTimestampMs: block.timestamp,
        transfers,
      };
    },
  };
}
