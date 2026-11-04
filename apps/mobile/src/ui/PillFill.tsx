import { Rect, Svg } from "react-native-svg";
import { pillRadius } from "./pill-fill";

/**
 * A rounded fill that toggles with state (the active tab pill, the selected Demo/Live segment).
 *
 * Why not `backgroundColor` + `borderRadius` on the view: on Android (Fabric) a view that starts transparent
 * and later gains a background colour can lose its rounded corners (it draws as a square, sometimes with a faint
 * box behind). The fill is drawn by SVG instead, which does not depend on the view's background drawable, and
 * only the fill colour changes. Place it first inside a positioned parent of height `height`; later siblings draw on top.
 */
export function PillFill({ fill, height, radius = 999 }: { fill: string | null; height: number; radius?: number }) {
  const r = pillRadius(height, radius);
  return (
    <Svg
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      height={height}
      style={{ position: "absolute", left: 0, right: 0, top: 0 }}
    >
      <Rect x={0} y={0} width="100%" height={height} rx={r} ry={r} fill={fill ?? "none"} />
    </Svg>
  );
}
