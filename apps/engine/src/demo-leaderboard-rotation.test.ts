import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ seed: vi.fn(), error: vi.fn() }));
vi.mock("@asm/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@asm/db")>(), seedDemoLeaderboardProfiles: mock.seed,
}));
vi.mock("@asm/logger", () => ({ logger: { error: mock.error } }));

import { startDemoLeaderboardRotation } from "./demo-leaderboard-rotation";

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("runs on startup and at exactly midnight IST, then cancels on shutdown", async () => {
  const startup = new Date("2026-11-08T18:29:59.000Z");
  vi.useFakeTimers({ now: startup });
  mock.seed.mockResolvedValue(undefined);
  const rotation = startDemoLeaderboardRotation();
  expect(mock.seed).toHaveBeenCalledExactlyOnceWith(startup);
  await vi.advanceTimersByTimeAsync(999);
  expect(mock.seed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.seed).toHaveBeenLastCalledWith(new Date("2026-11-08T18:30:00.000Z"));
  await rotation.stop();
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(mock.seed).toHaveBeenCalledTimes(2);
});

it("retries a failed rotation after a minute", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-08T18:30:00.000Z") });
  mock.seed.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(undefined);
  const rotation = startDemoLeaderboardRotation();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(mock.error).toHaveBeenCalledTimes(1);
  expect(mock.seed).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mock.seed).toHaveBeenLastCalledWith(new Date("2026-11-08T18:31:00.000Z"));
  await rotation.stop();
});
