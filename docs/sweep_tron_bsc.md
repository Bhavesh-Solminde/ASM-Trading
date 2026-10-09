# Sweeping USDT (TRON + BSC) to the treasury: runbook

How to move customers' USDT from the gateway's deposit addresses to the treasury. This is written for the owner and for future Claude sessions.

> **Who runs what:** the **owner** runs every command that moves real money (`--execute`). An AI assistant may prepare files, read balances and review dry-run output. It must never execute a mainnet transfer, generate or read the mainnet keys, or ask for the 24 words.

Design details: [`docs/superpowers/specs/2026-10-05-tatum-usdt-sweep-design.md`](superpowers/specs/2026-10-05-tatum-usdt-sweep-design.md).

---

## 1. Why sweeping exists

> **Since 2026-10-09 only BSC deposits get their own address.** TRON deposits go straight to the client's own wallets (`USDT_TRON_PROVIDER=manual`: each deposit holds one of the `USDT_RECEIVING_ADDRESSES` alone for a 5-minute slot, see docs/superpowers/plans/2026-10-09-tron-time-slots.md), because sweeping one TRON address costs ≈ 9.5 TRX. TRON sweeps are now only for the gateway addresses paid before that date.

Every gateway USDT deposit gets **its own address**, derived from the deposit HD wallet (the 24 words). The website credits the customer as soon as the payment is final, but the USDT itself **stays on that deposit address** until it's swept. Tatum never holds funds; it's only the API the server uses to create addresses and watch the chain.

```
customer ──USDT──▶ deposit address #N  ──sweep (owner runs)──▶ treasury
                   (from the 24 words)    gas wallet pays fees
```

## 2. The wallets

| Wallet | Address(es) | Key lives | Role |
|---|---|---|---|
| **Treasury** | TRON `TL5cUNhJjPSmyZVDncznin7FrSTtea6zUG` · BSC `0x15e770A42b41f2606538505839042ddFEBACB590` | Owner's own wallet (Trust Wallet) | Final destination of all USDT |
| **Deposit HD wallet** (mainnet) | One per deposit: #1 TRON `TTxmy2nTmqubFPV9JHwqWZgivYM1SQ4848`, #1 BSC `0xf301564d0102d6f0ec2e80cedecfaa333595b489`, then #2, #3, … | 24 words: on paper, plus `.secrets/tatum-mainnet-wallets.json` on the owner's Mac. The server only has the xpubs | Receives customer payments |
| **Gas wallet** (mainnet) | TRON `TXJQiFEj3EkWnmWC55xHx1SXyYAm3T2Mea` · BSC `0xea8723ea7aade399e16aa5614bea30a7d6c85e2d` | `.secrets/tatum-mainnet-gas.json` on the owner's Mac | Holds a little TRX/BNB to pay sweep fees |

All of `.secrets/` is gitignored and lives only in `~/Developer/Personal/AMScoins/asmtrading-tatum/.secrets/`. The testnet files (`tatum-testnet-*.json`) are for testing only; never use them with real money.

## 3. What a sweep costs

| | TRON | BSC |
|---|---|---|
| Per address | ≈ **8 TRX** (≈ $2.7) taken from the gas wallet, made up of: 1.1 TRX one-time activation of the new address, about 6.5 TRX of energy for the USDT transfer, and gas-wallet bandwidth. A further 25% safety margin (≈ 1.6 TRX) is sent along but **left as dust** on the deposit address | ≈ 0.00001 BNB (well under ₹1) |
| Keep in the gas wallet | **12 TRX minimum for one address**; 20 TRX for comfort (≈ 9.5 TRX per address) | 0.001 BNB covers dozens of sweeps |

- If the treasury had **never** held USDT, the first TRON sweep would cost about twice the energy. It currently holds USDT, so the cheaper figure applies.
- The cost is **per address, i.e. per deposit**. Waiting doesn't make it cheaper. Small TRON deposits are expensive to sweep (≈ $2.7 on a $10 deposit). `--min-usdt` (default **10 on TRON, 1 on BSC**) skips addresses holding less.
- The tool re-checks the fee just before every send, so it never over-funds an address because of a stale estimate.

## 4. One-time setup (already done on 2026-10-05; redo only if the Mac or files are lost)

