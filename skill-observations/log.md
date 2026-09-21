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
