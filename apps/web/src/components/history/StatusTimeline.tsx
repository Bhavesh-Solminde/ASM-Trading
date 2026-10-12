import { Icon } from "@/components/shell/Icon";
import { shortDate, timeOfDay } from "./history-model";
import { timelineSteps, type StepState, type TimelineKind, type TimelineStep } from "./timeline-model";

/**
 * Vertical progress tracker for a deposit or withdrawal. Presentational and
 * hook-free so it can sit in a server or a client component.
 *
 *   <StatusTimeline kind="withdrawal" status="HELD" createdAt="2026-10-12T05:12:00Z" />
 *
 * Only times we actually hold are shown: the request time on the first step
 * and, for deposits (which carry `updatedAt`), the time of the latest change
 * on the step it reached. Withdrawals have no change timestamp, so later steps
 * show a state word instead of an invented time.
 *
 * Times render in the viewer's local zone, so they can differ between a server
 * render and hydration; the spans suppress that warning.
 */

export interface StatusTimelineProps {
  kind: TimelineKind;
  /** Raw DepositStatus / WithdrawalStatus value. */
  status: string;
  /** ISO timestamp (or Date) the request was created. */
  createdAt: string | Date;
  /** ISO timestamp (or Date) of the last status change, when known. */
  updatedAt?: string | Date | null;
  /** Override "now" (tests, stories). */
  now?: Date;
  /** Surface colour; defaults to the panel. Use `bg-tile` when sitting on a panel. */
  className?: string;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "10:42" for today, "Oct 10 · 10:42" otherwise. */
export function stepTimeLabel(d: Date, now: Date): string {
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? timeOfDay(d) : `${shortDate(d, now)} · ${timeOfDay(d)}`;
}

const STATE_WORD: Record<StepState, string> = {
  done: "Completed",
  current: "In progress",
  todo: "Not reached yet",
  ended: "Ended",
};

function Node({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="grid size-6 place-items-center rounded-full bg-up text-up-ink">
        <Icon name="check" className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="grid size-6 place-items-center rounded-full bg-caution/15 shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-caution)_8%,transparent)]">
        <span className="size-2.5 rounded-full bg-caution" />
      </span>
    );
  }
  if (state === "ended") {
    return (
      <span className="grid size-6 place-items-center rounded-full bg-down text-white">
        <Icon name="close" className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  return <span className="size-6 rounded-full border-2 border-tile-hi" />;
}

function Step({
  step,
  last,
  nextReached,
  time,
}: {
  step: TimelineStep;
  last: boolean;
  nextReached: boolean;
  time: string | null;
}) {
  const muted = step.state === "todo";
  const lineLit = step.state === "done" && nextReached;
  return (
    <li className={`grid grid-cols-[28px_minmax(0,1fr)_auto] gap-x-3 ${last ? "min-h-[52px]" : "min-h-16"}`}>
      <span className="flex flex-col items-center">
        <Node state={step.state} />
        {last ? null : (
          <span
            aria-hidden
            className={`mt-1 w-0.5 flex-1 rounded-full ${lineLit ? "bg-up" : "bg-tile-hi"}`}
          />
        )}
      </span>
      <span className="grid content-start gap-0.5 pb-3">
        <b className={`text-[15px] font-bold ${muted ? "text-ink-2" : step.state === "ended" ? "text-down" : "text-ink"}`}>
          {step.title}
          <span className="sr-only"> — {STATE_WORD[step.state]}</span>
        </b>
        <span className={`text-xs leading-snug ${muted ? "text-ink-3" : "text-ink-2"}`}>{step.detail}</span>
      </span>
      <span
        suppressHydrationWarning
        className={`pt-0.5 text-xs tabular-nums ${step.state === "current" ? "font-semibold text-caution" : "text-ink-2"}`}
      >
        {step.state === "current" && !time ? "Now" : time}
      </span>
    </li>
  );
}

export function StatusTimeline({ kind, status, createdAt, updatedAt, now, className = "bg-panel" }: StatusTimelineProps) {
  const steps = timelineSteps(kind, status);
  const clock = now ?? new Date();
  const created = toDate(createdAt);
  const changed = toDate(updatedAt);

  // The step the latest change belongs to: the last one reached (current, done or ended).
  let latest = 0;
  steps.forEach((s, i) => {
    if (s.state !== "todo") latest = i;
  });

  return (
    <ol className={`rounded-2xl px-4 pb-1 pt-4 ${className}`} aria-label={`${kind === "deposit" ? "Deposit" : "Withdrawal"} progress`}>
      {steps.map((step, i) => {
        let time: string | null = null;
        if (i === 0 && created) time = stepTimeLabel(created, clock);
        else if (i === latest && step.state !== "todo" && changed) time = stepTimeLabel(changed, clock);
        return (
          <Step
            key={step.id}
            step={step}
            last={i === steps.length - 1}
            nextReached={i < steps.length - 1 && steps[i + 1]!.state !== "todo"}
            time={time}
          />
        );
      })}
    </ol>
  );
}