1. **Deposit and gas wallets:** `pnpm --filter @asm/tatum wallets:generate`. **Do not rerun it** while the current files exist: it refuses to overwrite them, and a new wallet would not control existing deposits.
2. **24-word backup** on paper (and optionally in a password manager). It is **24 words**, not 12. The JSON shows the same phrase twice (under `tron` and `bsc`).
3. **Server env** (`/opt/asmtrader/.env.production`): `USDT_DEPOSIT_PROVIDER=tatum`, `TATUM_API_KEY` (the mainnet key; it starts with `t-`, the same as testnet keys), `TATUM_NETWORK=mainnet`, `TATUM_TRON_XPUB`, `TATUM_BSC_XPUB`, the two USDT contracts and `TATUM_BSC_USDT_DECIMALS=18`. The server **never** gets the 24 words.

### If `.secrets/tatum-mainnet-wallets.json` is lost
Recreate it **by hand**, on the owner's Mac only, from the paper backup:
```json
{ "tron": { "mnemonic": "word1 word2 … word24" }, "bsc": { "mnemonic": "word1 word2 … word24" } }
```
The sweep refuses to run unless these words reproduce the server's xpubs, so a typo can't send funds anywhere. If the gas wallet file is lost, generate a new gas wallet (use `wallets:generate -- --name tatum-mainnet-2` and keep only its `-gas.json`) and move any leftover TRX/BNB yourself.

## 5. Each time you sweep

All commands run on the owner's Mac. Paste each command's output into the chat if you want a review.

