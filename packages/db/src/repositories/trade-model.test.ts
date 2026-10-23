import { expect, it, vi } from "vitest";
const findMany = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../client", () => ({ prisma: { trade: { findMany } } }));
import { loadOpenPositions } from "./trade";
it("never hydrates CFD orders into the binary settlement/refund queue", async () => {
  await loadOpenPositions();
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "OPEN", durationSec: null } }));
});
