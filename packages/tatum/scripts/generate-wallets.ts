/**
 * Generates the gateway's deposit HD wallet and a sweep gas wallet. The
 * OWNER runs this on their own machine — real-money keys are never created
 * by anyone else:
 *
 *   pnpm --filter @asm/tatum wallets:generate
 *
 * Writes two files (mode 600, never overwritten) under .secrets/:
 *   tatum-mainnet-wallets.json  one 24-word phrase + the TRON/BSC xpubs, in
 *                               the shape `sweep --wallet-file` reads
 *   tatum-mainnet-gas.json      fresh TRON + BSC keys for `sweep --gas-key-file`
 *
 * Prints only PUBLIC values: the two xpubs for the server env, a sample
 * deposit address per chain, and the gas wallet addresses. Never the phrase
 * or a key. (--name / --dir change the file names / folder.)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateGatewayWallets } from "../src/sweep";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { name: { type: "string", default: "tatum-mainnet" }, dir: { type: "string", default: "../../.secrets" } },
});

const dir = resolve(process.cwd(), args.dir!);
const walletsPath = resolve(dir, `${args.name}-wallets.json`);
const gasPath = resolve(dir, `${args.name}-gas.json`);
for (const p of [walletsPath, gasPath]) {
  if (existsSync(p)) {
    console.error(`Refusing to overwrite ${p}: it may hold the only copy of a live wallet. Use another --name.`);
    process.exit(1);
  }
}

const w = generateGatewayWallets();
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
mkdirSync(dir, { recursive: true });
writeFileSync(
  walletsPath,
  json({
    note: "Deposit HD wallet. These 24 words control EVERY customer deposit address. Back them up offline; never put them on a server.",
    tron: { mnemonic: w.mnemonic, xpub: w.xpub.tron },
    bsc: { mnemonic: w.mnemonic, xpub: w.xpub.bsc },
  }),
  { mode: 0o600 },
);
writeFileSync(
  gasPath,
  json({
    note: "Sweep gas wallet: keep only a little TRX/BNB here for transfer fees.",
    tron: { address: w.gas.tron.address, privateKey: w.gas.tron.privateKey },
    bsc: { address: w.gas.bsc.address, privateKey: w.gas.bsc.privateKey },
  }),
  { mode: 0o600 },
);

console.log(`Wrote ${walletsPath}\nWrote ${gasPath}\n`);
console.log("Server env (public, safe to share):");
console.log(`  TATUM_TRON_XPUB=${w.xpub.tron}`);
console.log(`  TATUM_BSC_XPUB=${w.xpub.bsc}\n`);
console.log("Sample deposit addresses (index 1):");
console.log(`  TRON ${w.sample.tron}\n  BSC  ${w.sample.bsc}\n`);
console.log("Sweep gas wallet (fund with a little TRX / BNB before sweeping):");
console.log(`  TRON ${w.gas.tron.address}\n  BSC  ${w.gas.bsc.address}\n`);
console.log("NEXT: open the wallets file, copy the 24 words onto paper or into a password manager, and keep that backup safe.");
console.log("Without them, USDT on deposit addresses can never be swept. Never paste them into chat, email or the server.");
