/**
 * The steps a deposit or withdrawal moves through, derived from its raw status.
 * Pure so the mapping is unit-tested; <StatusTimeline> only paints it.
 *
 *   withdrawal  REQUESTED / HELD   -> Requested ✓, In review (now)
 *               APPROVED           -> Requested ✓, In review ✓, Approved (now), Paid
 *               PAID               -> all four ✓
 *               REJECTED           -> Requested ✓, In review ✓, Rejected (ended)
 *               CANCELLED_BY_USER  -> Requested ✓, Cancelled (ended)
 *
 *   deposit     AWAITING_PAYMENT      -> Started (now), Payment submitted, Credited
 *               PENDING_CONFIRMATION  -> Started ✓, Payment submitted (now), Credited
 *               COMPLETED             -> all three ✓
 *               REJECTED              -> Started ✓, Payment submitted ✓, Rejected (ended)
 *               EXPIRED               -> Started ✓, Expired (ended)
 */

export type TimelineKind = "deposit" | "withdrawal";
/** done = reached; current = in progress; todo = not yet; ended = terminal bad outcome (red). */
export type StepState = "done" | "current" | "todo" | "ended";

export interface TimelineStep {
  id: string;
  title: string;
  detail: string;
  state: StepState;
}

interface Def {
  id: string;
  title: string;
  /** Shown while the step is still ahead, or in progress. */
  detail: string;
  /** Shown once the step is done (defaults to `detail`). */
  doneDetail?: string;
}

const WITHDRAWAL_STEPS: Def[] = [
  { id: "requested", title: "Requested", detail: "Balance reserved for this payout" },
  {
    id: "review",
    title: "In review",
    detail: "We check the payout details against your verified name",
  },
  { id: "approved", title: "Approved", detail: "Queued for payment" },
  {
    id: "paid",
    title: "Paid",
    detail: "Usually within 5–10 hours of review",
    doneDetail: "Sent to your payout details",
  },
];

const DEPOSIT_STEPS: Def[] = [
  { id: "started", title: "Started", detail: "Waiting for your payment" , doneDetail: "Payment request created" },
  {
    id: "submitted",
    title: "Payment submitted",
    detail: "We confirm it as soon as the money reaches us",
    doneDetail: "We received your payment details",
  },
  { id: "credited", title: "Credited", detail: "Funds appear in your balance", doneDetail: "Added to your balance" },
];

function build(defs: Def[], reached: number, currentIdx: number | null, ended?: Def): TimelineStep[] {
  const steps: TimelineStep[] = [];
  defs.forEach((d, i) => {
    if (i >= reached && !(currentIdx !== null && i === currentIdx)) {
      // Past a terminal outcome the remaining steps never happen.
      if (ended) return;
      steps.push({ id: d.id, title: d.title, detail: d.detail, state: "todo" });
      return;
    }
    const state: StepState = currentIdx === i ? "current" : "done";
    steps.push({ id: d.id, title: d.title, detail: state === "done" ? (d.doneDetail ?? d.detail) : d.detail, state });
  });
  if (ended) steps.push({ id: ended.id, title: ended.title, detail: ended.detail, state: "ended" });
  return steps;
}

const REJECTED: Def = { id: "rejected", title: "Rejected", detail: "This request was not approved" };

export function timelineSteps(kind: TimelineKind, status: string): TimelineStep[] {
  if (kind === "withdrawal") {
    switch (status) {
      case "REQUESTED":
      case "HELD":
        return build(WITHDRAWAL_STEPS, 1, 1);
      case "APPROVED":
        return build(WITHDRAWAL_STEPS, 2, 2);
      case "PAID":
        return build(WITHDRAWAL_STEPS, 4, null);
      case "REJECTED":
        return build(WITHDRAWAL_STEPS, 2, null, {
          ...REJECTED,
          detail: "Not approved — the amount was returned to your balance",
        });
      case "CANCELLED_BY_USER":
        return build(WITHDRAWAL_STEPS, 1, null, {
          id: "cancelled",
          title: "Cancelled",
          detail: "You cancelled — the full amount was returned to your balance",
        });
      default:
        return build(WITHDRAWAL_STEPS, 1, 1);
    }
  }
  switch (status) {
    case "AWAITING_PAYMENT":
      return build(DEPOSIT_STEPS, 0, 0);
    case "PENDING_CONFIRMATION":
      return build(DEPOSIT_STEPS, 1, 1);
    case "COMPLETED":
      return build(DEPOSIT_STEPS, 3, null);
    case "REJECTED":
      return build(DEPOSIT_STEPS, 2, null, { ...REJECTED, detail: "We could not match this payment" });
    case "EXPIRED":
      return build(DEPOSIT_STEPS, 1, null, {
        id: "expired",
        title: "Expired",
        detail: "The payment window closed before we received it",
      });
    default:
      return build(DEPOSIT_STEPS, 0, 0);
  }
}

/** Index of the last step that has been reached (anything but "todo"). */
export function latestReachedIndex(steps: readonly TimelineStep[]): number {
  let idx = 0;
  steps.forEach((s, i) => {
    if (s.state !== "todo") idx = i;
  });
  return idx;
}
