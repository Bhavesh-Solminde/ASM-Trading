import { describe, expect, it } from "vitest";
import { ApiError, GENERIC_ERROR } from "@/api/errors";
import { FAQ } from "@asm/contracts";
import {
  TICKET_BODY_MAX,
  TICKET_SUBJECT_MAX,
  faqKeys,
  supportLinks,
  ticketBody,
  ticketErrorText,
  ticketProblems,
  ticketSubmitEnabled,
  ticketTag,
} from "./support-model";

const t = (key: string) => `«${key}»`;

describe("supportLinks", () => {
  it("lists WhatsApp then Telegram when both are set", () => {
    expect(supportLinks({ whatsapp: "https://wa.me/910000000000", telegram: "https://t.me/ixt_support" })).toEqual([
      { id: "whatsapp", url: "https://wa.me/910000000000" },
      { id: "telegram", url: "https://t.me/ixt_support" },
    ]);
  });

  it("leaves out whatever is not set", () => {
    expect(supportLinks({ whatsapp: null, telegram: "https://t.me/ixt_support" })).toEqual([{ id: "telegram", url: "https://t.me/ixt_support" }]);
    expect(supportLinks({ whatsapp: null, telegram: null })).toEqual([]);
    expect(supportLinks({ whatsapp: "", telegram: "   " })).toEqual([]);
  });

  it("is empty while the app config has not loaded", () => {
    expect(supportLinks(undefined)).toEqual([]);
  });

  it("trims, and opens https links only (a config typo must not hand the phone another scheme)", () => {
    expect(supportLinks({ whatsapp: "  https://wa.me/91  ", telegram: null })).toEqual([{ id: "whatsapp", url: "https://wa.me/91" }]);
    for (const bad of ["http://wa.me/91", "javascript:alert(1)", "intent://scan/#Intent;scheme=zxing;end", "tg://resolve?domain=x", "wa.me/91", "https://", "https:// bad host"]) {
      expect(supportLinks({ whatsapp: bad, telegram: null }), bad).toEqual([]);
    }
  });
});

describe("faqKeys", () => {
  it("numbers the entries from 1, a question and an answer each", () => {
    expect(faqKeys(2)).toEqual([
      { q: "support.faq.1.q", a: "support.faq.1.a" },
      { q: "support.faq.2.q", a: "support.faq.2.a" },
    ]);
    expect(faqKeys(0)).toEqual([]);
  });
  it("covers every entry of the contracts FAQ", () => {
    expect(faqKeys(FAQ.length)).toHaveLength(FAQ.length);
  });
});

describe("ticketTag", () => {
  it("is a word and a tone for each status", () => {
    expect(ticketTag("OPEN")).toEqual({ tone: "caution", labelKey: "support.status.open" });
    expect(ticketTag("ANSWERED")).toEqual({ tone: "up", labelKey: "support.status.answered" });
    expect(ticketTag("CLOSED")).toEqual({ tone: "neutral", labelKey: "support.status.closed" });
  });
});

describe("ticketProblems", () => {
  const good = { subject: "Deposit not credited", body: "I paid 1000 yesterday and it still shows pending." };

  it("is empty for a good ticket", () => {
    expect(ticketProblems(good.subject, good.body)).toEqual({});
  });

  it("names the subject when it is under 3 characters, counting after trimming", () => {
    expect(ticketProblems("", good.body)).toEqual({ subject: "support.errSubject" });
    expect(ticketProblems("  ab  ", good.body)).toEqual({ subject: "support.errSubject" });
    expect(ticketProblems("abc", good.body)).toEqual({});
  });

  it("names the body when it is under 10 characters, counting after trimming", () => {
    expect(ticketProblems(good.subject, "too short")).toEqual({ body: "support.errBody" });
    expect(ticketProblems(good.subject, "   123456789   ")).toEqual({ body: "support.errBody" });
    expect(ticketProblems(good.subject, "1234567890")).toEqual({});
  });

  it("names both, and the limits", () => {
    expect(ticketProblems("", "")).toEqual({ subject: "support.errSubject", body: "support.errBody" });
    expect(ticketProblems("a".repeat(TICKET_SUBJECT_MAX + 1), good.body)).toEqual({ subject: "support.errSubject" });
    expect(ticketProblems(good.subject, "x".repeat(TICKET_BODY_MAX + 1))).toEqual({ body: "support.errBody" });
    expect(TICKET_SUBJECT_MAX).toBe(120);
    expect(TICKET_BODY_MAX).toBe(4000);
  });
});

describe("ticketBody and ticketSubmitEnabled", () => {
  it("sends the trimmed text and nothing else (the schema is strict)", () => {
    expect(ticketBody("  Hello there  ", "  A long enough message.  ")).toEqual({ subject: "Hello there", body: "A long enough message." });
  });
  it("enables Send only for a valid ticket", () => {
    expect(ticketSubmitEnabled("Hello there", "A long enough message.")).toBe(true);
    expect(ticketSubmitEnabled("Hi", "A long enough message.")).toBe(false);
    expect(ticketSubmitEnabled("Hello there", "short")).toBe(false);
  });
});

describe("ticketErrorText", () => {
  it("offline reads as no connection", () => {
    expect(ticketErrorText(new ApiError("No connection.", 0, "offline"), t)).toBe("«common.noConnection»");
  });

  it("a timeout says the ticket may have gone through and to check the list before sending again", () => {
    expect(ticketErrorText(new ApiError("The request timed out.", 0, "timeout"), t)).toBe("«support.ticketTimedOut»");
  });

  it("a 4xx shows the server's own message", () => {
    expect(ticketErrorText(new ApiError("Check the ticket.", 400, null), t)).toBe("Check the ticket.");
  });

  it("5xx and a bare error are generic", () => {
    expect(ticketErrorText(new ApiError("boom", 500, null), t)).toBe("«common.genericError»");
    expect(ticketErrorText(new ApiError(GENERIC_ERROR, 400, null), t)).toBe("«common.genericError»");
    expect(ticketErrorText(new Error("x"), t)).toBe("«common.genericError»");
  });

  it("says nothing for what something else already reports (rate limit toast, sign-out, gate screens)", () => {
    for (const code of ["rate_limited", "unauthenticated", "maintenance", "blocked", "upgrade"]) {
      expect(ticketErrorText(new ApiError("x", 429, code), t), code).toBeNull();
    }
  });
});
