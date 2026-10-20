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
  it("declares the wallet and payments keys only in queries.ts", () => {
    const bad = all
      .filter((file) => rel(file) !== "src/api/queries.ts")
      .filter((file) => /queryKey:\s*\[\s*"(payments|wallet)"/.test(read(file)))
      .map(rel);
    expect(bad).toEqual([]);
  });

  it("uses useAccountTradesLoaded only in trade.tsx (the one owner of the trade-list fetch)", () => {
    const bad = all
      .filter((file) => !/useAccountTrades\.ts$/.test(file) && !/\(tabs\)[\\/]trade\.tsx$/.test(file))
      .filter((file) => /import[^;]*useAccountTradesLoaded|useAccountTradesLoaded\(/.test(read(file)))
      .map(rel);
    expect(bad).toEqual([]);
  });

  it("History reads the published list state", () => {
    expect(read(join(APP, "(tabs)", "history.tsx"))).toContain("listLoadedFor(");
  });

  it("has no dead TabHeader and no unused TopBar listLoaded prop", () => {
    expect(existsSync(join(SRC, "trade", "TabHeader.tsx"))).toBe(false);
    expect(read(join(SRC, "trade", "TopBar.tsx"))).not.toMatch(/listLoaded/);
  });
});
