const HALF_LIFE_SEC = 2.4 * 3600;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_SEC;

interface AssetGapConfig {
  sigma1h: number;
  maxGapMultiple: number;
}

interface GapState {
  gap: number;
  config: AssetGapConfig;
}

export class GapTracker {
  private readonly state = new Map<string, GapState>();

  registerAsset(symbol: string, config: AssetGapConfig): void {
    this.state.set(symbol, { gap: 0, config });
  }

  push(symbol: string, magnetPull: number, dtSec: number): void {
    const s = this.state.get(symbol);
    if (!s) return;

    const decayFactor = Math.exp(-DECAY_LAMBDA * dtSec);
    s.gap = s.gap * decayFactor + magnetPull;

    const maxGap = s.config.sigma1h * s.config.maxGapMultiple;
    s.gap = Math.max(-maxGap, Math.min(maxGap, s.gap));
  }

  gap(symbol: string): number {
    return this.state.get(symbol)?.gap ?? 0;
  }

  shownPrice(symbol: string, realPrice: number): number {
    return realPrice * (1 + this.gap(symbol));
  }

  honestPrice(_symbol: string, realPrice: number): number {
    return realPrice;
  }

  converge(symbol: string, dtSec: number): void {
    const s = this.state.get(symbol);
    if (!s) return;
    const convergeLambda = DECAY_LAMBDA * 10;
    s.gap *= Math.exp(-convergeLambda * dtSec);
    if (Math.abs(s.gap) < 1e-12) s.gap = 0;
  }

  reset(symbol: string): void {
    const s = this.state.get(symbol);
    if (s) s.gap = 0;
  }

  resetAll(): void {
    for (const s of this.state.values()) s.gap = 0;
  }

  /**
   * Export every REGISTERED symbol's current gap, so the engine can persist it
   * across restarts. Shown price = real × (1 + gap); if we drop this on reboot
   * the chart snaps by the full gap value on the first post-restart tick.
   */
  snapshot(): Array<{ symbol: string; gap: number }> {
    const out: Array<{ symbol: string; gap: number }> = [];
    for (const [symbol, s] of this.state) out.push({ symbol, gap: s.gap });
    return out;
  }

  /**
   * Seed persisted gaps on startup. Called AFTER `registerAsset`, so an entry
   * whose symbol is no longer registered (asset removed, symbol renamed) is
   * silently skipped — it has no live asset to attach to. A NaN or non-finite
   * stored value is also skipped, so a corrupt row can't poison the tracker.
   */
  restore(entries: Iterable<{ symbol: string; gap: number }>): number {
    let restored = 0;
    for (const { symbol, gap } of entries) {
      if (!Number.isFinite(gap)) continue;
      const s = this.state.get(symbol);
      if (!s) continue;
      // Still clamp to the asset's own [-maxGap, +maxGap] band, in case the
      // asset's sigma1h shrank since the snapshot was written.
      const maxGap = s.config.sigma1h * s.config.maxGapMultiple;
      s.gap = Math.max(-maxGap, Math.min(maxGap, gap));
      restored += 1;
    }
    return restored;
  }
}

export type AssetCategory = "CRYPTO" | "FOREX" | "STOCK";

export function assetCategory(symbol: string): AssetCategory {
  if (symbol.startsWith("XAU") || symbol.startsWith("XAG")) return "STOCK";
  if (symbol.startsWith("EUR") || symbol.startsWith("GBP") || symbol.startsWith("AUD")) return "FOREX";
  if (symbol.includes("USD")) return "CRYPTO";
  return "STOCK";
}

export function isMarketClosed(kind: AssetCategory, now: Date): boolean {
  if (kind === "CRYPTO") return false;
  const day = now.getUTCDay();
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const istMinutes = (utcH * 60 + utcM + 330) % 1440;
  if (day === 0 || day === 6) return true;
  if (istMinutes >= 23 * 60 + 30 || istMinutes < 5 * 60) return true;
  return false;
}

export function cryptoMaintenancePhase(now: Date): "FROZEN" | "CONVERGING" | "OPEN" {
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const istMinutes = (utcH * 60 + utcM + 330) % 1440;
  const istHour = istMinutes / 60;
  if (istHour >= 4 && istHour < 5) return "FROZEN";
  if (istHour >= 5 && istHour < 6) return "CONVERGING";
  return "OPEN";
}
