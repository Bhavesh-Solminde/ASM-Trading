import { z } from "zod";

export const CreateTicketSchema = z.strictObject({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4_000),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

/**
 * One support ticket as `GET /api/support` sends it: `listTicketsForActor` returns the whole SupportTicket row, JSON
 * turns `createdAt` into an ISO string, and `userId` rides along (the caller's own id; dropped here, not needed).
 */
export const TicketSchema = z.object({
  id: z.string(),
  subject: z.string(),
  body: z.string(),
  status: z.enum(["OPEN", "ANSWERED", "CLOSED"]),
  createdAt: z.iso.datetime(),
});
export type TicketDto = z.infer<typeof TicketSchema>;

export const TicketsResponseSchema = z.object({ tickets: z.array(TicketSchema) });
export type TicketsResponseDto = z.infer<typeof TicketsResponseSchema>;

export const FAQ = [
  {
    q: "How do I withdraw money from the account?",
    a: "First verify your identity once (Account → Verify now: your details, Aadhaar + PAN photos and a selfie). Then open Withdrawal, enter an amount within your available balance, then choose Bank, UPI or USDT and add where to send it. Requests are processed within 5–10 hours.",
  },
  {
    q: "How long does it take to withdraw funds?",
    a: "Within 5–10 hours of your request.",
  },
  {
    q: "What is the minimum withdrawal amount?",
    a: "The minimum withdrawal is ₹700 for INR accounts and $6.36 for USD accounts at the current platform conversion rate. Check Withdrawal for your current limits before submitting.",
  },
  {
    q: "Is there a fee for depositing or withdrawing?",
    a: "The payment screen shows the amount and conversion before you submit. Currency conversion uses the platform rate of ₹110 = $1. Your bank, UPI app or crypto network may apply its own charges.",
  },
  {
    q: "Why is my bonus not withdrawable?",
    a: "A 100% deposit bonus carries a 3× turnover requirement. Until that trading volume is reached, bonus funds stay separate from your withdrawable balance.",
  },
  {
    q: "What is account verification?",
    a: "Verification confirms your identity before withdrawals. Open Account → Verify now, complete your details, upload the front and back of your Aadhaar, your PAN and a selfie, then submit for review. Withdrawals require a Verified status.",
  },
  {
    q: "Why does my deposit say Processing?",
    a: "A deposit is confirmed by matching the exact amount against the receiving account. Until that match is found it stays in Processing, which can take up to 48 hours.",
  },
  {
    q: "Is this a real trading platform?",
    a: "Live accounts use real funds; Demo accounts use practice funds. Prices are generated within the platform and trades are settled internally, rather than sent to an external exchange. Trading can result in losses.",
  },
] as const;
