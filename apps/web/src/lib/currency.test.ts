import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as contracts from "@asm/contracts";
import * as db from "@asm/db";
import * as mirror from "./currency";
import { minStakeMinor } from "./currency";

describe("one FX rate for the whole platform", () => {
  it("db, the web mirror and contracts expose the same rate and the same converter", () => {
    expect(contracts.USD_INR_RATE).toBe(110);
    expect(db.USD_INR_RATE).toBe(contracts.USD_INR_RATE);
    expect(mirror.USD_INR_RATE).toBe(contracts.USD_INR_RATE);
    expect(db.convertMinorBetween).toBe(contracts.convertMinorBetween);
    expect(mirror.convertMinorBetween).toBe(contracts.convertMinorBetween);
  });

  it("is declared exactly once in source, and the old 107.64 deposit rate is gone", () => {
    const root = resolve(__dirname, "../../../..");
    const hits: string[] = [];
    const stale: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", "generated", "dist", ".git", ".impeccable"].includes(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const text = readFileSync(full, "utf8");
          if (/\b(?:const|let|var)\s+USD_INR_RATE\b/.test(text)) hits.push(full.replace(root + "/", ""));
          if (/107\.64|USD_TO_INR_RATE|\b(?:INR|USD)_?(?:PER|TO)_?(?:USD|INR)\b/i.test(text)) {
            stale.push(full.replace(root + "/", ""));
          }
        }
      }
    };
    for (const sub of ["packages", "apps"]) walk(join(root, sub));
    expect(hits).toEqual(["packages/contracts/src/currency.ts"]);
    expect(stale).toEqual([]);
  });
});

describe("minStakeMinor", () => {
  it("is ₹100 on an INR account", () => {
    expect(minStakeMinor("INR")).toBe(10_000);
  });

  it("is $1 on a USD account (a per-currency rule, not a conversion)", () => {
    expect(minStakeMinor("USD")).toBe(100);
  });
});
