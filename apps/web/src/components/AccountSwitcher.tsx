"use client";

import { useState } from "react";

export interface AccountView {
  id: string;
  type: "LIVE" | "DEMO";
  balance: string;
}

export function AccountSwitcher({ accounts }: { accounts: AccountView[] }) {
  const [activeId, setActiveId] = useState(
    accounts.find((a) => a.type === "LIVE")?.id ?? accounts[0]?.id ?? "",
  );
  const active = accounts.find((a) => a.id === activeId);

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
          {active?.type === "DEMO" ? "Demo account" : "Live account"}
        </p>
        <p className="text-lg font-semibold tabular-nums">{active?.balance}</p>
      </div>
      <div className="flex gap-2">
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setActiveId(a.id)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold ${
              a.id === activeId
                ? "border-[var(--color-brand)] bg-[var(--color-panel-2)]"
                : "border-[var(--color-edge)] bg-[var(--color-panel)] text-[var(--color-ink-2)]"
            }`}
          >
            {a.type === "DEMO" ? "Demo" : "Live"}
          </button>
        ))}
      </div>
    </div>
  );
}
