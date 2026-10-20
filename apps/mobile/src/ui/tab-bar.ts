/**
 * Whether the bottom tab bar hides for a tab route: a tab that hosts its own stack (Payments, Account) is on a
 * pushed flow screen when the nested state's index is past the first screen. A route with no nested state yet
 * (never visited, or a plain screen) is on its index screen.
 */
export function tabBarHidden(route: { name?: string; state?: { index?: number } }, fullscreen = false): boolean {
  return (fullscreen && route.name === "trade") || (route.state?.index ?? 0) > 0;
}
