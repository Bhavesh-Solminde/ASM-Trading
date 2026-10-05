# Tatum USDT Deposit Gateway — Design

**Date:** 2026-10-05
**Status:** Approved (brainstorm 2026-10-05)
**Replaces (by default, not by deletion):** the shared-address + unique-amount USDT
flow from `feat/usdt-deposit-verification` (PR #13).

## Goal

USDT deposits (TRC-20 on TRON, BEP-20 on BNB Smart Chain) go through a
Tatum-backed gateway: every deposit gets its **own fresh receiving address**,
derived from an HD wallet xpub. Payment detection is automatic. The user flow
keeps its current shape (method → network → amount → checkout page with
address/QR/countdown → live status → credited).

The existing "manual" flow (one shared address, unique-cents amount, our own
TronGrid/BSC watchers, tx-hash claim) is **kept intact** behind a switch and is
**off by default**.

## Non-goals

- Sweeping funds from per-deposit addresses to the treasury wallet. This needs
  private keys and gas (TRX/BNB) on each address. It is a separate follow-up: an
  offline script. The treasury addresses are recorded in env now so that script
  has a target.
- ETH / BTC / SOL deposits. The user's wallet has them, but the product only
  offers USDT TRC-20/BEP-20 today.
- A Tatum-hosted checkout. Tatum has none; our own checkout page *is* the
  gateway UI.

## Provider switch

`USDT_DEPOSIT_PROVIDER = "tatum" | "manual"`. Unset or any other value means `tatum`.

| | `tatum` (default) | `manual` |
|---|---|---|
| Networks offered | those with complete `TATUM_*` config | those with complete `USDT_*` config (unchanged) |
| Deposit address | fresh per deposit (xpub + index) | shared `USDT_*_RECEIVING_ADDRESS` |
| Amount | exactly what the user typed (no offset) | requested ± unique cents |
| Detection | Tatum webhook + engine poller via Tatum APIs | our TronGrid / BSC-RPC watchers |
| Tx-hash claim link | hidden | shown |
| Engine | Tatum runner starts; manual watchers idle | manual watchers start; Tatum runner idle |

Only one provider is active at a time, so nothing ever double-processes.

## Configuration (env, read via `process.env` like the existing USDT vars)

```
USDT_DEPOSIT_PROVIDER=tatum
TATUM_API_KEY=t-...                 # testnet keys start with "t-"
TATUM_NETWORK=testnet               # exactly "testnet" | "mainnet" — never defaulted
TATUM_TRON_XPUB=xpub...             # HD wallet xpub (TRON derivation path)
TATUM_TRON_USDT_CONTRACT=T...       # base58; Shasta test USDT: TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs
TATUM_BSC_XPUB=xpub...              # HD wallet xpub (EVM derivation path)
TATUM_BSC_USDT_CONTRACT=0x...       # BSC testnet USDT: 0x337610d27c682e347c9cd60bd4b3b107c9d34ddd
TATUM_BSC_USDT_DECIMALS=18
TATUM_WEBHOOK_URL=https://<host>/api/webhooks/tatum   # optional; unset = polling only
TATUM_WEBHOOK_HMAC_SECRET=...       # required when TATUM_WEBHOOK_URL is set; registered once per API key via PUT /v4/subscription (scripts/tatum-setup.ts)
TATUM_TREASURY_TRON_ADDRESS=TL5cUNhJjPSmyZVDncznin7FrSTtea6zUG     # sweep target (follow-up)
TATUM_TREASURY_BSC_ADDRESS=0x15e770A42b41f2606538505839042ddFEBACB590
```

A network is enabled only when it has an API key, a valid `TATUM_NETWORK`, its
xpub and its contract (BSC also needs decimals). If any of these is missing, the
network isn't offered, which is the same "hidden, not broken" rule used today.
**Mnemonics are never in env, the repo or the server.** Testnet mnemonics live
in gitignored `.secrets/`.

Tatum's TRON testnet is **Shasta** (verified: `/v3/tron/info` block height
matches Shasta, not Nile). BSC testnet is chain 97.

## Architecture

New workspace package **`@asm/tatum`** (`packages/tatum`). It is used by both
`apps/web` (deposit creation, webhook) and `apps/engine` (poller). It depends on
`@asm/db` and `@asm/logger`, and on `tronweb` for base58 ⇄ hex conversion.

