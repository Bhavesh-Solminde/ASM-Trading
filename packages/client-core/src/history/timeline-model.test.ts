import { describe, expect, it } from "vitest";
import { latestReachedIndex, timelineSteps } from "./timeline-model";

const states = (kind: "deposit" | "withdrawal", status: string) =>
  timelineSteps(kind, status).map((s) => `${s.id}:${s.state}`);

describe("withdrawal timeline", () => {
  it("shows a requested or held withdrawal as in review", () => {
    for (const status of ["REQUESTED", "HELD"]) {
      expect(states("withdrawal", status)).toEqual([
        "requested:done",
        "review:current",
        "approved:todo",
        "paid:todo",
      ]);
    }
  });

  it("moves to approved, then paid", () => {
    expect(states("withdrawal", "APPROVED")).toEqual(["requested:done", "review:done", "approved:current", "paid:todo"]);
    expect(states("withdrawal", "PAID")).toEqual(["requested:done", "review:done", "approved:done", "paid:done"]);
  });

  it("ends in rejected after review, dropping the steps that never happen", () => {
    expect(states("withdrawal", "REJECTED")).toEqual(["requested:done", "review:done", "rejected:ended"]);
  });

  it("ends in cancelled straight after the request", () => {
    expect(states("withdrawal", "CANCELLED_BY_USER")).toEqual(["requested:done", "cancelled:ended"]);
  });
});

describe("deposit timeline", () => {
  it("walks started, submitted, credited", () => {
    expect(states("deposit", "AWAITING_PAYMENT")).toEqual(["started:current", "submitted:todo", "credited:todo"]);
    expect(states("deposit", "PENDING_CONFIRMATION")).toEqual(["started:done", "submitted:current", "credited:todo"]);
    expect(states("deposit", "COMPLETED")).toEqual(["started:done", "submitted:done", "credited:done"]);
  });

  it("has terminal rejected and expired variants", () => {
    expect(states("deposit", "REJECTED")).toEqual(["started:done", "submitted:done", "rejected:ended"]);
    expect(states("deposit", "EXPIRED")).toEqual(["started:done", "expired:ended"]);
  });

  it("falls back to the first step for an unknown status", () => {
    expect(states("deposit", "WHATEVER")[0]).toBe("started:current");
  });
});

describe("latestReachedIndex", () => {
  it("points at the last non-todo step", () => {
    expect(latestReachedIndex(timelineSteps("withdrawal", "APPROVED"))).toBe(2);
    expect(latestReachedIndex(timelineSteps("withdrawal", "REJECTED"))).toBe(2);
    expect(latestReachedIndex(timelineSteps("deposit", "AWAITING_PAYMENT"))).toBe(0);
  });
});
