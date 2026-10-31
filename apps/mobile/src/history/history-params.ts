import { parsePaymentKey } from "@asm/contracts";

export type HistorySegment = "trades" | "payments";
export type PaymentsFilter = "all" | "deposits" | "withdrawals";

/** What a link to History asks for. A null field is "no opinion": the screen leaves that choice as it is. */
export interface HistoryParams {
  segment: HistorySegment | null;
  /** The Payments filter; set only together with the Payments segment. */
  filter: PaymentsFilter | null;
  /** A payment (`d:<id>` | `w:<id>`) whose detail sheet should open. */
  txKey: string | null;
}

type Raw = string | string[] | undefined;
const first = (v: Raw): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Reads `/history?filter=payments|deposits|withdrawals|trades&tx=d:<id>|w:<id>` (the P4 link contract). `payments`,
 * `deposits` and `withdrawals` select the Payments segment (the last two also filter it), `trades` selects Trade, and a
 * valid `tx` selects Payments and names the sheet to open (it wins over `filter=trades`). Anything unrecognised is ignored.
 */
export function historyParams(raw: { tx?: Raw; filter?: Raw }): HistoryParams {
  const filterParam = first(raw.filter);
  const tx = first(raw.tx);
  const txKey = parsePaymentKey(tx) ? (tx as string) : null;

  let segment: HistorySegment | null = null;
  let filter: PaymentsFilter | null = null;
  if (filterParam === "payments") {
    segment = "payments";
    filter = "all";
  } else if (filterParam === "deposits" || filterParam === "withdrawals") {
    segment = "payments";
    filter = filterParam;
  } else if (filterParam === "trades") {
    segment = "trades";
  }
  if (txKey) segment = "payments";
  return { segment, filter, txKey };
}