```
packages/tatum/src/
  config.ts       readTatumConfig(): per-network config or null (pure, env-injected)
  http.ts         tatumFetch(): base URL, x-api-key, timeout, JSON, typed errors
  tron.ts         TRON adapter (derive, list incoming TRC-20, verify tx)
  bsc.ts          BSC adapter  (derive, list incoming BEP-20 via eth_getLogs, verify receipt)
  subscriptions.ts create/delete INCOMING_FUNGIBLE_TX alerts
  webhook.ts      verifyTatumSignature(), parseTatumWebhook()
  processor.ts    recordAndSettleTransfer(), scanDepositAddress()
  index.ts
```

### Chain adapter contract

```ts
interface GatewayChain {
  network: "tron" | "bsc";
  deriveAddress(index: number): Promise<string>;            // GET /v3/{tron|bsc}/address/{xpub}/{index}
  listIncomingTxHashes(address: string, sinceMs: number): Promise<string[]>;
  verifyTransfer(txHash: string, toAddress: string): Promise<VerifiedTx>;
}
type VerifiedTx =
  | { kind: "not_found" }
  | { kind: "failed" }                                        // reverted on-chain
  | { kind: "ok"; final: boolean; blockNumber: bigint; blockTimestampMs: number;
      transfers: { eventIndex: number; fromAddress: string; rawValue: bigint }[] };
```

- **TRON:**
  - List: `GET /v3/tron/transaction/account/{addr}/trc20`. Filter rows where
    `to == addr` and `tokenInfo.address == contract`.
  - Verify: `GET /v3/tron/transaction/{hash}`. The tx must have
    `ret[0].contractRet == "SUCCESS"`.
  - Transfers are decoded from `log[]`: emitter == contract hex, topic0 ==
    Transfer, topic2 == `to`. `eventIndex` = the log's position.
  - Final when `currentBlock − tx.blockNumber ≥ 20` (TRON solidifies at 19).
    `currentBlock` comes from `/v3/tron/info`. Block time = `rawData.timestamp`.
- **BSC:** all calls go through Tatum's RPC gateway (`https://bsc-{testnet|mainnet}.gateway.tatum.io`, `x-api-key`).
  - List: `eth_getLogs` filtered by contract + Transfer topic + `to` topic, over
    `[latest − lookback, latest]`. The lookback is derived from `sinceMs` at ~0.45 s
    per block and capped at 9 900 blocks (the gateway limit is 10 000).
  - Verify: `eth_getTransactionReceipt`. The receipt must have `status == 1`;
    decode the Transfer logs to `to`.
  - Final when `receipt.blockNumber ≤ finalized block` (`eth_getBlockByNumber("finalized")`).
    Block time comes from `eth_getBlockByNumber(n)`.

**The webhook body is never trusted for amounts or identity.** It is only a
wake-up signal. Every credit is based on `verifyTransfer`, fetched by us from
Tatum.

## Data model (one migration)

`Deposit` gains:

- `gateway String?` — `"TATUM"` for gateway deposits, null for every legacy row.
- `gatewayAddressIndex Int?` — the HD derivation index.
- `gatewaySubscriptionId String?` — the Tatum alert id, deleted on close.
- `@@unique([gateway, network, gatewayAddressIndex])`.

New table `GatewayAddressCounter { network String @id, nextIndex Int }`. It is
allocated with one atomic `UPDATE … SET nextIndex = nextIndex + 1 RETURNING`
(upsert on first use). Index 0 is reserved and never handed out.

Partial unique indexes `Deposit_live_amount_unique` and
`Deposit_live_usdt_amount_unique` are recreated with `AND "gateway" IS NULL`.
Gateway deposits are matched by address, so two users may have live $50
deposits at the same time.

## Flows

### Create deposit (`POST /api/deposits`, method USDT, provider tatum)

1. Load the network config. If it's missing, respond 503 (same as today).
2. `allocateGatewayAddressIndex(network)`, then `chain.deriveAddress(index)`.
3. `createGatewayUsdtDeposit({ amountUsdtMinor: requested, address, index, ttl 30 min })`.
   It uses the same min/max as today, with no offset.
4. If a webhook URL is configured, create an `INCOMING_FUNGIBLE_TX` alert for the
   address and store its id.
   - If the alert call fails, log it and continue. The poller still covers this
     address, so a Tatum alert outage never blocks deposits.
5. Return `{ checkoutToken }`, the same as today.

If derivation fails, the request fails with a 503 and no deposit row is
written, because derivation happens before insert.

### Detection: `recordAndSettleTransfer({ network, txHash, address })`

1. `verifyTransfer(txHash, address)`.
   - `not_found` or `failed`: do nothing (a failed tx credits nothing).
2. For each decoded transfer, `createChainCreditIfNew(...)` (idempotent on
   `(network, contract, txHash, eventIndex)`). The row starts at
   `finalityState: DETECTED`, or goes straight to `FINAL` if already final.
