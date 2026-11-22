"use client";

import { useState } from "react";
import styles from "./center.module.css";

const PRESETS = [
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last month" },
  { value: "year", label: "Last year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

export function PeriodFields({ period, from, to, today }: { period: string; from: string; to: string; today: string }) {
  const [selected, setSelected] = useState(period);
  return (
    <>
      <label>
        Period
        <select name="period" className={styles.field} value={selected} onChange={(event) => setSelected(event.target.value)}>
          {PRESETS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {selected === "custom" ? (
        <>
          <label>From<input type="date" name="from" className={styles.field} defaultValue={from} max={today} required /></label>
          <label>To<input type="date" name="to" className={styles.field} defaultValue={to} max={today} required /></label>
        </>
      ) : null}
    </>
  );
}
