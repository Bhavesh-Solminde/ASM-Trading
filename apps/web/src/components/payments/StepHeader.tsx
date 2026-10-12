"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { Icon } from "@/components/shell/Icon";

/**
 * Header of a multi-step money flow: back, title, "Step N of 3 · Name" and a
 * three-segment progress bar. The step label is focusable (tabIndex -1) so the
 * flow can move focus there when the step changes, which announces the new
 * step to screen-reader users.
 *
 * On desktop the page's own h1 already says "Deposit"/"Withdrawal", so the
 * title here is phone-only; the back button and step label stay on both.
 */
export const StepHeader = forwardRef<
  HTMLParagraphElement,
  {
    title: string;
    step: 1 | 2 | 3;
    stepName: string;
    total?: number;
    /** Step > 1 goes back one step. */
    onBack?: (() => void) | undefined;
    /** Step 1 leaves the flow through a link instead. */
    backHref?: string | undefined;
    backLabel: string;
  }
>(function StepHeader({ title, step, stepName, total = 3, onBack, backHref, backLabel }, ref) {
  const BTN =
    "grid size-11 flex-none place-items-center rounded-xl text-ink hover:bg-tile phone:-ml-2";
  return (
    <div>
      <div className="flex items-center gap-2">
        {backHref && !onBack ? (
          <Link href={backHref} aria-label={backLabel} className={BTN}>
            <Icon name="back" className="size-[22px]" />
          </Link>
        ) : (
          <button type="button" aria-label={backLabel} onClick={onBack} className={BTN}>
            <Icon name="back" className="size-[22px]" />
          </button>
        )}
        <h2 className="hidden text-lg font-bold phone:block">{title}</h2>
        <p
          ref={ref}
          tabIndex={-1}
          className="ml-auto pr-2 text-[13px] text-ink-2 outline-none! phone:pr-1"
        >
          Step {step} of {total} <span aria-hidden>&middot;</span>
          <span className="sr-only">, </span> {stepName}
        </p>
      </div>
      <div aria-hidden className="mt-2.5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
              i < step ? "bg-brand" : "bg-tile-hi"
            }`}
          />
        ))}
      </div>
    </div>
  );
});
