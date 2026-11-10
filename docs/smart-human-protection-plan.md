# Protecting the simulator against smart traders

The achievable objective is to prevent exploitation and keep accepted obligations
funded. A legitimate profitable trader is not an exploit. No plan can guarantee
that every human loses while preserving matched prices, fixed 92% profit payouts,
normal expiry/SLTP settlement and payable withdrawals.

## Already implemented and tested in the isolated paper lab

1. **Funded accounts.** Every new account starts at zero. Deposits debit a finite
   person-level outside bankroll. The chart demo's free seed balance is not a
   withdrawable funding source.
2. **Persistent person-level accounting.** Account closure/recreation retains
   linked identity limits and all past profits/losses. A winner may withdraw
   immediately. Re-entering requires another funded deposit, not fresh free money.
3. **Exact-once transactions.** Funding references are unique across accounts;
   order and withdrawal retries return their original receipt without another
   debit or credit. Different concurrent withdrawal requests cannot overdraw.
4. **Caller ownership.** Trusted scenario identity must own the account before
   placing, funding, withdrawing, closing or replaying a command. Client fields
   cannot choose identity, entry price or payout.
5. **Worst-case reserves before acceptance.** Available client balances plus the
   full possible 192% credit of every open trade must remain covered by bank cash.
   Opposite positions are not netted when different brackets/expiries can make
   both win on different paths. Withdrawing already available money leaves the
   free reserve unchanged.
6. **Preannounced exposure limits.** Per-order, per-person open stake, open-count,
   linked-account and rolling-stake limits apply equally to winners and losers.
   New trades are declined before acceptance if limits or reserves fail.
7. **Fresh quotes and normal settlement.** Client quotes must match the current
   execution sequence. Accepted outcomes and credited balances are never rewritten.

These are local, in-memory controls. Identity links and caller context are supplied
by the test scenario; real authentication, identity verification, payments and
durability are not implemented.

## Next protection work, without changing accepted trade outcomes

1. **One master risk budget across markets.** Count correlated positions and all
   pending payouts against one actual capital pool. The same capital cannot back
   separate market ledgers independently.
2. **Drawdown circuit breaker for new orders.** Define a paper capital floor and
   reserve buffer in advance. Reduce maximum new stake or pause new acceptance
   when that buffer is reached. Continue normal settlement and eligible withdrawals.
3. **Test predictable strategy leaks.** Run causal, out-of-sample agents that use
   momentum, reversal, book imbalance, public bot behavior, hedges, staggered
   expiries and latency. If a bot rule creates a reliable public trading edge,
   revise the market model and retest; do not falsify individual outcomes.
4. **Separate identity abuse from skill.** Real account linkage needs a verified,
   legitimate identity/authentication process. A different account name or IP
   address is not proof of a different person, and an unknown identity cannot
   simply be declared linked. Reserve limits remain necessary when linkage fails.
5. **Durable financial processing before any live integration.** Persist ledger
   entries, idempotency keys, reserved liabilities and settlement evidence through
   crashes; reconcile external payment confirmations and withdrawal receipts.
6. **Release gates.** No negative reserves; all accepted winning credits payable;
   no duplicate money movement; no cross-account actions; no future-data access;
   and independently reconciled cashflows. Report profitable human cases and
   losses to the simulator rather than hiding them.

## Economic limit

With equal stakes and a 50% chance of winning, the fixed 92% profit payout yields
an expected return of 0.5 × 1.92 = 0.96 per unit staked: a 4% expected house margin
before costs. This is not guaranteed per trade, per trader or per batch. A skillful
trader can beat that assumption. A first-trade winner can cash out and leave with
profit; the system must already have reserved the money to pay them.

If the requirement is "no human may ever profit," it conflicts with the agreed
winning payout. The plan therefore controls downside and exploitation, without
claiming an unbeatable simulator.

## Evidence

- 210 actual-market smart-human runs: seven profiles, five group sizes, three
  seeds and response on/off; 33,381 trades and 12,990 immediate winning cashouts.
- Seven response-on portfolios and 42 portfolios across both modes were profitable
  for humans. Those valid profits were paid.
- 18 guard checks cover first-win withdrawal, account cycling, funding replay,
  concurrent cashout, committed stake, caller ownership, stale quotes, client-field
  spoofing, linked limits, martingale size, reserve exhaustion and conservation.
- A separate 100-human case with ₹1,000 initial house capital declined 234 new
  trades before acceptance while paying 200 winning cashouts. No withdrawal was
  rejected; its minimum free reserve was ₹10.40.
- Independent Python replay reconciles the cash ledger and every recorded causal
  decision. The report is at http://127.0.0.1:4180/reports/smart-humans/.
