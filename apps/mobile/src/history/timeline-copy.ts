import type { StepState, TimelineKind, TimelineStep } from "@asm/client-core";

/** Steps whose wording changes once they are reached ("Waiting for your payment" becomes "Payment request created"). */
const HAS_DONE_WORDING = new Set(["started", "submitted", "credited", "paid"]);

/**
 * The i18n keys for one timeline step. The kind is part of the key because a deposit and a withdrawal both have a
 * "rejected" step with different words. A reached step with its own done wording uses `.done`, every other `.detail`.
 */
export function timelineCopy(kind: TimelineKind, step: Pick<TimelineStep, "id" | "state">): { titleKey: string; detailKey: string } {
  const base = `history.timeline.${kind}.${step.id}`;
  return { titleKey: `${base}.title`, detailKey: `${base}.${step.state === "done" && HAS_DONE_WORDING.has(step.id) ? "done" : "detail"}` };
}

/** How a step is drawn: its dot, and whether the connector above it (from the previous step) is drawn as reached. */
export function dotState(step: Pick<TimelineStep, "state">): { dot: StepState; connectorAboveReached: boolean } {
  return { dot: step.state, connectorAboveReached: step.state !== "todo" };
}
