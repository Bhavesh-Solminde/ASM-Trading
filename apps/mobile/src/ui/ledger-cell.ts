import type { ViewStyle } from "react-native";

/** A passbook column: fixed `width`, or a `flex` share (default 1). */
export interface LedgerColumn {
  width?: number;
  flex?: number;
  align?: "left" | "right";
  /** "top" pins the cell to the row's top edge (the TIME column); the default centres it in the row. */
  valign?: "top" | "center";
}

export const ledgerCellStyle = (c: LedgerColumn): ViewStyle => ({
  ...(c.width !== undefined ? { width: c.width } : { flex: c.flex ?? 1, minWidth: 0 }),
  alignItems: c.align === "right" ? "flex-end" : "flex-start",
  ...(c.valign === "top" ? { alignSelf: "flex-start" as const } : null),
});
