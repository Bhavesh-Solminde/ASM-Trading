import { describe, expect, it } from "vitest";
import { timelineSteps, type TimelineKind } from "@asm/client-core";
import en from "@/i18n/en.json";
import hi from "@/i18n/hi.json";
import { dotState, timelineCopy } from "./timeline-copy";

const DEPOSIT = ["AWAITING_PAYMENT", "PENDING_CONFIRMATION", "COMPLETED", "REJECTED", "EXPIRED", "SOMETHING_NEW"];
const WITHDRAWAL = ["REQUESTED", "HELD", "APPROVED", "PAID", "REJECTED", "CANCELLED_BY_USER", "SOMETHING_NEW"];
const at = (o: unknown, path: string) => path.split(".").reduce<unknown>((acc, p) => (acc as Record<string, unknown> | undefined)?.[p], o);

describe("timelineCopy", () => {
  const cases: [TimelineKind, string[]][] = [["deposit", DEPOSIT], ["withdrawal", WITHDRAWAL]];
  for (const [kind, statuses] of cases) {
    it(`has an English and a Hindi string for every ${kind} step in every status`, () => {
      for (const status of statuses) {
        for (const step of timelineSteps(kind, status)) {
          const { titleKey, detailKey } = timelineCopy(kind, step);
          for (const key of [titleKey, detailKey]) {
            expect(typeof at(en, key), `${kind} ${status} ${key} (en)`).toBe("string");
            expect(typeof at(hi, key), `${kind} ${status} ${key} (hi)`).toBe("string");
          }
        }
      }
    });
  }
  it("uses the done wording for a reached step and the waiting wording for the rest", () => {
    const steps = timelineSteps("deposit", "PENDING_CONFIRMATION");
    expect(timelineCopy("deposit", steps[0]!).detailKey).toBe("history.timeline.deposit.started.done");
    expect(timelineCopy("deposit", steps[1]!).detailKey).toBe("history.timeline.deposit.submitted.detail");
    expect(timelineCopy("deposit", steps[2]!).detailKey).toBe("history.timeline.deposit.credited.detail");
  });
  it("has one wording for a step that never changes (requested, review, approved, rejected, cancelled, expired)", () => {
    const cases: [TimelineKind, string][] = [["withdrawal", "REJECTED"], ["withdrawal", "CANCELLED_BY_USER"], ["deposit", "EXPIRED"]];
    for (const [kind, status] of cases) {
      for (const step of timelineSteps(kind, status)) {
        if (["requested", "review", "rejected", "cancelled", "expired"].includes(step.id)) expect(timelineCopy(kind, step).detailKey.endsWith(".detail")).toBe(true);
      }
    }
  });
  it("words a rejected deposit and a rejected withdrawal differently", () => {
    const deposit = timelineSteps("deposit", "REJECTED").at(-1)!;
    const withdrawal = timelineSteps("withdrawal", "REJECTED").at(-1)!;
    expect(timelineCopy("deposit", deposit).detailKey).not.toBe(timelineCopy("withdrawal", withdrawal).detailKey);
  });
});

describe("dotState", () => {
  it("is the step state, and marks the connector above a step as reached only when the step is", () => {
    const steps = timelineSteps("withdrawal", "APPROVED");
    expect(steps.map((s) => dotState(s).dot)).toEqual(["done", "done", "current", "todo"]);
    expect(steps.map((s) => dotState(s).connectorAboveReached)).toEqual([true, true, true, false]);
  });
  it("treats an ended step as reached with its own dot", () => {
    const steps = timelineSteps("deposit", "EXPIRED");
    expect(dotState(steps[1]!)).toEqual({ dot: "ended", connectorAboveReached: true });
  });
});
