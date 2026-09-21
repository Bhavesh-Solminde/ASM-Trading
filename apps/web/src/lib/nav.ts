export type RailIcon = "trade" | "wallet" | "help" | "user" | "cup" | "globe" | "more";

export interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Icon key, resolved to an SVG by the rail. */
  readonly icon: RailIcon;
  /** False renders the item disabled rather than hiding it. */
  readonly available: boolean;
  /** Extra path prefixes that should light this item up (e.g. deposit under Payments). */
  readonly matches?: readonly string[];
  /** Pins the item to the bottom of the rail. */
  readonly pinBottom?: boolean;
}

/**
 * The rail as a registry rather than hard-coded markup.
 *
 * Adding one of the deferred destinations later means flipping `available` and
 * creating its route folder — no consumer changes.
 */
export const RAIL_ITEMS: readonly RailItem[] = [
  { id: "trade", label: "Trade", href: "/trade", icon: "trade", available: true },
  {
    id: "payments",
    label: "Payments",
    href: "/balance",
    icon: "wallet",
    available: true,
    matches: ["/deposit", "/withdrawal"],
  },
  { id: "leaderboard", label: "Top", href: "/leaderboard", icon: "cup", available: true },
  { id: "support", label: "Support", href: "/support", icon: "help", available: true },
  { id: "account", label: "Account", href: "/account", icon: "user", available: true },
  { id: "tournaments", label: "Tourney", href: "/tournaments", icon: "cup", available: false },
  { id: "market", label: "Market", href: "/market", icon: "globe", available: false },
  { id: "more", label: "More", href: "/more", icon: "more", available: false, pinBottom: true },
];

export function availableRailItems(): RailItem[] {
  return RAIL_ITEMS.filter((item) => item.available);
}

export function isRailItemActive(item: RailItem, pathname: string): boolean {
  return [item.href, ...(item.matches ?? [])].some((prefix) => pathname.startsWith(prefix));
}
