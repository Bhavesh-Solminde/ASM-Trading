"use client";

import { useState, type ReactNode } from "react";

/**
 * A form whose submit button stays disabled until a field changes, so an
 * operator can't "save" nothing and the audit log only records real edits.
 */
export function ChangeAwareForm({
  action,
  children,
  submitLabel = "Save changes",
  hint,
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  submitLabel?: string;
  hint?: ReactNode;
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <form action={action} onChange={() => setDirty(true)} onReset={() => setDirty(false)}>
      {children}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 14 }}>
        {hint ? <span className="admin-cell-sub" style={{ marginRight: "auto" }}>{hint}</span> : null}
        {dirty ? (
          <button type="reset" className="admin-btn admin-btn--sm admin-btn--ghost">
            Undo
          </button>
        ) : null}
        <button type="submit" className="admin-btn admin-btn--sm admin-btn--primary" disabled={!dirty}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
