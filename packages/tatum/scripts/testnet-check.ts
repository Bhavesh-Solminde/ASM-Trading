/**
 * Live end-to-end check of the Tatum gateway against Tatum's TESTNETS using
 * the configured TATUM_* env. Read-mostly: it derives addresses, creates and
 * immediately deletes one alert, verifies known public USDT transfers, and
 * (if a dev server is up) posts a signed webhook to it. Moves no funds.
 *
 *   pnpm --filter @asm/tatum check:testnet
 */
import { createHmac } from "node:crypto";
import {
  createGatewayChain,
  createIncomingTokenSubscription,
  deleteSubscription,
  listTatumEnabledNetworks,
  readTatumConfig,
  tatumChainId,
  type GatewayNetwork,
} from "../src";

// Public testnet USDT transfers to verify against (fixtures in src/__fixtures__).
const KNOWN_TX: Record<GatewayNetwork, { txHash: string; to: string; raw: bigint }> = {
  tron: {
    txHash: "15b3458c34cb89048696f887953a60c7ec0e6447ff9f02485ad68fcc99240679",
    to: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
    raw: 1_000_000_000n,
  },
  bsc: {
    txHash: "0xf7cb048ffc42b36a2fab10d4bdeae345a5ea173d8814c04e2a66a8484e7479b9",
    to: "0x5f52ad4bd4f519ae79999400ad8b83a3d002fd92",
    raw: 113_793_779_630_764_674n,
  },
};

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

const networks = listTatumEnabledNetworks();
check(networks.length > 0, "at least one gateway network configured", networks.join(", "));

for (const network of networks) {
  const cfg = readTatumConfig(network)!;
  check(cfg.testnet, `${network}: configured for TESTNET`, tatumChainId(cfg));
  if (!cfg.testnet) continue; // never poke mainnet from this script
  const chain = createGatewayChain(cfg);

  const addrs = await Promise.all([1, 2, 3].map((i) => chain.deriveAddress(i)));
  check(new Set(addrs).size === 3, `${network}: derives distinct addresses for indexes 1-3`, addrs.join(" "));
  check((await chain.deriveAddress(1)) === addrs[0], `${network}: derivation is deterministic`);

  const incoming = await chain.listIncomingTxHashes(addrs[0]!, Date.now() - 30 * 60_000);
  check(Array.isArray(incoming), `${network}: lists incoming transfers for a fresh address`, `${incoming.length} found`);

  // Verified against the known tx's own token (which may differ from cfg's on BSC testnet).
  const known = KNOWN_TX[network];
  const knownChain = createGatewayChain({
    ...cfg,
    tokenContract: network === "tron" ? "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs" : "0x337610d27c682e347c9cd60bd4b3b107c9d34ddd",
  });
  const v = await knownChain.verifyTransfer(known.txHash, known.to);
  check(
    v.kind === "ok" && v.final && v.transfers.some((t) => t.rawValue === known.raw),
    `${network}: verifies a known final USDT transfer on-chain`,
    v.kind === "ok" ? `block ${v.blockNumber}, ${v.transfers.length} transfer(s), final=${v.final}` : v.kind,
  );
  const wrongAddr = await knownChain.verifyTransfer(known.txHash, addrs[0]!);
  check(wrongAddr.kind === "ok" && wrongAddr.transfers.length === 0, `${network}: same tx yields nothing for an unrelated address`);
  const bogus = await chain.verifyTransfer(network === "bsc" ? `0x${"ab".repeat(32)}` : "ab".repeat(32), addrs[0]!);
  check(bogus.kind === "not_found", `${network}: unknown tx is not_found`, bogus.kind);

  // Alerts need a public https URL; a placeholder is fine for create+delete.
  const alertCfg = { ...cfg, webhookUrl: cfg.webhookUrl ?? "https://example.com/api/webhooks/tatum" };
  try {
    const id = await createIncomingTokenSubscription(alertCfg, addrs[0]!);
    check(true, `${network}: creates an INCOMING_FUNGIBLE_TX alert`, id);
    await deleteSubscription(alertCfg, id);
    check(true, `${network}: deletes the alert`);
  } catch (err) {
    check(false, `${network}: alert create/delete`, (err as Error).message);
  }
}

// Signed webhook against a running local dev server (optional).
const base = process.env["TATUM_CHECK_WEB_URL"] ?? "http://localhost:3000";
const secret = process.env["TATUM_WEBHOOK_HMAC_SECRET"] ?? "";
try {
  const body = { address: "TNobody111111111111111111111111111", txId: "ab".repeat(32), chain: "tron-testnet" };
  const sig = createHmac("sha512", secret).update(JSON.stringify(body)).digest("base64");
  const good = await fetch(`${base}/api/webhooks/tatum`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payload-hash": sig },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  check(good.status === 200, "web: accepts a correctly signed webhook", String(good.status));
  const bad = await fetch(`${base}/api/webhooks/tatum`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payload-hash": "AAAA" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  check(bad.status === 401, "web: rejects a badly signed webhook", String(bad.status));
} catch {
  console.log(`SKIP  web webhook checks — no dev server reachable at ${base}`);
}

console.log(failures === 0 ? "\nAll Tatum testnet checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
