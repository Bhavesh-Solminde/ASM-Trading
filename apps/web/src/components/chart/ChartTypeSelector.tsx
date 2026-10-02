"use client";

import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/shell/Icon";
import { useDismiss } from "@/lib/use-dismiss";
import { CHART_TYPES, type ChartType } from "./chart-types";

export function ChartTypeSelector({
  value,
  onChange,
  className = "",
}: {
  value: ChartType;
  onChange: (type: ChartType) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useDismiss(rootRef, open, close);

  const activeOption = CHART_TYPES.find((t) => t.id === value) ?? CHART_TYPES[0]!;

  return (
    <div ref={rootRef} className={`relative flex min-w-0 flex-none ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Chart style: ${activeOption.label}`}
        title={`Chart style: ${activeOption.label}`}
        onClick={() => setOpen((o) => !o)}
        className={`relative grid size-[34px] place-items-center rounded-[4px] border backdrop-blur transition-colors ${
          open
            ? "border-brand bg-brand/25 text-brand shadow-[0_0_8px_rgba(47,129,247,0.3)]"
            : "border-brand/50 bg-brand/15 text-brand hover:border-brand hover:bg-brand/25"
        }`}
      >
        <Icon name={activeOption.icon} className="size-5" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Select chart display"
          className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-[380px] w-[215px] overflow-y-auto overscroll-contain rounded-md border border-rule bg-panel/95 p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,.85)] backdrop-blur-md"
        >
          <div className="sticky top-0 z-10 bg-panel/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3 backdrop-blur-md">
            Chart Display
          </div>
          <div className="grid gap-0.5 mt-0.5">
            {CHART_TYPES.map((opt, index) => {
              const active = opt.id === value;
              const prev = CHART_TYPES[index - 1];
              const showDivider = prev && prev.category !== opt.category;

              return (
                <div key={opt.id}>
                  {showDivider ? <div className="my-1 border-t border-rule/50" /> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(opt.id);
                      setOpen(false);
                    }}
                    className={`grid w-full grid-cols-[20px_1fr_auto] items-center gap-2.5 rounded-[4px] px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "bg-brand/15 text-brand border border-brand/40 font-semibold"
                        : "text-ink hover:bg-tile hover:text-white border border-transparent"
                    }`}
                  >
                    <Icon
                      name={opt.icon}
                      className={`size-4 shrink-0 ${active ? "text-brand" : "text-ink-2"}`}
                    />
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold leading-tight">{opt.label}</span>
                      <span className="block text-[10px] text-ink-3 leading-tight truncate">
                        {opt.description}
                      </span>
                    </div>
                    {active ? (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-brand shadow-[0_0_6px_var(--color-brand,#2f81f7)]"
                      />
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
