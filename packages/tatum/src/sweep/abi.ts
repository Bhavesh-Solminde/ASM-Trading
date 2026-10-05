/** ERC-20 / TRC-20 call encoding — the two calls the sweep makes, nothing more. */

export const SELECTOR_TRANSFER = "a9059cbb"; // transfer(address,uint256)
export const SELECTOR_BALANCE_OF = "70a08231"; // balanceOf(address)

const UINT256_MAX = (1n << 256n) - 1n;

/** A 20-byte address (hex, optional 0x / TRON 41 prefix) as a 32-byte ABI word. */
export function addressWord(address20: string): string {
  let h = address20.toLowerCase().replace(/^0x/, "");
  if (h.length === 42 && h.startsWith("41")) h = h.slice(2);
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`Not a 20-byte hex address: ${address20}`);
  return h.padStart(64, "0");
}

export function uintWord(n: bigint): string {
  if (n < 0n || n > UINT256_MAX) throw new Error(`uint256 out of range: ${n}`);
  return n.toString(16).padStart(64, "0");
}

/** ABI-encoded arguments of transfer(to, amount) — no selector. */
export function transferParams(to20: string, amount: bigint): string {
  return addressWord(to20) + uintWord(amount);
}

/** Decodes a single 32-byte uint word (as returned by balanceOf). */
export function decodeUintWord(word: string): bigint {
  const h = word.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error(`Expected one 32-byte word, got "${word.slice(0, 80)}".`);
  return BigInt(`0x${h}`);
}
