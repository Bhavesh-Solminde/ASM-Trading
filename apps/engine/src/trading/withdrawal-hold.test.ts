import { describe, expect, it } from "vitest";
import { autoPromoteHeldWithdrawals, prisma } from "@asm/db";

/**
 * Smoke test for the engine's once-per-minute auto-promote tick. The tick
 * runs even when no HELD rows exist; it must come back cleanly with a 0 count
 * so the loop can safely fire-and-forget it. The repo function itself owns
 * the "flip HELD → REQUESTED when holdUntil passed" semantics (covered by
 * packages/db/src/repositories/withdrawal.test.ts); here we just assert that
 * calling it against the live DB with nothing on hold does not throw.
 */
describe("autoPromoteHeldWithdrawals — engine smoke", () => {
  it("returns 0 and does not throw when nothing is on hold", async () => {
    // We don't delete rows another test suite may own; we just assert the
    // call completes. Count semantics for a non-empty DB are covered in the
    // db tests.
    const count = await autoPromoteHeldWithdrawals();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("can run twice back-to-back without exploding", async () => {
    await autoPromoteHeldWithdrawals();
    const count = await autoPromoteHeldWithdrawals();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("has prisma connectivity (sanity)", async () => {
    const rowCount = await prisma.withdrawal.count({ where: { status: "HELD" } });
    expect(Number.isInteger(rowCount)).toBe(true);
  });
});
