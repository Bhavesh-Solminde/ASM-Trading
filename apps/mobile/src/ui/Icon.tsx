import { Circle, Path, Svg } from "react-native-svg";
import { color as palette } from "@/theme/tokens";
import { GLYPHS, type IconName } from "./icon-glyphs";

export type { IconName };

export function Icon({
  name,
  size = 22,
  color = palette.ink,
  strokeWidth = 1.75,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Solid shape instead of an outline (the starred state of `star`). */
  filled?: boolean;
}) {
  const g = GLYPHS[name];
  return (
    <Svg
      // Decorative: the control around an icon carries the label.
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : "none"}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {g.circles?.map((c) => (
        <Circle key={`${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy} r={c.r} fill={c.fill || filled ? color : "none"} />
      ))}
      {g.paths.map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
