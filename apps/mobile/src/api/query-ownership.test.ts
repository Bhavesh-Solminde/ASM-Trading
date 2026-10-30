import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// One query key, one query type. The wallet and the payments list are declared once, in src/api/queries.ts
// (`useWallet`, `usePaymentsInfinite`); an inline `useQuery({ queryKey: ["payments"] })` next to the infinite
// query makes TanStack hand one observer the other's data shape and the tab crashes. There are no render tests,
// so guard the source.
const SRC = join(__dirname, "..");
const APP = join(__dirname, "..", "..", "app");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
const all = [...sources(SRC), ...sources(APP)];
const rel = (file: string) => relative(join(__dirname, "..", ".."), file);
const read = (file: string) => readFileSync(file, "utf8");

describe("query ownership", () => {
  it("declares the wallet and payments keys once, in queries.ts", () => {
    const queries = read(join(SRC, "api", "queries.ts"));
    // The wallet: one `queryKey:` declaration and no other literal. Payments: one literal, the `PAYMENTS_KEY` constant,
    // which the infinite query and the non-hook cache reader (`cachedPaymentRow`) both use.
    expect(queries.match(/queryKey:\s*\[\s*["']wallet["']\s*[\],]/g)).toHaveLength(1);
    expect(queries.match(/\[\s*["']wallet["']\s*[\],]/g)).toHaveLength(1);
    expect(queries.match(/\[\s*["']payments["']\s*[\],]/g)).toHaveLength(1);
    expect(queries.match(/queryKey:\s*PAYMENTS_KEY\b/g)).toHaveLength(1);
    expect(queries.match(/getQueryData[^;]*PAYMENTS_KEY/g)).toHaveLength(1);
  });

  it("opens the payment sheet without subscribing to the payments list (a subscription refetches every loaded page)", () => {
    const sheet = read(join(SRC, "history", "DetailSheet.tsx"));
    expect(sheet).not.toMatch(/usePaymentsInfinite/);
    expect(sheet).toMatch(/cachedPaymentRow\(/);
  });

  it("never names the wallet or payments key as an array literal outside queries.ts and invalidate-money.ts", () => {
    // Covers an inline useQuery, a key held in a constant, and getQueryData / setQueryData on the cache.
    const bad = all
      .filter((file) => !["src/api/queries.ts", "src/api/invalidate-money.ts"].includes(rel(file)))
      .filter((file) => /\[\s*["'](payments|wallet)["']\s*[\],]/.test(read(file)))
      .map(rel);
    expect(bad).toEqual([]);
  });

  it("gates every money hook on the session: each takes `enabled` and passes it to its query", () => {
    const queries = read(join(SRC, "api", "queries.ts"));
    for (const hook of ["useWallet", "usePaymentsInfinite", "usePayment", "useDepositConfig", "useWithdrawalPrefill", "useCheckout", "useUsdtChainStatus", "useProfile"]) {
      const start = queries.indexOf(`export const ${hook} =`);
      expect(start, hook).toBeGreaterThan(-1);
      const next = queries.indexOf("\nexport ", start + 1);
      const block = queries.slice(start, next === -1 ? undefined : next);
      expect(block, `${hook} signature`).toMatch(/enabled: boolean[,)]/);
      expect(block.match(/\benabled\b/g)?.length, `${hook} passes enabled on`).toBeGreaterThanOrEqual(2);
    }
  });

  it("uses useAccountTradesLoaded only in trade.tsx (the owner) and History's cold-link fallback", () => {
    const bad = all
      .filter((file) => !/useAccountTrades\.ts$/.test(file) && !/\(tabs\)[\\/](trade|history)\.tsx$/.test(file))
      .filter((file) => /import[^;]*useAccountTradesLoaded|useAccountTradesLoaded\(/.test(read(file)))
      .map(rel);
    expect(bad).toEqual([]);
  });

  it("History reads the published list state and fetches only when Trade has not loaded it", () => {
    const history = read(join(APP, "(tabs)", "history.tsx"));
    expect(history).toContain("listLoadedFor(");
    // The fallback fetch is gated on "not loaded by Trade", so it never runs alongside Trade's.
    expect(history).toMatch(/useAccountTradesLoaded\([^,]+,\s*!!account && !loadedByTrade\)/);
  });

  it("has no dead TabHeader and no unused TopBar listLoaded prop", () => {
    expect(existsSync(join(SRC, "trade", "TabHeader.tsx"))).toBe(false);
    expect(read(join(SRC, "trade", "TopBar.tsx"))).not.toMatch(/listLoaded/);
  });
});
