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
  // The button keeps ids unique when two panels in one row use the same field (Reject / Approve).
  const id = `${button.replace(/\W+/g, "")}-${field}-${Object.values(hidden).join("-")}`;
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

const UNIT_LABEL: Record<string, string> = { inr: "₹", bps: "%", pct: "%", count: "count" };

/** In-row editor for one program setting, opened like the reject panels (no client JS). */
export function SettingEditForm({
  action,
  settingKey,
  label,
  unit,
  current,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<void>;
  settingKey: string;
  label: string;
  unit: string;
  /** In-force value in the units the form takes, or "" if none. */
  current: string;
  cancelHref: string;
}) {
  const id = (f: string) => `set-${f}-${settingKey}`;
  return (
    <details className="admin-reject">
      <summary className="admin-btn admin-btn--sm admin-btn--ghost" aria-label={`Edit ${label}`}>
        Edit
      </summary>
      <form action={action} className="admin-reject__panel">
        <input type="hidden" name="key" value={settingKey} />
        <label className="admin-label" htmlFor={id("value")}>
          New value{unit === "bool" ? "" : ` (${UNIT_LABEL[unit] ?? unit})`}
        </label>
        {unit === "bool" ? (
          <select id={id("value")} name="value" className="admin-select" defaultValue={current || "1"}>
            <option value="1">On</option>
            <option value="0">Off</option>
          </select>
        ) : (
          <input
            id={id("value")}
            name="value"
            className="admin-input"
            required
            inputMode="decimal"
            defaultValue={current}
            autoComplete="off"
          />
        )}
        <label className="admin-label" htmlFor={id("from")}>
          Effective from (IST, empty = now)
        </label>
        <input id={id("from")} name="effectiveFrom" type="datetime-local" className="admin-input" />
        <label className="admin-label" htmlFor={id("reason")}>
          Reason
        </label>
        <input id={id("reason")} name="reason" className="admin-input" required maxLength={500} autoComplete="off" />
        <div className="admin-row-actions">
          <a href={cancelHref} className="admin-btn admin-btn--sm admin-btn--ghost">
            Cancel
          </a>
          <button type="submit" className="admin-btn admin-btn--sm admin-btn--primary">
            Save
          </button>
        </div>
      </form>
    </details>
  );
}