### Step 1: Check the gas wallet has fuel
Open the gas wallet in an explorer: [Tronscan](https://tronscan.org/#/address/TXJQiFEj3EkWnmWC55xHx1SXyYAm3T2Mea) and [BscScan](https://bscscan.com/address/0xea8723ea7aade399e16aa5614bea30a7d6c85e2d). If it's low, send TRX (TRON network) or BNB (BNB Smart Chain) to it. The dry run in Step 4 also prints the gas wallet balance and `← NOT ENOUGH` if it's short.

### Step 2: Create or refresh the sweep settings
This step only needs to be redone if the API key or DB password changes. It prints setting **names** only.
```bash
cd ~/Developer/Personal/AMScoins/asmtrading-tatum && { printf '%s\n' 'TATUM_NETWORK=mainnet' 'TATUM_TRON_XPUB=xpub6EgeUZN2y759CPRon9T6AbuHqJXHKv6thg4R99vrJuqVvXWMj2SDYLFMgQLeemsLEoqnRbmQsiKbGyQFic4HHLZNSknrpBN1SF69wPj2B4W' 'TATUM_BSC_XPUB=xpub6EAkCkpxFe8LKy99AsSbhm2CF9tT5bNvYmk89GqaVJNGMPPsnsdwTpPBQcSLnGKA88Q4JLFBzrUfxgZbLvW2mYCvC61frgcdB8bVGvCtxTB' 'TATUM_TRON_USDT_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' 'TATUM_BSC_USDT_CONTRACT=0x55d398326f99059ff775485246999027b3197955' 'TATUM_BSC_USDT_DECIMALS=18' 'TATUM_TREASURY_TRON_ADDRESS=TL5cUNhJjPSmyZVDncznin7FrSTtea6zUG' 'TATUM_TREASURY_BSC_ADDRESS=0x15e770A42b41f2606538505839042ddFEBACB590'; ssh -o ConnectTimeout=10 -o IdentitiesOnly=yes -i ~/.ssh/asmtrader_ci deploy@187.52.118.185 'grep -E "^(TATUM_API_KEY|DATABASE_URL)=" /opt/asmtrader/.env.production' | sed -E 's#@postgres:5432/#@127.0.0.1:15432/#'; } > .secrets/mainnet-sweep.env && chmod 600 .secrets/mainnet-sweep.env && grep -oE '^[A-Z_]+=' .secrets/mainnet-sweep.env | tr '\n' ' '
```
Expect 10 names, including `TATUM_API_KEY=` and `DATABASE_URL=`.

### Step 3: Open the database tunnel
The sweep reads which deposits are completed, and records every sweep, in the **production** DB.
```bash
ssh -f -N -o ExitOnForwardFailure=yes -o IdentitiesOnly=yes -i ~/.ssh/asmtrader_ci -L 15432:127.0.0.1:5432 deploy@187.52.118.185 && echo "tunnel open"
```
If it says the port is already in use, the tunnel is probably still open from before. That's fine.

### Step 4: Dry run (nothing is sent)
```bash
cd ~/Developer/Personal/AMScoins/asmtrading-tatum && for n in tron bsc; do pnpm --filter @asm/tatum exec dotenv -e ../../.secrets/mainnet-sweep.env -- tsx scripts/sweep.ts --network $n --wallet-file ../../.secrets/tatum-mainnet-wallets.json --gas-key-file ../../.secrets/tatum-mainnet-gas.json; done
```
Read the plan:
- **Each line** is a deposit address: `sweep X USDT`, `skip: empty`, or `skip: … < min`.
- **`top-up`** is the TRX/BNB the gas wallet will send to that address first.
- **`Total`** is the USDT that will reach the treasury, and **`gas wallet spends ≈`** is the fee budget.
- **`Gas wallet … holds …`**: if it says `← NOT ENOUGH`, fund it first (Step 1).

The tool refuses to run, sending nothing, if:
- the 24 words don't match the server's xpubs;
- any derived address differs from the one stored on the deposit;
- on BSC, the gas price is above 10 gwei.

### Step 5: Execute (the owner runs this)
Run a single network, after the dry run looks right:
```bash
cd ~/Developer/Personal/AMScoins/asmtrading-tatum && pnpm --filter @asm/tatum exec dotenv -e ../../.secrets/mainnet-sweep.env -- tsx scripts/sweep.ts --network bsc --wallet-file ../../.secrets/tatum-mainnet-wallets.json --gas-key-file ../../.secrets/tatum-mainnet-gas.json --execute --confirm-mainnet
```
Change `--network bsc` to `--network tron` for TRON. Expect a line per address (`gas top-up … sent`, `sweep … sent`, `CONFIRMED`) and then `Done: N confirmed, 0 failed, 0 pending`.

Useful flags:
- `--min-usdt 50`: skip addresses holding less than 50 USDT.
- `--limit 3`: sweep at most 3 addresses this run.
- `--include-unresolved`: also sweep EXPIRED/REJECTED deposits (late, underpaid or unmatched payments). Check the admin USDT review queue first.

### Step 6: Verify and close the tunnel
- **Treasury:** check it received the USDT on [Tronscan](https://tronscan.org/#/address/TL5cUNhJjPSmyZVDncznin7FrSTtea6zUG) and [BscScan](https://bscscan.com/address/0x15e770A42b41f2606538505839042ddFEBACB590#tokentxns).
- **Re-run Step 4:** every swept address should now say `skip: empty`.
- **Close the tunnel:**
```bash
pkill -f "15432:127.0.0.1:5432" && echo "tunnel closed"
```

## 6. Troubleshooting

| Message | Meaning / fix |
|---|---|
| `WrongMnemonicError … does not produce the configured TATUM_*_XPUB` | Wrong words or wrong file. Check the wallet file against the paper backup. Nothing was sent. |
| `AddressMismatchError` | A deposit's stored address doesn't match the key. Stop and investigate; nothing was sent. |
| `InsufficientGasError` / `← NOT ENOUGH` | Fund the gas wallet (Step 1). Nothing was sent. |
| `ECONNREFUSED 127.0.0.1:15432` / Prisma can't connect | The tunnel isn't open (Step 3). |
| A row left `SUBMITTED` / `pending` | The transaction hadn't confirmed when the tool stopped waiting. The next run reconciles it first. Never re-send by hand. |
| `FAILED … ` on one address | That address's error is recorded in `GatewaySweep.error`; the others continued. Re-running is safe, because what to sweep always comes from the live on-chain balance. |
| `Tatum 429` | Free-plan rate limit (3 req/s). The tool already paces and retries; just re-run. |
| Tronscan says a deposit address is "inactivated" | Normal. Receiving USDT doesn't activate a TRON address; the sweep pays the activation. |

## 7. Facts worth remembering

- Tatum API keys start with `t-` on **both** testnet and mainnet. The engine asks Tatum which network the key serves; on a mismatch it logs `tatum.network_mismatch` and stays idle.
- Tatum derives BSC **testnet** wallets at `m/44'/1'/0'/0` and **mainnet** at `m/44'/60'/0'/0`; TRON uses `m/44'/195'/0'/0` on both. The sweep picks the path by matching the xpub.
- Tatum's free plan rejects BSC `eth_call`, so the sweep reads BEP-20 balances from Tatum's REST endpoint.
- Production deploys go through GitHub Actions on merge to `main`. If Actions is down, the owner can deploy from the Mac (rsync a clean `origin/main` checkout and run `docker compose up -d --build`). Never edit `.env.production` while a deploy is running: compose reads it when the deploy starts.
