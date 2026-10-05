/**
 * OFFLINE sweep: moves USDT from gateway deposit addresses to the treasury.
 * Run on the owner's machine only — it needs the HD mnemonic and a gas-wallet
 * key, read from local files, never env. Dry run unless --execute.
 *
 *   pnpm --filter @asm/tatum sweep -- --network tron \
 *     --wallet-file ../../.secrets/tatum-testnet-wallets.json \
 *     --gas-key-file ../../.secrets/tatum-testnet-gas.json [--execute]
 *
 * Flags: --min-usdt <n> (default 10 on TRON, 1 on BSC) · --include-unresolved
 * (also EXPIRED/REJECTED deposits) · --limit <n> · --max-gas-gwei <n> (BSC,
 * default 10) · --tx-timeout-sec <n> (default 120) · --confirm-mainnet
 * (required with --execute on mainnet).
 *
 * Design: docs/superpowers/specs/2026-10-05-tatum-usdt-sweep-design.md
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { formatUnits, parseUnits } from "ethers";
import { listGatewaySweepCandidates, listOpenGatewaySweeps, prisma, startGatewaySweep, updateGatewaySweep } from "@asm/db";
import { readTatumConfig, tatumChainId, tronBase58ToHex, type GatewayNetwork } from "../src";
import {
  createChainSweeper,
  createHdSigner,
  executeSweep,
  gasNeeded,
  planSweep,
  reconcileOpenSweeps,
  signerFromPrivateKey,
  type SweepContext,
} from "../src/sweep";

const DEFAULT_MIN_USDT: Record<GatewayNetwork, string> = { tron: "10", bsc: "1" };

function fail(message: string): never {
  console.error(`\nERROR: ${message}`);
  process.exit(2);
}

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    network: { type: "string" },
    "wallet-file": { type: "string" },
    "gas-key-file": { type: "string" },
    "min-usdt": { type: "string" },
    "include-unresolved": { type: "boolean", default: false },
    limit: { type: "string" },
    "max-gas-gwei": { type: "string", default: "10" },
    "tx-timeout-sec": { type: "string", default: "120" },
    execute: { type: "boolean", default: false },
    "confirm-mainnet": { type: "boolean", default: false },
  },
});

const network = args.network as GatewayNetwork;
if (network !== "tron" && network !== "bsc") fail("--network must be tron or bsc.");
const cfg = readTatumConfig(network);
if (!cfg) fail(`TATUM_* config for ${network} is incomplete (see .env.example).`);
if (!cfg.testnet && args.execute && !args["confirm-mainnet"]) {
  fail("This is MAINNET. Re-run with --confirm-mainnet to send real transactions (try without --execute first).");
}

const readJsonFile = (flag: string): Record<string, Record<string, string>> => {
  const path = args[flag as "wallet-file"];
  if (!path) fail(`--${flag} is required.`);
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as Record<string, Record<string, string>>;
  } catch (err) {
    fail(`Cannot read --${flag} ${path}: ${(err as Error).message}`);
  }
};

const treasuryRaw = (process.env[`TATUM_TREASURY_${network.toUpperCase()}_ADDRESS`] ?? "").trim();
let treasury: string;
try {
  if (network === "tron") {
    tronBase58ToHex(treasuryRaw); // checksum
    treasury = treasuryRaw;
  } else {
    if (!/^0x[0-9a-fA-F]{40}$/.test(treasuryRaw)) throw new Error("not a 0x address");
    treasury = treasuryRaw.toLowerCase();
  }
} catch (err) {
  fail(`TATUM_TREASURY_${network.toUpperCase()}_ADDRESS is invalid: ${(err as Error).message}`);
}

const mnemonic = readJsonFile("wallet-file")[network]?.["mnemonic"];
if (!mnemonic) fail(`--wallet-file has no ${network}.mnemonic.`);
let hd: ReturnType<typeof createHdSigner>;
try {
  hd = createHdSigner(network, mnemonic, cfg.xpub);
} catch (err) {
  fail((err as Error).message);
}

let gasSigner: ReturnType<typeof signerFromPrivateKey> | null = null;
if (args["gas-key-file"]) {
  const entry = readJsonFile("gas-key-file")[network];
  if (!entry?.["privateKey"]) fail(`--gas-key-file has no ${network}.privateKey.`);
  gasSigner = signerFromPrivateKey(network, entry["privateKey"]);
  if (entry["address"] && entry["address"].toLowerCase() !== gasSigner.address.toLowerCase()) {
    fail(`--gas-key-file ${network}.address does not match its privateKey.`);
  }
} else if (args.execute) {
  fail("--gas-key-file is required with --execute.");
}

const decimals = cfg.tokenDecimals;
const minUsdt = args["min-usdt"] ?? DEFAULT_MIN_USDT[network];
let minTokenRaw: bigint;
try {
  minTokenRaw = parseUnits(minUsdt, decimals);
} catch {
  fail(`--min-usdt ${minUsdt} is not a number.`);
}
const limit = args.limit === undefined ? undefined : Number(args.limit);
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) fail("--limit must be a positive integer.");

const sweeper = createChainSweeper(cfg, { maxGasPriceWei: parseUnits(args["max-gas-gwei"]!, 9) });
const fmtToken = (raw: bigint) => formatUnits(raw, decimals);
const fmtNative = (raw: bigint) => `${formatUnits(raw, sweeper.nativeDecimals)} ${sweeper.nativeSymbol}`;

const ctx: SweepContext = {
  network,
  tokenContract: cfg.tokenContract,
  tokenDecimals: decimals,
  treasury,
  sweeper,
  deriveSigner: (i) => hd.derive(i),
  // Dry runs without a gas key never send, so a placeholder is never used.
  gasSigner: gasSigner ?? { address: "", privateKey: "" },
  db: {
    listCandidates: listGatewaySweepCandidates,
    start: startGatewaySweep,
    update: updateGatewaySweep,
    listOpen: listOpenGatewaySweeps,
  },
  log: (line) => console.log(`  ${line}`),
  txTimeoutMs: Number(args["tx-timeout-sec"]) * 1000,
};

try {
  console.log(`USDT sweep — ${tatumChainId(cfg)} ${args.execute ? "(EXECUTE)" : "(dry run)"}`);
  console.log(`  token ${cfg.tokenContract} (${decimals} dp) → treasury ${treasury}`);
  console.log(`  HD path ${hd.path}/i · min ${minUsdt} USDT · ${args["include-unresolved"] ? "COMPLETED+EXPIRED+REJECTED" : "COMPLETED only"}`);

  const open = await listOpenGatewaySweeps(network);
  if (open.length) {
    if (args.execute) {
      console.log(`\nReconciling ${open.length} unfinished sweep(s) from an earlier run:`);
      await reconcileOpenSweeps(ctx);
    } else {
      console.log(`\nNote: ${open.length} unfinished sweep(s) from an earlier run; --execute reconciles them first.`);
    }
  }

  const plan = await planSweep(ctx, { minTokenRaw, includeUnresolved: args["include-unresolved"], ...(limit !== undefined ? { limit } : {}) });
  console.log(`\nPlan (${plan.length} address${plan.length === 1 ? "" : "es"} checked):`);
  for (const p of plan) {
    const head = `  #${p.candidate.addressIndex} ${p.candidate.receivingAddress} [${p.candidate.status}]`;
    if (p.kind === "skip") {
      console.log(`${head}  skip: ${p.reason === "empty" ? "empty" : `${fmtToken(p.tokenBalance)} USDT < min`}`);
    } else {
      console.log(
        `${head}  sweep ${fmtToken(p.tokenBalance)} USDT · holds ${fmtNative(p.nativeBalance)} · ` +
          `top-up ${p.topUp > 0n ? fmtNative(p.topUp) : "none"} (${p.quote.note})`,
      );
    }
  }
  const sweeps = plan.filter((p) => p.kind === "sweep");
  const total = sweeps.reduce((s, p) => s + p.tokenBalance, 0n);
  const need = gasNeeded(plan);
  console.log(`\nTotal: ${fmtToken(total)} USDT from ${sweeps.length} address(es); gas wallet spends ≈ ${fmtNative(need)}.`);
  if (gasSigner) {
    const have = await sweeper.nativeBalance(gasSigner.address);
    console.log(`Gas wallet ${gasSigner.address} holds ${fmtNative(have)}${have < need ? "  ← NOT ENOUGH" : ""}.`);
  }

  if (!args.execute) {
    console.log("\nDry run — nothing sent. Re-run with --execute to sweep.");
  } else if (sweeps.length === 0) {
    console.log("\nNothing to sweep.");
  } else {
    console.log("\nExecuting:");
    const result = await executeSweep(ctx, plan);
    console.log(`\nDone: ${result.confirmed} confirmed, ${result.failed} failed, ${result.pending} pending.`);
    if (result.failed > 0 || result.pending > 0) process.exitCode = 1;
  }
} catch (err) {
  console.error(`\nERROR: ${(err as Error).message}`);
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
