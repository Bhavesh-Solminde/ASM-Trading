import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/shell/Icon";

/**
 * Grouped settings list, iOS style: a rounded card of rows (>= 56px tall) with
 * a leading icon, label, optional right-hand value and a chevron. Dividers are
 * inset to the label so the icon column reads as a gutter.
 */

export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      {title ? <h2 className="px-1 text-[13px] font-semibold text-ink-2">{title}</h2> : null}
      <ul className="overflow-hidden rounded-2xl bg-panel">{children}</ul>
    </section>
  );
}

const ROW =
  "relative flex min-h-14 w-full items-center gap-3 px-4 text-left text-[15px] text-ink hover:bg-tile/50 focus-visible:bg-tile/50 " +
  "[li:not(:first-child)>&]:before:absolute [li:not(:first-child)>&]:before:left-12 [li:not(:first-child)>&]:before:right-0 " +
  "[li:not(:first-child)>&]:before:top-0 [li:not(:first-child)>&]:before:h-px [li:not(:first-child)>&]:before:bg-rule";

function Inner({
  icon,
  label,
  value,
  valueClass = "text-ink-2",
  chevron = true,
}: {
  icon: IconName;
  label: string;
  value?: ReactNode;
  valueClass?: string;
  chevron?: boolean;
}) {
  return (
    <>
      <Icon name={icon} className="size-5 text-ink-2" strokeWidth={2} />
      <span className="min-w-0 truncate">{label}</span>
      {value ? <span className={`ml-auto shrink-0 pl-2 text-[13px] tabular-nums ${valueClass}`}>{value}</span> : null}
      {chevron ? (
        <Icon name="chevron" className={`size-4 text-ink-3 ${value ? "" : "ml-auto"}`} strokeWidth={2.2} />
      ) : null}
    </>
  );
}

export function LinkRow(props: { href: string; icon: IconName; label: string; value?: ReactNode; valueClass?: string }) {
  const { href, ...rest } = props;
  return (
    <li>
      <Link href={href} className={ROW}>
        <Inner {...rest} />
      </Link>
    </li>
  );
}

/** A switch row. Uses a real checkbox so it is keyboard and screen-reader native. */
export function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: IconName;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <li>
      <label className={`${ROW} cursor-pointer`}>
        <Icon name={icon} className="size-5 text-ink-2" strokeWidth={2} />
        <span className="min-w-0 truncate">{label}</span>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="relative ml-auto h-7 w-12 shrink-0 rounded-full bg-tile-hi transition-colors peer-checked:bg-brand-fill peer-focus-visible:ring-2 peer-focus-visible:ring-brand motion-reduce:transition-none
            after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:after:translate-x-5 motion-reduce:after:transition-none"
        />
      </label>
    </li>
  );
}

export function ButtonRow({
  icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${ROW} disabled:cursor-not-allowed disabled:opacity-60 ${tone === "danger" ? "font-semibold !text-down" : ""}`}
      >
        <Icon name={icon} className={`size-5 ${tone === "danger" ? "text-down" : "text-ink-2"}`} strokeWidth={2} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
    </li>
  );
}
