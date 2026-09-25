# Skill Observation Log

Observations captured during task-oriented work.

**Status key:** OPEN = not yet actioned | ACTIONED (YYYY-MM-DD) = skill
updated/created | DECLINED (YYYY-MM-DD) = user decided not to pursue —
resolved statuses always carry their resolution date

---

### Observation 1: Reconcile "subagent-driven" with opus-token-optimization on many-small-task frontend plans

**Status:** OPEN
**Date:** 2026-09-21
**Session context:** Executing a 8-task frontend plan (Quotex-parity UI fixes) where the user requested BOTH subagent-driven-development AND opus-token-optimization.
**Skill:** subagent-driven-development / opus-token-optimization (interaction)
**Type:** open-source
**Phase/Area:** Model selection / dispatch gate

**Issue:** subagent-driven-development says "fresh subagent per task" while opus-token-optimization says don't delegate small/coupled/context-held tasks. For a plan of many small, tightly-coupled CSS/UI edits in files the controller already holds, per-task dispatch ceremony (task-brief + review-package + reviewer subagent) can cost far more than the edits. The two skills give no explicit reconciliation rule.

**Suggested improvement:** subagent-driven-development could add a note: when opus-token-optimization is also in play, the gate decides which tasks get a subagent; trivial/coupled tasks may be done directly by the controller and batched into the final whole-branch review instead of per-task reviewer dispatches.

**Principle:** When two process skills co-apply, one should defer to the other's decision criterion rather than both being followed literally; ceremony must scale to task size, not task count.

### Observation 2: Surface data-availability tensions during planning, not execution

**Status:** OPEN
**Date:** 2026-09-21
**Session context:** Phase 2 planning; user chose to rank a leaderboard by LIVE accounts, but bots are DEMO-only and LIVE is env-gated, so the board is empty in practice.
**Skill:** brainstorming / writing-plans
**Type:** open-source
**Phase/Area:** Design decisions

**Issue:** A user decision (rank LIVE accounts) was internally consistent but conflicted with data availability (no LIVE traders/bots exist), which would produce an empty feature. This was caught by checking the data model, not by the question itself.

**Suggested improvement:** When a design question depends on existing data (who/what populates a ranking, list, or feed), verify the data source exists BEFORE presenting options, and annotate options with their real-world population ("sparse until X").

**Principle:** A design choice is only as good as the data that feeds it; validate the feed exists at decision time and flag emptiness in the option itself.

### Observation 3: Verify hard-to-reach UI states (real-time / business-gated) via a temporary state mock, then revert

**Status:** OPEN
**Date:** 2026-09-25
**Session context:** Client UI overhaul. The in-app preview browser could not open the app's engine WebSocket (localhost ws blocked in the pane), so the settle "result popup" never fired from real data; separately, the withdrawal success screen was gated behind a "must have deposited with this method" business rule the test user didn't satisfy.
**Skill:** verification-before-completion / run (browser verification)
**Type:** open-source
**Phase/Area:** Visual verification of components behind unreachable triggers

**Issue:** Two user-visible components (a settlement popup driven by a live socket, and a post-withdrawal certificate screen) could not be reached through the normal flow in the preview environment. Waiting on the real trigger would have blocked verification indefinitely.

**Suggested improvement:** Codify a pattern: to screenshot a component behind an unreachable trigger, temporarily seed its controlling state (e.g. a component's initial useState) with representative data, capture evidence, then revert in the same session — and pair it with a unit test on the real wiring so behavior (not just appearance) is covered. Always state which parts were verified live vs. via mock.

**Principle:** When the real trigger is unreachable in the test environment, verify appearance with a temporary, reverted state mock and verify behavior with a unit test — and report the distinction honestly rather than implying end-to-end verification.

### Observation 4: Restart the dev server after regenerating ORM client or changing workspace-package exports — HMR won't

**Status:** OPEN
**Date:** 2026-09-25
**Session context:** Added a Prisma enum value (CURRENCY_CONVERT) + migration + new @asm/db exports, regenerated the client. Unit tests (fresh import) passed, but the running Next dev server 500'd with "Invalid value ... Expected TxKind" because it held the pre-generation Prisma client.
**Skill:** run / verification-before-completion
**Type:** open-source
**Phase/Area:** Dev-server lifecycle vs generated code

**Issue:** A passing unit suite alongside a failing live dev server is a stale-module signal: HMR reloads app source but not a regenerated ORM client or freshly changed workspace-package build graph. The 500 looked like a code bug but was a stale-process bug.

**Suggested improvement:** After `prisma generate` (or any codegen) and after changing a workspace package's exported surface, restart the dev server before browser verification; treat "tests green but server erroring on the new symbol" as "restart the server," not "the code is wrong."

**Principle:** Generated code and workspace-package export changes live outside the HMR graph; restart the long-running process before trusting live behavior.
