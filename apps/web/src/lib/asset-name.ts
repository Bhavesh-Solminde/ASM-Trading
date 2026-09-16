/** Splits "EUR/USD (OTC)" into its pair and market qualifier. */
export function splitAssetName(displayName: string): { pair: string; market: string } {
  const match = /^(.*?)\s*\((.+)\)$/.exec(displayName);
  return match ? { pair: match[1]!, market: match[2]! } : { pair: displayName, market: "" };
}
