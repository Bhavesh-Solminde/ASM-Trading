import type { DrawingTool } from "./analysis-model";

const PATHS = {
  select: <path d="m4 3 7.1 17 2.5-6.4 6.4-2.5L4 3Z" />,
  horizontal: <><path d="M3 12h18" /><circle cx="8" cy="12" r="2" /></>,
  trend: <><path d="m5 19 14-14" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /></>,
  channel: <><path d="m4 14 13-10M7 20 20 10" /><circle cx="4" cy="14" r="1.75" /><circle cx="17" cy="4" r="1.75" /><circle cx="7" cy="20" r="1.75" /><circle cx="20" cy="10" r="1.75" /></>,
  fib: <><path d="M4 5h16M4 9.5h16M4 14h16M4 19h16" /><circle cx="20" cy="9.5" r="1.75" /><circle cx="4" cy="19" r="1.75" /></>,
  brush: <><path d="M3 20c3.5 0 7-1.6 7-5a3.5 3.5 0 0 0-7 0c0 2-1 4-2 5h2Z" /><path d="M9 11c1.4-4.5 3.3-7 5.4-6.5 2.8.7.7 4.8 3 4.8 1.6 0 2.7-2.2 4.1-4.8" /></>,
  text: <path d="M5 7V4h14v3M12 4v16M8 20h8" />,
  measure: <><path d="m3 16 13-13 5 5L8 21l-5-5Z" /><path d="m13.5 5.5 2 2M10.5 8.5l3 3M7.5 11.5l2 2M4.5 14.5l3 3" /></>,
  zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6M10.5 7.5v6" /></>,
  zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 10.5h6" /></>,
  fit: <><path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6" /><path d="M8 12h8M12 8v8" /></>,
  undo: <path d="m9 5-5 5 5 5M4 10h9a7 7 0 0 1 7 7v2" />,
  delete: <><path d="M4 6h16M9 6V3.5h6V6M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
};

type ChartToolIconName = DrawingTool | "zoomIn" | "zoomOut" | "fit" | "undo" | "delete";

export function ChartToolIcon({ name }: { name: ChartToolIconName }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {PATHS[name]}
  </svg>;
}
