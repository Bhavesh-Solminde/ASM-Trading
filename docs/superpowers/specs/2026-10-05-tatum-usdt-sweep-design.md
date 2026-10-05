# Tatum USDT Sweep — Design

**Date:** 2026-10-05
**Status:** Approved. Scope, gas and audit were decided with the owner in the 2026-10-05 brainstorm; the two remaining open questions were settled by the owner's "complete it" instruction, using the defaults below.
**Follows:** [Tatum USDT deposit gateway](2026-10-05-tatum-usdt-gateway-design.md). That design lists sweeping as a non-goal and leaves it for this tool.

## Goal

Every gateway deposit gets its own HD-derived address, so credited USDT ends up spread over many addresses. This tool moves it to the treasury (`TATUM_TREASURY_{TRON,BSC}_ADDRESS`). It is **offline**: the owner runs it locally. It never runs on the server, and the mnemonic never leaves the owner's machine.

## Decisions

| Topic | Decision |
|---|---|
| Which addresses | Deposits with status `COMPLETED` by default. `--include-unresolved` adds `EXPIRED` and `REJECTED` deposits, which hold late, underpaid or otherwise unmatched payments. Live deposits (`AWAITING_PAYMENT`, `PENDING_CONFIRMATION`) are never touched. |
| Amount | The address's **whole on-chain token balance**, read live. The DB amount is not used, so overpayments and second payments are swept too. |
| TRON gas | **Burn.** The gas wallet sends each address exactly the TRX it lacks: the energy fee limit plus bandwidth when the address has no free bandwidth. The gas wallet also pays the 1 TRX activation for a new address. There is no staking, delegation or energy rental. |
| BSC gas | The gas wallet sends `gasLimit × gasPrice` minus whatever BNB the address already holds. |
| Threshold | `--min-usdt` skips addresses holding less. Default: **10 on TRON** (one sweep costs about 7.5 TRX, roughly ₹240) and **1 on BSC** (well under ₹1). |
| Gas-wallet key | A local JSON file given with `--gas-key-file`, shaped `{ "<network>": { "privateKey": "…" } }`. It is never read from env. |
| Mnemonic | A local JSON file given with `--wallet-file`, shaped `{ "<network>": { "mnemonic": "…" } }`. This is the same shape as `.secrets/tatum-testnet-wallets.json`. |
| Leftover dust | Leftover TRX/BNB stays on the swept address. Moving it would cost about as much as it is worth. |
| Default mode | **Dry run.** The tool prints the plan and sends nothing. `--execute` sends. On mainnet, `--execute` also requires `--confirm-mainnet`. |
| Audit | A new `GatewaySweep` table, with one row per address per attempt. |

## Key safety

- **The derivation path is matched, not assumed.** Tatum derives TRON at `m/44'/195'/0'/0` on both networks, but BSC at `m/44'/1'/0'/0` on **testnet** and `m/44'/60'/0'/0` on mainnet (verified live: the testnet xpub only matches coin type 1). The tool derives each candidate account node from the mnemonic. It uses the path whose xpub **equals** the configured `TATUM_*_XPUB`. If none matches, the mnemonic is wrong and the tool refuses to run.
- **Per-address check.** For every candidate, the derived address must equal the deposit's stored `receivingAddress`. One mismatch aborts the whole run, before anything is sent.
- **Signing stays local.** Tatum's `/v3/*/transaction` endpoints that take `fromPrivateKey` are never used.
  - **TRON:** Tatum's node gateway (`https://tron-{testnet|mainnet}.gateway.tatum.io/wallet/*`; the testnet gateway is Shasta, verified live) **builds** each transaction. Before signing, the tool checks it:
    - `txCheck` rebuilds the protobuf from the JSON and confirms both `raw_data_hex` and `txID`.
    - Every intent field is compared with what the tool asked for: contract type, owner, recipient or contract, amount or ABI data, `call_value`, and `fee_limit`.
    - A node that returns anything else gets no signature.
  - **BSC:** the transaction is built and signed entirely locally (ethers), then broadcast with `eth_sendRawTransaction`. The tool also checks:
    - `eth_chainId` must be 97 on testnet or 56 on mainnet;
    - the gas price must not exceed `--max-gas-gwei` (default 10);
    - the broadcast hash must equal the locally computed hash.
