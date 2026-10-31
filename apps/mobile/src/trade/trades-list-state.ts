/**
 * What the trades list shows. Rows that have arrived always show. With none, "No trades" is only true once the
 * full list is known; while it is still pending (History opened before Trade has fetched it) the list is loading.
 */
export function tradesListState(shownCount: number, listPending: boolean): "rows" | "loading" | "empty" {
  if (shownCount > 0) return "rows";
  return listPending ? "loading" : "empty";
}
