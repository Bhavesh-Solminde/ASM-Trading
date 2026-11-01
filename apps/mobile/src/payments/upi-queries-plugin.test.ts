import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The config plugin is CommonJS (Expo reads it from app.config.ts at prebuild). Its manifest edit is a pure function.
const { addUpiQueries, UPI_SCHEMES } = createRequire(import.meta.url)("../../plugins/with-upi-queries.js") as {
  addUpiQueries: (manifest: { queries?: unknown[] }) => { queries: { intent?: { action: unknown[]; data: { $: Record<string, string> }[] }[] }[] };
  UPI_SCHEMES: string[];
};

const schemesIn = (manifest: ReturnType<typeof addUpiQueries>) =>
  manifest.queries.flatMap((q) => q.intent ?? []).flatMap((i) => i.data.map((d) => d.$["android:scheme"]));

describe("with-upi-queries", () => {
  it("declares the four schemes the pay screen probes: upi, phonepe, tez, paytmmp", () => {
    expect([...UPI_SCHEMES].sort()).toEqual(["paytmmp", "phonepe", "tez", "upi"]);
    expect(schemesIn(addUpiQueries({})).sort()).toEqual(["paytmmp", "phonepe", "tez", "upi"]);
  });

  it("asks about VIEW intents, one per scheme", () => {
    const [q] = addUpiQueries({}).queries;
    expect(q?.intent).toHaveLength(4);
    for (const intent of q?.intent ?? []) expect(intent.action).toEqual([{ $: { "android:name": "android.intent.action.VIEW" } }]);
  });

  it("keeps the queries Expo already put in the manifest", () => {
    const existing = { intent: [{ action: [{ $: { "android:name": "android.intent.action.VIEW" } }], data: [{ $: { "android:scheme": "https" } }] }] };
    const out = addUpiQueries({ queries: [existing] });
    expect(out.queries[0]).toBe(existing);
    expect(schemesIn(out)).toContain("https");
    expect(schemesIn(out)).toContain("upi");
  });

  it("adds them once however many times prebuild runs it", () => {
    const once = addUpiQueries({});
    const twice = addUpiQueries(once);
    expect(schemesIn(twice).filter((s) => s === "upi")).toHaveLength(1);
    expect(schemesIn(twice)).toHaveLength(4);
  });
});
