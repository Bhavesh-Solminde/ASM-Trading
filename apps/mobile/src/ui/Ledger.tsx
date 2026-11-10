import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { scriptFor } from "@/theme/font-families";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { ledgerCellStyle, type LedgerColumn } from "./ledger-cell";

export type { LedgerColumn };

/** Column captions (TIME, TRADE, RESULT). Hidden from TalkBack: every row carries its own label. */
export function LedgerHeader({ columns, labels }: { columns: LedgerColumn[]; labels: string[] }) {
  const { i18n } = useTranslation();
  const hindi = scriptFor(i18n.language) === "devanagari";
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ flexDirection: "row", columnGap: 10, borderBottomWidth: 1, borderBottomColor: color.rule }}
    >
      {columns.map((c, i) => (
        <View key={labels[i] ?? i} style={[ledgerCellStyle({ ...c, valign: undefined }), { paddingVertical: 8 }]}>
          <Txt font={hindi ? "ui" : "fig"} weight={500} size={10} tracking={0.06} color={color.ink3}>
            {(labels[i] ?? "").toUpperCase()}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** One passbook line. `cells` are placed in `columns` order. */
export function LedgerRow({
  columns,
  cells,
  accessibilityLabel,
  minHeight = 52,
}: {
  columns: LedgerColumn[];
  cells: ReactNode[];
  accessibilityLabel?: string;
  minHeight?: number;
}) {
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: "row", columnGap: 10, minHeight, paddingVertical: 10, alignItems: "center", borderBottomWidth: 1, borderBottomColor: color.ruleSoft }}
    >
      {columns.map((c, i) => (
        // Columns are fixed per table, so the index is a stable key.
        <View key={i} style={[ledgerCellStyle(c), { gap: 5 }]}>
          {cells[i]}
        </View>
      ))}
    </View>
  );
}
