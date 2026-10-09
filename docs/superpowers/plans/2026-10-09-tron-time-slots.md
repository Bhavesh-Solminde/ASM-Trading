# TRON time-slot deposits: plan

Owner decisions, 2026-10-09:

- TRON deposits go straight to the client's own wallets. There are no unique-cents amounts: the user's amount is used as-is.
- **Every deposit holds an exclusive 5-minute slot on one receiving address.** Two deposits never share an address at the same time, whether or not the user entered a wallet.
- **Several receiving addresses rotate.** A new deposit takes a free address. If all are busy, the user is told how long to wait, or to use BSC (recommended).
- **2-minute gap** after a slot ends unpaid before that address is handed out again.
- **Matching**, for a transfer whose block timestamp is inside the slot on that address:
  - It comes from the wallet the user entered: auto-credit the amount received (sanity bounds: > 0 and ≤ max deposit).
  - Otherwise, the amount received is within **±3 %** of the amount entered: auto-credit the amount received.
  - Otherwise: admin review. The deposit stays open, so TRON dust/poisoning spam can't consume it.
- The optional field is worded "For faster deposit confirmation, enter the wallet address you'll send from".
- The QR code stays a plain address.
- BSC is unchanged: per-deposit gateway addresses, preselected and "Recommended".

## Steps

1. **DB:** `Deposit.usdtMatch` ("SLOT") + `Deposit.senderAddress`. Slot rows are excluded from both live-amount unique indexes (migration `20261009180000_usdt_time_match`).
2. **DB:** `createUsdtSlotDepositIntent({ receivingAddresses[] … })`.
   - A per-network advisory lock serializes allocation.
   - The user's own open slot is closed and replaced.
   - Otherwise it picks the first address not held (not COMPLETED and `expiresAt + gap > now`), else throws `UsdtSlotBusy(retryAt)`.
3. **DB matcher:**
   - Slot path first: the deposit on `credit.toAddress` whose `[createdAt, expiresAt)` covers the block timestamp. Apply the sender / ±3 % rules above, else MANUAL_REVIEW (`SLOT_AMOUNT_MISMATCH`, `ABOVE_MAXIMUM`).
   - The legacy unique-amount path ignores slot rows.
   - The destination check accepts any configured address.
4. **Engine TRON watcher:**
   - `USDT_RECEIVING_ADDRESSES` (comma list; falls back to `USDT_RECEIVING_ADDRESS`).
   - Ingest per address (each address has its own cursor), match against the set, and treat activity on any address as work.
5. **Web:**
   - Config exposes the address list.
   - `POST /api/deposits` uses the slot intent for manual TRON, with an optional `senderAddress` (TRON format validated) and 409 + wait minutes when busy.
   - Contracts schema: optional `senderAddress`.
6. **UI:**
   - Amount step: wallet field (TRON only) and new copy (no unique cents, ±3 %).
   - Checkout copy.
   - Admin review reason texts.
7. **Tests:**
   - Slot allocation: rotation, busy, gap, replace-own, concurrency.
   - Matcher: sender, ±3 % edges, review, legacy untouched.
   - Route and schema tests.
8. **Wrap-up:** env examples, runbook note, PR #50 description, memory.

## Out of scope / owner actions

- Merging PR #50 and editing production `.env.production`. The agent is blocked from both. Before merging, set:
  - `USDT_BSC_PROVIDER=tatum`
  - `USDT_RECEIVING_ADDRESSES=TL5c…,<addr2>,<addr3>`
- Running mainnet sweeps (owner only).
