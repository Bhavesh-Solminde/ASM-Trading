/**
 * Tatum gateway configuration, read from env (process.env by default; tests
 * inject a plain object). Read directly rather than through @asm/config's
 * shared schema — the same precedent as the manual flow's USDT_* vars.
 *
 * A network is enabled only when EVERY value it needs is present and valid;
 * anything short of that and it is simply not offered (hidden, not broken).
 */

export type GatewayNetwork = "tron" | "bsc";
export const GATEWAY_NETWORKS: readonly GatewayNetwork[] = ["tron", "bsc"];

export interface TatumNetworkConfig {
  network: GatewayNetwork;
  apiKey: string;
  testnet: boolean;
  xpub: string;
  /** TRON: base58 (T…). BSC: lowercase 0x hex. */
  tokenContract: string;
  tokenDecimals: number;
  /** Public https URL Tatum alerts POST to; null = poll-only (e.g. localhost). */
  webhookUrl: string | null;
  hmacSecret: string | null;
}

export type Env = Record<string, string | undefined>;

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** TRC-20 USDT's canonical decimals (verified live against Shasta's USDT tokenInfo). */
const TRON_USDT_DECIMALS = 6;

function v(env: Env, key: string): string {
  return (env[key] ?? "").trim();
}

/** "tatum" unless USDT_DEPOSIT_PROVIDER is exactly "manual". */
export function isTatumProvider(env: Env = process.env): boolean {
  return v(env, "USDT_DEPOSIT_PROVIDER") !== "manual";
}

export function readTatumConfig(network: GatewayNetwork, env: Env = process.env): TatumNetworkConfig | null {
  const apiKey = v(env, "TATUM_API_KEY");
  const tatumNetwork = v(env, "TATUM_NETWORK");
  if (!apiKey) return null;
  // Never defaulted: an unset network must never end up pointed at mainnet.
  if (tatumNetwork !== "testnet" && tatumNetwork !== "mainnet") return null;
  // The key's own network is NOT inferable from its text: Tatum issues
  // "t-"-prefixed keys for testnet and mainnet alike (verified live). The
  // engine asks Tatum which network the key serves instead —
  // checkTatumKeyNetwork — and stays idle on a mismatch.
  const testnet = tatumNetwork === "testnet";

  const webhookUrl = v(env, "TATUM_WEBHOOK_URL") || null;
  const hmacSecret = v(env, "TATUM_WEBHOOK_HMAC_SECRET") || null;
  if (webhookUrl && (!/^https:\/\/\S+$/i.test(webhookUrl) || !hmacSecret)) return null;

  if (network === "tron") {
    const xpub = v(env, "TATUM_TRON_XPUB");
    const tokenContract = v(env, "TATUM_TRON_USDT_CONTRACT");
    if (!xpub || !TRON_ADDRESS.test(tokenContract)) return null;
    return { network, apiKey, testnet, xpub, tokenContract, tokenDecimals: TRON_USDT_DECIMALS, webhookUrl, hmacSecret };
  }

  const xpub = v(env, "TATUM_BSC_XPUB");
  const tokenContract = v(env, "TATUM_BSC_USDT_CONTRACT");
  const decimalsRaw = v(env, "TATUM_BSC_USDT_DECIMALS");
  if (!xpub || !EVM_ADDRESS.test(tokenContract) || !/^[0-9]+$/.test(decimalsRaw)) return null;
  const tokenDecimals = Number(decimalsRaw);
  if (tokenDecimals < 2 || tokenDecimals > 36) return null;
  return {
    network,
    apiKey,
    testnet,
    xpub,
    tokenContract: tokenContract.toLowerCase(),
    tokenDecimals,
    webhookUrl,
    hmacSecret,
  };
}

/** Networks the gateway can take deposits on right now (empty under the manual provider). */
export function listTatumEnabledNetworks(env: Env = process.env): GatewayNetwork[] {
  if (!isTatumProvider(env)) return [];
  return GATEWAY_NETWORKS.filter((n) => readTatumConfig(n, env) !== null);
}

/** Tatum's chain id for a network, as used by alerts and webhooks. */
export function tatumChainId(cfg: Pick<TatumNetworkConfig, "network" | "testnet">): string {
  return `${cfg.network}-${cfg.testnet ? "testnet" : "mainnet"}`;
}
