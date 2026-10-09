// SERVER ONLY — reads the live receiving config from process.env. Never import
// this from a "use client" module; client code gets display metadata from
// USDT_NETWORK_INFO in @asm/contracts and the enabled list as a prop.
import { USDT_NETWORKS, type UsdtNetwork } from "@asm/contracts";
import { listTatumEnabledNetworks, readTatumConfig, usdtProviderFor, type TatumNetworkConfig } from "@asm/tatum";

export interface UsdtNetworkConfig {
  network: UsdtNetwork;
  tokenContract: string;
  receivingAddress: string;
  testnet: boolean;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

/**
 * TRON: read directly via process.env, not piped through @asm/config's strict
 * shared schema — same precedent as SMS_RELAY_SECRET and the engine's own
 * chain-watcher runner. Mirrors the exact set the engine requires before it
 * treats the watcher as "configured": a deposit created while the watcher
 * would stay idle could never be detected or credited, so callers must refuse
 * it rather than hand the user an address nothing is watching.
 */
function tronConfig(): UsdtNetworkConfig | null {
  const network = process.env["USDT_NETWORK"] ?? "";
  const trongridNetwork = process.env["USDT_TRONGRID_NETWORK"] ?? "";
  const tokenContract = process.env["USDT_TOKEN_CONTRACT"] ?? "";
  const receivingAddress = process.env["USDT_RECEIVING_ADDRESS"] ?? "";
  const trongridNetworkValid = trongridNetwork === "mainnet" || trongridNetwork === "nile";
  if (network !== "tron" || !trongridNetworkValid || !tokenContract || !receivingAddress) return null;
  return { network: "tron", tokenContract, receivingAddress, testnet: trongridNetwork === "nile" };
}

/**
 * BNB Smart Chain: configured only when EVERY required var is present and
 * valid (chain id exactly 56 or 97 — never defaulted to mainnet — an RPC URL,
 * both addresses well-formed, and explicit token decimals). Anything short of
 * that and BSC is not offered at all. EVM addresses are normalized lowercase,
 * matching how the engine stores them on ChainCredit.
 */
function bscConfig(): UsdtNetworkConfig | null {
  const chainId = env("USDT_BSC_CHAIN_ID");
  const rpcUrl = env("USDT_BSC_RPC_URL");
  const receivingAddress = env("USDT_BSC_RECEIVING_ADDRESS");
  const tokenContract = env("USDT_BSC_TOKEN_CONTRACT");
  const decimalsRaw = env("USDT_BSC_TOKEN_DECIMALS");

  if (chainId !== "97" && chainId !== "56") return null;
  if (!/^https:\/\/\S+$/i.test(rpcUrl)) return null;
  if (!EVM_ADDRESS.test(receivingAddress) || !EVM_ADDRESS.test(tokenContract)) return null;
  if (!/^[0-9]+$/.test(decimalsRaw)) return null;
  const decimals = Number(decimalsRaw);
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 36) return null;

  return {
    network: "bsc",
    tokenContract: tokenContract.toLowerCase(),
    receivingAddress: receivingAddress.toLowerCase(),
    testnet: chainId === "97",
  };
}

/** Live config for one network, re-read on every call; null when not fully configured. */
export function getUsdtNetworkConfig(network: UsdtNetwork): UsdtNetworkConfig | null {
  switch (network) {
    case "tron":
      return tronConfig();
    case "bsc":
      return bscConfig();
    default:
      return null;
  }
}

/**
 * Live config for one network under the MANUAL provider (shared receiving
 * address + unique-amount matching). Kept intact; only used when
 * USDT_DEPOSIT_PROVIDER=manual, or by admin tooling for legacy rows.
 */
export { getUsdtNetworkConfig as getManualUsdtNetworkConfig };

/**
 * True when this network's deposits go through the Tatum gateway (a fresh
 * address per deposit); false = the manual shared-address flow. Per network:
 * see usdtProviderFor (USDT_TRON_PROVIDER / USDT_BSC_PROVIDER overrides).
 */
export function usdtGatewayActive(network: UsdtNetwork): boolean {
  return usdtProviderFor(network) === "tatum";
}

/** Tatum gateway config for one network (null when not fully configured). */
export function getGatewayUsdtConfig(network: UsdtNetwork): TatumNetworkConfig | null {
  return readTatumConfig(network);
}

/** Networks a user may deposit on right now, in USDT_NETWORKS order, each under its own provider. */
export function listEnabledUsdtNetworks(): UsdtNetwork[] {
  const gateway = new Set<string>(listTatumEnabledNetworks());
  return USDT_NETWORKS.filter((n) =>
    usdtGatewayActive(n) ? gateway.has(n) : getUsdtNetworkConfig(n) !== null,
  );
}