- All calls go through `tatumRequest`/`tatumRpc`, so they share the 3 req/s pacing and 429 retry.

## Flow

1. **Reconcile.** Unfinished `GatewaySweep` rows from an earlier interrupted run are checked:
   - a row with a sweep tx hash becomes `CONFIRMED` or `FAILED` based on that tx's on-chain outcome;
   - a row without one becomes `FAILED` ("interrupted before broadcast").
   The next step re-reads the on-chain balance anyway, so nothing is double-sent.
2. **Plan.** For each candidate, derive and check the address, then read its token balance.
   - Skip it if the balance is empty or below `--min-usdt`.
   - Otherwise quote the gas: the TRON energy from `triggerconstantcontract`, or the BSC `eth_estimateGas` result plus a 25% margin. Read the native balance; the top-up is whatever is still missing.
   - Print a table and the totals.
3. **Execute** (`--execute`), one address at a time:
   - insert a `PENDING` row;
   - **re-quote** the address. The plan's figure is only an estimate, because an earlier sweep in the same run can lower this one's cost: the first token transfer into a treasury that holds none costs about twice the energy/gas of later ones, and any top-up beyond the real cost would be left on the address as dust. This was observed live on Shasta: 28,045 energy before the treasury held the token, about 13k after;
   - if a top-up is needed, the gas wallet sends it (`GAS_SENT`), and the tool waits until it succeeds on-chain;
   - the deposit address sends its whole token balance to the treasury (`SUBMITTED`), and the tool waits until it succeeds on-chain (`CONFIRMED`);
   - any error marks that row `FAILED` with the message, and the run moves on to the next address.
   Before starting, the tool checks that the gas wallet can cover every top-up plus overheads. If it can't, nothing is sent.

## Data model

```prisma
enum GatewaySweepStatus { PENDING GAS_SENT SUBMITTED CONFIRMED FAILED }

model GatewaySweep {
  id             String  @id @default(uuid())
  depositId      String                          // FK Deposit
  network        String
  fromAddress    String
  toAddress      String                          // treasury
  tokenContract  String
  tokenDecimals  Int
  rawAmount      Decimal @db.Decimal(78, 0)      // token base units swept
  gasTopUpRaw    Decimal? @db.Decimal(78, 0)     // sun / wei sent by the gas wallet
  gasTopUpTxHash String?
  sweepTxHash    String?
  status         GatewaySweepStatus @default(PENDING)
  error          String?
  createdAt / updatedAt
}
```

## CLI

```
pnpm --filter @asm/tatum sweep -- --network tron \
  --wallet-file ../../.secrets/tatum-testnet-wallets.json \
  --gas-key-file ../../.secrets/tatum-testnet-gas.json \
  [--min-usdt 10] [--include-unresolved] [--limit N] [--max-gas-gwei 10] \
  [--execute] [--confirm-mainnet]
```

The tool uses the same `.env` as the app: `TATUM_*`, `DATABASE_URL`/`DIRECT_URL`. For mainnet, point `DATABASE_URL` at production, for example through an SSH tunnel.

## Testing

- **Unit** (fake fetch / fake sweeper):
  - path selection by xpub, and a wrong mnemonic is refused;
  - ABI encoding;
  - TRON transaction verification rejects a tampered transaction (each field, and a `raw_data_hex`/`txID` mismatch);
  - BSC chain-id and gas-price guards;
  - orchestration: dry run sends nothing, threshold and empty skips, a mismatch aborts the run, the top-up equals the deficit, the row lifecycle is correct, and a failure records `FAILED` and moves on;
  - reconcile.
- **DB:** candidate selection by status/network, and row create/update.
- **Live testnet** (with funded test wallets):
  1. create a real gateway deposit in the running app;
  2. pay it on-chain with test USDT;
  3. watch the engine detect and credit it;
  4. dry-run the sweep;
  5. execute the sweep;
  6. confirm the treasury balance went up and the row is `CONFIRMED`;
  7. run again and confirm it's a no-op.
