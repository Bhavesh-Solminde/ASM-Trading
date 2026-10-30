import { describe, expect, it } from "vitest";
import { CreateTicketSchema, FAQ, TicketSchema, TicketsResponseSchema } from "./support";

/** What `GET /api/support` sends: a Prisma SupportTicket row after JSON (dates are ISO strings, `userId` rides along). */
const ROW = {
  id: "7b7c5f0e-1c1e-4f0a-9d53-2f1d2e0c9a11",
  userId: "u1",
  subject: "Deposit not credited",
  body: "I paid 1000 yesterday and it still shows pending.",
  status: "OPEN",
  createdAt: "2026-10-30T09:15:00.000Z",
};

describe("TicketSchema", () => {
  it("reads a ticket row as the server sends it and drops the owner's id", () => {
    const parsed = TicketSchema.parse(ROW);
    expect(parsed).toEqual({ id: ROW.id, subject: ROW.subject, body: ROW.body, status: "OPEN", createdAt: ROW.createdAt });
    expect("userId" in parsed).toBe(false);
  });

  it("accepts the three statuses the database has", () => {
    for (const status of ["OPEN", "ANSWERED", "CLOSED"]) expect(TicketSchema.safeParse({ ...ROW, status }).success).toBe(true);
  });

  it("rejects a status it does not know and a missing field", () => {
    expect(TicketSchema.safeParse({ ...ROW, status: "ESCALATED" }).success).toBe(false);
    for (const key of ["id", "subject", "body", "status", "createdAt"] as const) {
      const { [key]: _drop, ...rest } = ROW;
      expect(TicketSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("rejects a createdAt that is not a date", () => {
    expect(TicketSchema.safeParse({ ...ROW, createdAt: "yesterday" }).success).toBe(false);
  });

  it("wraps a list the way the route does", () => {
    expect(TicketsResponseSchema.parse({ tickets: [ROW, { ...ROW, id: "2" }] }).tickets).toHaveLength(2);
    expect(TicketsResponseSchema.parse({ tickets: [] }).tickets).toEqual([]);
    expect(TicketsResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe("CreateTicketSchema", () => {
  it("keeps its limits: subject 3-120, body 10-4000, nothing else", () => {
    expect(CreateTicketSchema.safeParse({ subject: "abc", body: "x".repeat(10) }).success).toBe(true);
    expect(CreateTicketSchema.safeParse({ subject: "ab", body: "x".repeat(10) }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ subject: "a".repeat(121), body: "x".repeat(10) }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ subject: "abc", body: "x".repeat(9) }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ subject: "abc", body: "x".repeat(4001) }).success).toBe(false);
    expect(CreateTicketSchema.safeParse({ subject: "abc", body: "x".repeat(10), extra: 1 }).success).toBe(false);
  });
});

describe("FAQ", () => {
  it("tells the withdrawal steps the way the withdrawal screen works: Bank, UPI or USDT, no 'method you deposited with'", () => {
    const answer = FAQ[0].a;
    expect(answer).toContain("choose Bank, UPI or USDT");
    expect(answer).not.toMatch(/already deposited/i);
    expect(answer).not.toMatch(/deposited with/i);
  });

  it("has a question and an answer in every entry", () => {
    expect(FAQ.length).toBeGreaterThan(0);
    for (const entry of FAQ) {
      expect(entry.q.trim()).not.toBe("");
      expect(entry.a.trim()).not.toBe("");
    }
  });
});
