/**
 * Minimal, dependency-free ERC-20/BEP-20 log codec shared by the BSC provider
 * (decoding eth_getLogs output) and evm-finality (re-verifying a receipt's
 * log). Integer-only: every quantity goes through BigInt, never Number.
 */

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer event's topic0. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/;
const TOPIC_32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_20 = /^0x[0-9a-fA-F]{40}$/;

/** Parses a JSON-RPC hex quantity ("0x1a") to bigint. Throws on anything else — never guesses. */
export function parseHexQuantity(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) {
    throw new Error(`malformed hex quantity for ${field}: ${String(value)}`);
  }
  return BigInt(value);
}

/** A hex quantity that must fit a JS safe integer (log indexes, chain ids, timestamps). */
export function parseHexSafeInteger(value: unknown, field: string): number {
  const n = parseHexQuantity(value, field);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`hex quantity out of safe range for ${field}`);
  return Number(n);
}

export function toHexQuantity(n: bigint): string {
  if (n < 0n) throw new Error("negative block number");
  return `0x${n.toString(16)}`;
}

/** An indexed address topic is the 20-byte address left-padded to 32 bytes; the address is its LAST 20 bytes. */
export function topicToAddress(topic: unknown): string {
  if (typeof topic !== "string" || !TOPIC_32.test(topic)) {
    throw new Error(`malformed address topic: ${String(topic)}`);
  }
  return `0x${topic.slice(-40).toLowerCase()}`;
}

export function addressToTopic(address: string): string {
  if (!ADDRESS_20.test(address)) throw new Error(`malformed EVM address: ${address}`);
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

/** A Transfer event's non-indexed `value` — exactly one 32-byte word of data. */
export function parseUint256Data(data: unknown): bigint {
  if (typeof data !== "string" || !TOPIC_32.test(data)) {
    throw new Error(`malformed uint256 log data: ${String(data)}`);
  }
  return BigInt(data);
}
