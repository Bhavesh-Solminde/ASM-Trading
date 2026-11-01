/**
 * Runs once per server start. Downloads the free VPN / relay / Tor / country
 * lists in the background so the network guard is armed before traffic
 * arrives; boot never waits on it. Skipped wherever the guard is off.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const mode = process.env.VPN_BLOCK_MODE;
  if (mode !== "log" && mode !== "block") return;
  const { warmIntel } = await import("./lib/network-guard/intel");
  void warmIntel();
}
