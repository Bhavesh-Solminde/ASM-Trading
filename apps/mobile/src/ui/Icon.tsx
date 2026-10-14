import { Circle, Path, Svg } from "react-native-svg";
import { color as palette } from "@/theme/tokens";

export type IconName =
  | "trade"
  | "wallet"
  | "history"
  | "user"
  | "chevron"
  | "close"
  | "more"
  | "briefcase"
  | "star"
  | "search"
  | "lock"
  | "bolt";

/**
 * 24x24 outline paths. trade, wallet, history, user and more follow the web shell's icons
 * (apps/web/src/components/shell/Icon.tsx); the rest (including briefcase and star) are drawn for this app.
 */
const D: Record<IconName, string[]> = {
  trade: ["M4 19V5M4 19h16", "M8 15v-4M12 15V8M16 15v-6"],
  wallet: ["M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z", "M4 7l11-3v3", "M16 13.5h.5"],
  history: ["M3 12a9 9 0 1 0 2.6-6.3L3 8", "M3 3v5h5", "M12 8v4.5l3 1.8"],
  user: ["M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"],
  chevron: ["M9 6l6 6-6 6"],
  close: ["M6 6l12 12M18 6L6 18"],
  more: ["M6 12h.01M12 12h.01M18 12h.01"],
  briefcase: ["M4 8h16v11H4z", "M9 8V5h6v3"],
  star: ["M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2 8 13.7 4 9.8 9.5 9z"],
  search: ["M15.5 15.5L20 20", "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z"],
  lock: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  bolt: ["M13 3L5 14h6l-1 7 8-11h-6z"],
};

export function Icon({
  name,
  size = 22,
  color = palette.ink,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** Solid shape instead of an outline (the starred state of `star`). */
  filled?: boolean;
}) {
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
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "user" ? <Circle cx={12} cy={8.5} r={3.5} /> : null}
      {D[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}
