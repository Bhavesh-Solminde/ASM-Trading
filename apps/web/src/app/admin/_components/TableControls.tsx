"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../_lib/icons";

export type FilterDef = {
  param: string;
  label: string;
  options: { value: string; label: string }[];
};

/**
 * Search + filter bar that drives table state entirely through the URL query
 * string, so the page re-renders on the server with fresh filters. Typing is
 * debounced; changing a filter resets pagination to page 1.
 */
export function TableControls({
  searchKey = "q",
  placeholder = "Search…",
  filters = [],
}: {
  searchKey?: string;
  placeholder?: string;
  filters?: FilterDef[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get(searchKey) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // keep local input in sync if the URL changes elsewhere (e.g. back button)
  useEffect(() => {
    setQ(params.get(searchKey) ?? "");
  }, [params, searchKey]);

  const push = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  function onSearch(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ [searchKey]: value.trim() }), 250);
  }

  return (
    <>
      <div className="admin-search">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
      </div>
      {filters.map((f) => (
        <select
          key={f.param}
          className="admin-filter-select"
          aria-label={f.label}
          value={params.get(f.param) ?? "all"}
          onChange={(e) => push({ [f.param]: e.target.value === "all" ? "" : e.target.value })}
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
    </>
  );
}
