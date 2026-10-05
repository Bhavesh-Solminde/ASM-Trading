# Tatum USDT Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** USDT (TRC-20 / BEP-20) deposits get a fresh per-deposit address derived
from a Tatum HD-wallet xpub. Payment is detected through a Tatum webhook plus an
engine poller and credited automatically. The existing manual flow is kept
behind `USDT_DEPOSIT_PROVIDER=manual`.

**Architecture:**
- A new workspace package `@asm/tatum` holds the chain adapters (TRON via Tatum
  v3 REST, BSC via Tatum's JSON-RPC gateway), the subscription client, the
  webhook verifier and the transfer processor.
- `@asm/db` gains:
  - gateway columns on `Deposit`;
  - an address-index counter;
  - `matchGatewayChainCredit`, which matches by address, not amount.
- Web creates gateway deposits and receives webhooks. The engine runs a poller
  that does verification, finality checks and expiry.
- Every credit is based on a tx we fetch from Tatum ourselves, never on the
  webhook body.

**Tech Stack:** TypeScript, pnpm workspaces, Prisma 7 + Postgres, Next.js 16
route handlers, vitest, tronweb (address conversion only), Tatum REST v3/v4 + RPC
gateway.

**Spec:** `docs/superpowers/specs/2026-10-05-tatum-usdt-gateway-design.md`

## Global Constraints

- `USDT_DEPOSIT_PROVIDER` unset or anything other than `"manual"` means `tatum`.
- `TATUM_NETWORK` must be exactly `testnet` or `mainnet` and is never defaulted. A
  `t-` key with `mainnet` (or a non-`t-` key with `testnet`) is a config error,
  and the network is then disabled.
- TRON final at `currentBlock − txBlock ≥ 20`. BSC final at `txBlock ≤ finalized`.
- BSC `eth_getLogs` lookback is ≤ 9 900 blocks.
- Gateway deposit TTL is 30 min. Expire 2 h past `expiresAt`. Watch addresses up to
  24 h past `expiresAt`.
- Address index 0 is reserved. Indexes start at 1 per network.
- Webhook HMAC: base64 HMAC-SHA512 of `JSON.stringify(body)` in the `x-payload-hash`
  header, compared constant-time.
- Every Tatum HTTP call has a 10 s timeout.
- Mnemonics are never committed. Testnet ones live in `.secrets/` (gitignored).
- Network ids stay `"tron"` / `"bsc"`. TRON addresses and contracts are base58;
  BSC addresses and contracts are lowercase hex.
- Do not delete or change behaviour of the manual flow when the provider is `manual`.

## File map

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` + migration `20261005120000_tatum_gateway` | gateway columns, counter table, index rewrite |
| `packages/db/src/repositories/gateway-deposit.ts` (+ test) | allocate index, create deposit, subscription bookkeeping, watch list, expiry, `matchGatewayChainCredit`, finalize credits |
| `packages/db/src/repositories/deposit.ts` | `receivedUsdtMinor` option on `creditDepositToAccount`; manual expiry ignores gateway rows |
| `packages/tatum/src/config.ts` (+ test) | env → per-network config |
| `packages/tatum/src/http.ts` | fetch wrapper, `TatumError` |
| `packages/tatum/src/tron.ts` / `bsc.ts` (+ tests) | chain adapters implementing `GatewayChain` |
| `packages/tatum/src/subscriptions.ts` | create/delete alerts, enable HMAC |
| `packages/tatum/src/webhook.ts` (+ test) | signature verification + body parsing |
| `packages/tatum/src/processor.ts` (+ test) | `recordAndSettleTransfer`, `scanGatewayDeposit` |
| `apps/web/src/lib/usdt-networks.ts` | provider-aware enabled list |
| `apps/web/src/app/api/deposits/route.ts` (+ test) | gateway deposit creation |
| `apps/web/src/app/api/webhooks/tatum/route.ts` (+ test) | webhook endpoint |
| `apps/web/src/app/api/deposits/[id]/status/route.ts` | gateway status lookup |
| `apps/web/src/app/checkout/[token]/page.tsx` | gateway copy, hide claim link |
| `apps/engine/src/tatum-runner.ts` + `main.ts` | poller; manual watchers start only when provider is `manual` |
| `scripts/tatum-setup.ts`, `scripts/tatum-testnet-check.ts` | HMAC registration, live testnet verification |
| `.env.example`, `.env.production.example` | documented vars |

---

### Task 1: Schema, migration, and gateway repository (`@asm/db`)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Deposit model, new `GatewayAddressCounter`)
- Create: `packages/db/prisma/migrations/20261005120000_tatum_gateway/migration.sql`
- Create: `packages/db/src/repositories/gateway-deposit.ts`, `gateway-deposit.test.ts`
- Modify: `packages/db/src/repositories/deposit.ts` (`creditDepositToAccount`, `expireStaleUsdtDeposits`), `packages/db/src/index.ts`

**Interfaces (produces):**
```ts
export const GATEWAY_TATUM = "TATUM";
export const GATEWAY_USDT_DEPOSIT_TTL_MINUTES = 30;
export const GATEWAY_EXPIRE_GRACE_MS = 2 * 60 * 60 * 1000;
export const GATEWAY_WATCH_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;
allocateGatewayAddressIndex(network: string): Promise<number>          // 1, 2, 3 … per network
createGatewayUsdtDeposit(input: { userId; amountUsdtMinorRequested; network; tokenContract;
  receivingAddress; addressIndex; correlationId; ipAddress?; userAgent? }): Promise<Deposit>
setGatewaySubscriptionId(depositId: string, subscriptionId: string | null): Promise<void>
findGatewayDepositByAddress(network: string, address: string): Promise<Deposit | null>
listGatewayDepositsToWatch(now: Date): Promise<Deposit[]>
listGatewayDepositsToExpire(now: Date): Promise<Deposit[]>   // AWAITING_PAYMENT & expiresAt < now − grace
expireGatewayDeposit(id: string): Promise<boolean>
markChainCreditsFinalForTx(input: { network; tokenContract; txHash }): Promise<number>
listDetectedGatewayCredits(limit: number): Promise<ChainCredit[]>
matchGatewayChainCredit(chainCreditId: string): Promise<GatewayMatchOutcome>
type GatewayMatchOutcome =
  | { kind: "credited"; depositId: string; creditedUsdtMinor: number }
  | { kind: "manual_review"; reason: "ADDRESS_ALREADY_USED"|"EXPIRED_DEPOSIT"|"WRONG_TOKEN_CONTRACT"|"UNDERPAID"|"PRECISION_NOT_REPRESENTABLE"; depositId: string | null }
  | { kind: "unmatched" } | { kind: "skipped"; reason: "not_final" | "already_processed" };
creditDepositToAccount({ …, receivedUsdtMinor?: number })   // USDT only, non-admin, rewrites amounts
```

- [ ] Step 1: Write `gateway-deposit.test.ts`, covering:
  - indexes are unique and ≥ 1;
  - two live $50 gateway deposits coexist;
  - each row of the matcher table (spec § Match);
  - an overpay credits the received amount (balance + Transaction amount);
  - a second payment to a completed address goes to `ADDRESS_ALREADY_USED`.
- [ ] Step 2: Run `pnpm --filter @asm/db exec vitest run src/repositories/gateway-deposit.test.ts`. Expect FAIL (module missing).
- [ ] Step 3: Schema + migration:
  - SQL adds `gateway`, `gatewayAddressIndex`, `gatewaySubscriptionId`;
  - SQL adds a unique index on `(gateway, network, gatewayAddressIndex)`;
  - SQL creates the `GatewayAddressCounter` table;
  - drop and recreate both live-amount partial indexes with `AND "gateway" IS NULL`.
- [ ] Step 4: Run `pnpm --filter @asm/db exec prisma migrate deploy && pnpm --filter @asm/db generate`.
- [ ] Step 5: Implement `gateway-deposit.ts` and the `receivedUsdtMinor` option. In
  `expireStaleUsdtDeposits`, add `gateway: null` to the WHERE clause.
- [ ] Step 6: Re-run the test (expect PASS). Also run the existing `chain-credit-matcher.test.ts` and `deposit.test.ts` (expect PASS, no regressions).
- [ ] Step 7: Commit `feat(db): gateway deposit columns, address counter, address-based matcher`.

### Task 2: `@asm/tatum` package — config, http, adapters, webhook

**Files:** `packages/tatum/{package.json,tsconfig.json,vitest.config.ts}`, `src/{config,http,tron,bsc,subscriptions,webhook,index}.ts` and tests.

**Interfaces (produces):**
```ts
type GatewayNetwork = "tron" | "bsc";
interface TatumNetworkConfig { network; apiKey; testnet: boolean; xpub; tokenContract; tokenDecimals: number;
  webhookUrl: string | null; hmacSecret: string | null }
readTatumConfig(network, env = process.env): TatumNetworkConfig | null
isTatumProvider(env = process.env): boolean
listTatumEnabledNetworks(env = process.env): GatewayNetwork[]
class TatumError extends Error { status: number | null }
interface GatewayChain { network; tokenContract; tokenDecimals;
  deriveAddress(index): Promise<string>; listIncomingTxHashes(address, sinceMs): Promise<string[]>;
  verifyTransfer(txHash, toAddress): Promise<VerifiedTx> }
createGatewayChain(cfg: TatumNetworkConfig, fetchImpl = fetch): GatewayChain
createIncomingTokenSubscription(cfg, address, fetchImpl?): Promise<string>
deleteSubscription(cfg, id, fetchImpl?): Promise<void>
enableWebhookHmac(cfg, fetchImpl?): Promise<void>
verifyTatumSignature(rawBody: string, header: string | null, secret: string): boolean
parseTatumWebhook(body: unknown): { address: string; txId: string; chain: string; network: GatewayNetwork | null } | null
```

- [ ] Step 1: Tests:
  - `config.test.ts`: complete, missing and mismatched key/network cases.
  - `webhook.test.ts`: Tatum's documented example — secret `c354b83b-d31b-4dda-9bab-d6a67715a1ed`, its body and hash `WdhYQft+…xA==` must verify; a tampered body must fail.
  - `tron.test.ts`: a fixture of the real Shasta tx `15b3458c…0679`. It decodes 1 transfer of 1 000 000 000 raw to `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`, and finality flips at 20 confirmations.
  - `bsc.test.ts`: a receipt fixture with two Transfer logs (one to us, one elsewhere) decodes 1; status 0 → failed; a null receipt → not_found; the lookback cap is 9 900.
- [ ] Step 2: Run `pnpm --filter @asm/tatum test`. Expect FAIL.
- [ ] Step 3: Implement the modules.
- [ ] Step 4: Run `pnpm --filter @asm/tatum test`. Expect PASS.
- [ ] Step 5: Commit `feat(tatum): Tatum gateway package — adapters, alerts, webhook verification`.

### Task 3: Processor

**Files:** `packages/tatum/src/processor.ts`, `processor.test.ts` (against the real DB with a fake `GatewayChain`).

**Interfaces (produces):**
```ts
recordAndSettleTransfer(chain: GatewayChain, input: { txHash: string; toAddress: string }, log?): Promise<{ recorded: number; settled: GatewayMatchOutcome[] }>
scanGatewayDeposit(chain: GatewayChain, deposit: Deposit, log?): Promise<void>
recheckDetectedCredits(chains: Map<GatewayNetwork, GatewayChain>, log?): Promise<void>
```

- [ ] Step 1: Tests with a fake chain:
  - a non-final tx records a DETECTED row and credits nothing;
  - when the same tx later turns final, the row goes FINAL and is credited;
  - a failed tx records nothing;
  - running twice is idempotent (one credit).
- [ ] Step 2: Run the tests. Expect FAIL.
- [ ] Step 3: Implement. On completion, delete the deposit's alert (best-effort).
- [ ] Step 4: Run the tests. Expect PASS.
- [ ] Step 5: Commit.

### Task 4: Web — deposit creation, webhook, status, checkout

**Files:** `apps/web/package.json` (dep `@asm/tatum`), `src/lib/usdt-networks.ts`, `src/app/api/deposits/route.ts` (+ test cases), `src/app/api/webhooks/tatum/route.ts` (+ test), `src/app/api/deposits/[id]/status/route.ts`, `src/app/checkout/[token]/page.tsx`, `src/app/(platform)/deposit/page.tsx` if it reads the enabled list.

- [ ] Step 1: Tests:
  - With provider tatum and `globalThis.fetch` mocked for Tatum derive, `POST /api/deposits` returns 201. The deposit has `gateway TATUM`, the derived address and the exact requested amount.
  - A webhook without a signature returns 401. A webhook with a valid signature for an unknown address returns 200.
- [ ] Step 2: Run `pnpm --filter @asm/web exec vitest run src/app/api/deposits/route.test.ts src/app/api/webhooks`. Expect FAIL.
- [ ] Step 3: Implement:
  - `getUsdtNetworkConfig`/`listEnabledUsdtNetworks` branch on the provider;
  - the route branches to the gateway path;
  - add the webhook route;
  - the status route uses the address for gateway deposits;
  - checkout shows "Send at least" and hides the claim link when `deposit.gateway`.
- [ ] Step 4: Run the tests (expect PASS), then `pnpm --filter @asm/web exec tsc --noEmit`.
- [ ] Step 5: Commit.

### Task 5: Engine runner + provider switch

**Files:** `apps/engine/package.json`, `src/tatum-runner.ts`, `src/main.ts`.

- [ ] Step 1: `startTatumRunner()` is idle unless the provider is tatum and ≥ 1 network is enabled. Each tick does three things:
  - `scanGatewayDeposit` for each watched deposit;
  - `recheckDetectedCredits`;
  - expire overdue deposits and delete their alerts.

  An adaptive idle interval matches the existing watch loop.
- [ ] Step 2: In `main.ts`, start the TRON/BSC manual watchers only when the provider is `manual`, and start the Tatum runner otherwise. Stop it on shutdown.
- [ ] Step 3: Run `pnpm --filter @asm/engine exec tsc --noEmit` and `pnpm --filter @asm/engine test`.
- [ ] Step 4: Commit.

### Task 6: Scripts, env docs, live testnet verification

- [ ] Step 1: `scripts/tatum-setup.ts` registers the HMAC secret (`PUT /v4/subscription`).
- [ ] Step 2: `scripts/tatum-testnet-check.ts` does the following:
  - derive indexes 1–3 per network via the adapter and print them;
  - create and delete an alert;
  - verify a known Shasta USDT tx and a known BSC-testnet USDT tx;
  - list incoming transfers for a derived address (expect empty);
  - POST a signed webhook to `http://localhost:3000/api/webhooks/tatum` if it's reachable.
- [ ] Step 3: Document every `TATUM_*` var in `.env.example` and `.env.production.example`. Put the testnet values in the local `.env` (never committed).
- [ ] Step 4: Run the check script, full test suites and type checks. Record the results.
- [ ] Step 5: Commit.
