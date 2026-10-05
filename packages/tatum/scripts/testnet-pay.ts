/**
 * TESTNET ONLY: pay a gateway deposit address with test USDT, playing the
 * customer for an end-to-end test. Signs locally with the test gas/funder
 * wallet (same file the sweep uses). Refuses to run against mainnet.
 *
 *   pnpm --filter @asm/tatum pay:testnet -- --network tron --to T… --amount 25 \
 *     --key-file ../../.secrets/tatum-testnet-gas.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { formatUnits, parseUnits } from "ethers";
import { readTatumConfig, type GatewayNetwork } from "../src";
import { createChainSweeper, signerFromPrivateKey } from "../src/sweep";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    network: { type: "string" },
    to: { type: "string" },
    amount: { type: "string" },
    "key-file": { type: "string" },
  },
});

const network = args.network as GatewayNetwork;
const cfg = network === "tron" || network === "bsc" ? readTatumConfig(network) : null;
if (!cfg) throw new Error("--network tron|bsc with a complete TATUM_* config is required.");
if (!cfg.testnet) throw new Error("testnet-pay refuses to run against MAINNET.");
if (!args.to || !args.amount || !args["key-file"]) throw new Error("--to, --amount and --key-file are required.");

const entry = (JSON.parse(readFileSync(resolve(process.cwd(), args["key-file"]), "utf8")) as Record<string, { privateKey?: string }>)[network];
if (!entry?.privateKey) throw new Error(`--key-file has no ${network}.privateKey`);
const payer = signerFromPrivateKey(network, entry.privateKey);
const sweeper = createChainSweeper(cfg);
const to = network === "bsc" ? args.to.toLowerCase() : args.to;
const amount = parseUnits(args.amount, cfg.tokenDecimals);

const balance = await sweeper.tokenBalance(payer.address);
if (balance < amount) throw new Error(`Payer ${payer.address} holds ${formatUnits(balance, cfg.tokenDecimals)} USDT, needs ${args.amount}.`);
const quote = await sweeper.quoteSweep(payer.address, to, amount);
const native = await sweeper.nativeBalance(payer.address);
if (native < quote.requiredNative) throw new Error(`Payer needs ${quote.requiredNative} ${sweeper.nativeSymbol} base units for gas, holds ${native}.`);

const hash = await sweeper.sendToken(payer, to, amount, quote);
console.log(`Sent ${args.amount} test USDT ${payer.address} → ${to}\n  tx ${hash}`);
console.log(`  outcome: ${await sweeper.waitForTx(hash, 120_000)}`);
