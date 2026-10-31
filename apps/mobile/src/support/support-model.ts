import type { Tone } from "@asm/client-core";
import { CreateTicketSchema, type TicketDto } from "@asm/contracts";
import { ApiError, GENERIC_ERROR } from "@/api/errors";

/** The limits of `CreateTicketSchema` (the form's `maxLength`s; the schema itself is the judge). */
export const TICKET_SUBJECT_MAX = 120;
export const TICKET_BODY_MAX = 4_000;

/** A ticket that gets no answer by then is left to the list: the server may still have created it. */
export const TICKET_TIMEOUT_MS = 15_000;

export interface SupportLink {
  id: "whatsapp" | "telegram";
  url: string;
}

/**
 * The contact buttons: WhatsApp then Telegram, each only when the server's app config has a link for it. Only an
 * `https` link with a host is opened, so a typo in the config cannot hand the phone another scheme (no `URL` class:
 * Hermes only partly implements it).
 */
export function supportLinks(support: { whatsapp: string | null; telegram: string | null } | undefined): SupportLink[] {
  if (!support) return [];
  const links: SupportLink[] = [];
  for (const id of ["whatsapp", "telegram"] as const) {
    const url = support[id]?.trim() ?? "";
    if (/^https:\/\/[^\s/?#]+(?:[/?#]\S*)?$/.test(url)) links.push({ id, url });
  }
  return links;
}

/** i18n keys of FAQ entry `n` of 1..count (`support.faq.<n>.{q,a}`; the English copy is the contracts `FAQ`). */
export function faqKeys(count: number): { q: string; a: string }[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({ q: `support.faq.${i + 1}.q`, a: `support.faq.${i + 1}.a` }));
}

const TAGS: Record<TicketDto["status"], { tone: Tone; labelKey: string }> = {
  OPEN: { tone: "caution", labelKey: "support.status.open" },
  ANSWERED: { tone: "up", labelKey: "support.status.answered" },
  CLOSED: { tone: "neutral", labelKey: "support.status.closed" },
};

/** The `StatusTag` of a ticket: a word and a tone (Open is waiting, Answered is the good news, Closed is quiet). */
export function ticketTag(status: TicketDto["status"]): { tone: Tone; labelKey: string } {
  return TAGS[status];
}

/** Per-field i18n keys for what is wrong with a draft (client-side copy, never zod's English message). */
export function ticketProblems(subject: string, body: string): { subject?: string; body?: string } {
  const parsed = CreateTicketSchema.safeParse({ subject, body });
  if (parsed.success) return {};
  const problems: { subject?: string; body?: string } = {};
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === "subject") problems.subject = "support.errSubject";
    else if (issue.path[0] === "body") problems.body = "support.errBody";
  }
  return problems;
}

export function ticketSubmitEnabled(subject: string, body: string): boolean {
  return Object.keys(ticketProblems(subject, body)).length === 0;
}

/** The request body: trimmed, and exactly the two fields the strict schema allows. */
export function ticketBody(subject: string, body: string): { subject: string; body: string } {
  return { subject: subject.trim(), body: body.trim() };
}

/** Errors something else already reports: a rate limit toasts, `unauthenticated` signs out, a gate replaces the app. */
const HANDLED_ELSEWHERE = new Set(["rate_limited", "unauthenticated", "maintenance", "blocked", "upgrade"]);

/**
 * The text to show under a failed "Send". null: say nothing, it is already reported. A timeout says the ticket may
 * have gone through. A 4xx shows the server's own message (English, accepted for now); 5xx and the rest are generic.
 */
export function ticketErrorText(e: unknown, t: (key: string) => string): string | null {
  if (e instanceof ApiError) {
    if (e.code !== null && HANDLED_ELSEWHERE.has(e.code)) return null;
    if (e.code === "offline") return t("common.noConnection");
    if (e.code === "timeout") return t("support.ticketTimedOut");
    if (e.status >= 400 && e.status < 500 && e.message !== GENERIC_ERROR && e.message.trim() !== "") return e.message;
  }
  return t("common.genericError");
}
