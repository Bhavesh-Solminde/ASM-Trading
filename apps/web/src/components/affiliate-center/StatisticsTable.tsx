"use client";

import { useEffect, useReducer } from "react";
import styles from "./center.module.css";

const STORAGE_KEY = "asm:affiliate-statistics-columns:v1";

export interface StatisticColumn {
  id: string;
  label: string;
  numeric?: boolean;
}

export interface StatisticDisplayRow {
  key: string;
  title: string;
  cells: Record<string, string>;
}

function storedColumns(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveColumns(hidden: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // The picker still works while this page is open.
  }
}

function columnPreference(hidden: string[], action: string | string[]) {
  if (Array.isArray(action)) return action;
  return hidden.includes(action) ? hidden.filter((id) => id !== action) : [...hidden, action];
}

export function StatisticsTable({ heading, columns, rows, message }: {
  heading: string;
  columns: StatisticColumn[];
  rows: StatisticDisplayRow[];
  message: string;
}) {
  const [hidden, dispatch] = useReducer(columnPreference, []);
  useEffect(() => dispatch(storedColumns()), []);

  function toggleColumn(id: string) {
    saveColumns(columnPreference(hidden, id));
    dispatch(id);
  }

  const visible = columns.filter(({ id }) => !hidden.includes(id));
  return (
    <>
      <div className={styles.tableControls}>
        <p className={styles.rangeNote}>Amounts are shown in INR.</p>
        <details className={styles.columnPicker}>
          <summary className={styles.secondary}>Columns</summary>
          <fieldset aria-label="Visible columns">
            {columns.map(({ id, label }) => (
              <label key={id}>
                <input type="checkbox" checked={!hidden.includes(id)} onChange={() => toggleColumn(id)} />{label}
              </label>
            ))}
          </fieldset>
        </details>
      </div>
      <div className={styles.tableRegion} role="region" aria-label={`Statistics by ${heading.toLowerCase()}`} tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{heading}</th>
              {visible.map(({ id, label, numeric }) => <th key={id} scope="col" data-numeric={numeric || undefined}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, title, cells }) => (
              <tr key={key}>
                <th scope="row">{title}</th>
                {visible.map(({ id, numeric }) => <td key={id} data-numeric={numeric || undefined}>{cells[id] ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className={styles.empty}>{message}</p> : null}
    </>
  );
}
