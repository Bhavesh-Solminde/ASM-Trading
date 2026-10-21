import type { ReactNode } from "react";
import { View } from "react-native";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";

export interface KeyValueRow {
  /** React key; defaults to the label. */
  key?: string;
  label: string;
  /** Text, or a node (a `StatusTag`, a copy button). */
  value: ReactNode;
  /** Text values only: `fig` sets an ASCII-only value (UTR, reference, tx hash) in Martian Mono. Never for ₹ or Hindi. */
  font?: "ui" | "fig";
  /** Text values only. */
  valueColor?: string;
  testID?: string;
}

/**
 * Label / value rows on a `surface` card. The label is a 14 `ink2` line that takes the room (`flex: 1`, so a Hindi
 * label wraps instead of squeezing the value); the value never shrinks, but is capped at 62% so a long value wraps
 * too. Rows are at least 28pt tall.
 */
export function KeyValueBox({ rows }: { rows: KeyValueRow[] }) {
  return (
    <View style={{ backgroundColor: color.surface, borderRadius: 14, padding: 16, gap: 4 }}>
      {rows.map((row) => (
        <View key={row.key ?? row.label} testID={row.testID} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 }}>
          <Txt size={14} color={color.ink2} style={{ flex: 1 }}>
            {row.label}
          </Txt>
          <View style={{ flexShrink: 0, maxWidth: "62%", alignItems: "flex-end" }}>
            {typeof row.value === "string" ? (
              <Txt size={14} weight={600} font={row.font} color={row.valueColor ?? color.ink} style={{ textAlign: "right" }}>
                {row.value}
              </Txt>
            ) : (
              row.value
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
