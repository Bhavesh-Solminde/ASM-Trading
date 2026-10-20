import { View } from "react-native";
import { color } from "@/theme/tokens";
import { pinBoxState } from "./pin-box-state";

const BOXES = [0, 1, 2, 3] as const;

/**
 * One bank-form box per PIN digit (60×70). Filled = a dot; the next box = blue border + ring; `error` turns the
 * filled boxes red while a wrong-PIN message shows; `idle` = no active box (the lock-setup preview).
 * Pass `label` to expose "n of 4 digits entered" to TalkBack; without it the boxes are decorative.
 */
export function PinBoxes({ length, error = false, idle = false, label }: { length: number; error?: boolean; idle?: boolean; label?: string }) {
  return (
    <View
      accessible={label !== undefined}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? "no-hide-descendants" : "auto"}
      style={{ flexDirection: "row", gap: 12, justifyContent: "center" }}
    >
      {BOXES.map((i) => {
        const state = pinBoxState(i, length, { error, idle });
        const border = state === "active" ? color.accent : state === "error" ? color.downText : state === "filled" ? color.ink3 : color.rule;
        return (
          <View key={i} style={{ margin: -3, borderWidth: 3, borderRadius: 13, borderColor: state === "active" ? color.accentDim : "transparent" }}>
            <View
              style={{
                width: 60,
                height: 70,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: border,
                backgroundColor: color.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {state === "filled" || state === "error" ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color.ink }} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
