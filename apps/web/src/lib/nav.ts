export interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Emoji stand-in. Swap for an icon set without touching consumers. */
  readonly icon: string;
  /** False renders the item disabled rather than hiding it — the original shows all six. */
  readonly available: boolean;
  readonly badge?: number;
}

/**
 * The rail as a registry rather than hard-coded markup.
 *
 * Adding one of the deferred destinations later means flipping `available` and
 * creating its route folder — no consumer changes. That is the extensibility
 * the specification asks for, and it costs nothing now.
 */
export const RAIL_ITEMS: readonly RailItem[] = [
  { id: "trade", label: "Trade", href: "/trade", icon: "📈", available: true },
  { id: "support", label: "Support", href: "/support", icon: "❓", available: true },
  { id: "account", label: "Account", href: "/account", icon: "👤", available: true },
  { id: "tournaments", label: "Tournaments", href: "/tournaments", icon: "🏆", available: false, badge: 4 },
  { id: "market", label: "Market", href: "/market", icon: "🪙", available: false, badge: 4 },
  { id: "analytics", label: "Analytics", href: "/analytics", icon: "📊", available: false },
  { id: "more", label: "More", href: "/more", icon: "•••", available: false },
];

export function availableRailItems(): RailItem[] {
  return RAIL_ITEMS.filter((item) => item.available);
}
