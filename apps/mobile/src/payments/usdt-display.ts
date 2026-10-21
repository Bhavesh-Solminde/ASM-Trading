import { USDT_NETWORK_INFO, isUsdtNetwork } from "@asm/contracts";

/**
 * USDT cents as a plain two-decimal number: "12.34". No grouping and no unit, because this is also the text that is
 * copied to the clipboard and pasted into a wallet. (For showing an amount, `amountText` groups it and adds "USDT".)
 * Anything that is not a usable non-negative number reads "0.00".
 */
export function usdtAmountText(minor: number | null): string {
  const cents = minor !== null && Number.isFinite(minor) && minor > 0 ? Math.floor(minor) : 0;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "TRON (TRC-20)": chain and token standard, from the contract's own display table; plain "USDT" for a network this app does not know. */
export function networkLabel(network: string | null): string {
  return network && isUsdtNetwork(network) ? USDT_NETWORK_INFO[network].shortLabel : "USDT";
}

/**
 * What the pay screen says about a network beyond its label: the chain's bare name (for "on the TRON network only")
 * and whether its addresses can be mistaken for another chain's. BSC and Ethereum addresses are identical in form, so
 * the website adds a line for BSC; the app shows the same.
 */
export function networkNote(network: string | null): { chain: string; lookalike: boolean } {
  if (network && isUsdtNetwork(network)) return { chain: USDT_NETWORK_INFO[network].label, lookalike: network === "bsc" };
  return { chain: "USDT", lookalike: false };
}

/** The i18n key of the status card's line for an open USDT payment; null for a final status (the result screen takes over). */
export function usdtStatusLineKey(input: { status: string; isGateway: boolean }): "usdt.detectAuto" | "pay.waiting" | "usdt.confirming" | null {
  if (input.status === "AWAITING_PAYMENT") return input.isGateway ? "usdt.detectAuto" : "pay.waiting";
  if (input.status === "PENDING_CONFIRMATION") return "usdt.confirming";
  return null;
}

/** The website's sending rule for the rail: a gateway deposit takes at least the amount, a slot one anything within 3%, a manual one the exact amount. */
export function usdtHintKey(input: { isGateway: boolean; isSlot: boolean }): "usdt.hintGateway" | "usdt.hintSlot" | "usdt.hintManual" {
  if (input.isGateway) return "usdt.hintGateway";
  return input.isSlot ? "usdt.hintSlot" : "usdt.hintManual";
}

/** Whose the address is, when it is not the shared one: unique to this deposit (gateway) or reserved for the user until the timer ends (slot). */
export function usdtAddressNoteKey(input: { isGateway: boolean; isSlot: boolean }): "usdt.addressUnique" | "usdt.addressReserved" | null {
  if (input.isGateway) return "usdt.addressUnique";
  return input.isSlot ? "usdt.addressReserved" : null;
}
