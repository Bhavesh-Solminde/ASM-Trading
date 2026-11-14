import { Pill } from "../../_components/ui";

/** 1250 → "12.5%". */
export function bpsPct(bps: number): string {
  return `${bps / 100}%`;
}

const AFFILIATE_STATUS: Record<string, { label: string; tone: "pos" | "warn" | "neg" | "muted" }> = {
  PENDING_VERIFICATION: { label: "Email unverified", tone: "muted" },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "warn" },
  ACTIVE: { label: "Active", tone: "pos" },
  SUSPENDED: { label: "Suspended", tone: "neg" },
};

export function AffiliateStatusPill({ status }: { status: string }) {
  const s = AFFILIATE_STATUS[status] ?? { label: status, tone: "muted" as const };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

/** An in-row action that needs a written reason / reference: the existing reject-panel pattern. */
export function ReasonForm({
  action,
  hidden,
  button,
  tone,
  field,
  label,
  submit,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  button: string;
  tone: "danger" | "pos" | "ghost";
  field: string;
  label: string;
  submit: string;
}) {
  const id = `${field}-${Object.values(hidden).join("-")}`;
  return (
    <details className="admin-reject">
      <summary className={`admin-btn admin-btn--sm admin-btn--${tone}`}>{button}</summary>
      <form action={action} className="admin-reject__panel">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="admin-label" htmlFor={id}>
          {label}
        </label>
        <input id={id} name={field} className="admin-input" required maxLength={500} autoComplete="off" />
        <button type="submit" className={`admin-btn admin-btn--sm admin-btn--${tone === "ghost" ? "primary" : tone}`}>
          {submit}
        </button>
      </form>
    </details>
  );
}