3. If the tx is final, move every `DETECTED` row for this tx to `FINAL`, then call
   `matchGatewayChainCredit(id)`.

It is called from two places:

- **Webhook** `POST /api/webhooks/tatum`:
  - Verify HMAC. The header is `x-payload-hash`, computed as base64
    HMAC-SHA512 over `JSON.stringify(body)`, compared constant-time. A bad or
    missing signature returns 401.
  - Read `{ address, txId, chain }` from the body and look up a gateway deposit
    by `(network, address)`. If there's no deposit, return 200 and ignore the
    event.
  - Call `recordAndSettleTransfer`.
  - Always return 200 once the signature is valid, so Tatum stops retrying. Our
    poller is the safety net.
- **Engine `startTatumRunner()`**, every `USDT_WATCHER_TICK_INTERVAL_MS`:
  - For each gateway deposit that is `AWAITING_PAYMENT`/`PENDING_CONFIRMATION`,
    or expired within the last 24 h: `listIncomingTxHashes`, then
    `recordAndSettleTransfer` for each.
  - Then re-check `DETECTED` gateway credits until they are final.
  - Then expire gateway deposits more than 2 h past `expiresAt`, and delete their
    alerts.

### Match: `matchGatewayChainCredit(chainCreditId)` in `@asm/db`

Look up the deposit by `(gateway TATUM, network, receivingAddress = credit.toAddress)`.

| Situation | Outcome |
|---|---|
| no deposit owns the address | `UNMATCHED` / `NO_LIVE_DEPOSIT` |
| deposit already COMPLETED / REJECTED | `MANUAL_REVIEW` / `ADDRESS_ALREADY_USED` |
| `blockTimestamp ≥ expiresAt` or deposit EXPIRED | `MANUAL_REVIEW` / `EXPIRED_DEPOSIT` |
| wrong token contract | `MANUAL_REVIEW` / `WRONG_TOKEN_CONTRACT` |
| `normalizedAmountMinor < amountUsdtMinor` | `MANUAL_REVIEW` / `UNDERPAID` |
| otherwise | **credit what actually arrived** (overpay is credited in full) |

Crediting reuses `creditDepositToAccount` with a new, non-admin option
`receivedUsdtMinor`, which rewrites the deposit's amounts to the received value
in the same guarded UPDATE. Bonus, turnover, audit log and linkage detection are
all unchanged. On completion the deposit's alert is deleted (best-effort).

Manual-review and unmatched rows go to the **existing** admin USDT review
screen, which already resolves `ChainCredit`s against deposits with an override
amount.

### Checkout page and status

- Same layout. For a gateway deposit:
  - the QR code and copy-address box show the deposit's own address;
  - the amount reads "Send at least X USDT";
  - the "Sent a different amount? Submit your transaction" link is hidden.
- `GET /api/deposits/[id]/status`: for gateway deposits, show the latest
  `ChainCredit` to the deposit's address. The existing poller already renders
  `DETECTED` → `FINAL` → `MATCHED`.

## Error handling

- Every Tatum call has a 10 s timeout. A failure throws `TatumError` (status +
  message). The runner logs it and retries on the next tick, changing nothing.
- Amounts are always bigint raw values. Normalization reuses
  `rawToNormalizedMinor`, and sub-cent dust goes to `MANUAL_REVIEW` as today.
- Mainnet safety: `TATUM_NETWORK` must be set explicitly, and a `t-` key with
  `TATUM_NETWORK=mainnet` (or the reverse) is refused as a config error.

## Testing

- **Unit** (`packages/tatum`, vitest, `fetch` injected):
  - config parsing and the key/network mismatch check;
  - HMAC verification against Tatum's documented example;
  - TRON log decoding (real Shasta tx fixture) and BSC receipt decoding;
  - finality rules;
  - webhook parsing.
- **DB** (`packages/db`, existing pattern):
  - address-index allocation is unique and starts at 1;
  - `createGatewayUsdtDeposit` allows two live same-amount deposits;
  - `matchGatewayChainCredit` covers every row of the table above;
  - `receivedUsdtMinor` credits the received amount.
- **Web route tests:**
  - deposit creation picks the provider;
  - webhook rejects a bad signature and accepts a good one.
- **Live testnet script** (`scripts/tatum-testnet-check.ts`):
  - derive addresses and compare them with Tatum;
  - create and delete an alert;
  - list transfers and verify a known Shasta USDT tx;
  - post a correctly signed webhook to local `/api/webhooks/tatum`.
- A real on-chain end-to-end test needs testnet USDT sent to a derived address.
  The owner does this manually, because faucets require captchas.
