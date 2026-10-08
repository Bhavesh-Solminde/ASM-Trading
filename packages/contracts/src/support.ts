import { z } from "zod";

export const CreateTicketSchema = z.strictObject({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4_000),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const FAQ = [
  {
    q: "How do I withdraw money from the account?",
    a: "First verify your identity once (Account → Verify now: your details, Aadhaar + PAN photos and a selfie). Then open Withdrawal, enter an amount within your available balance, and choose a method you have already deposited with. Requests are processed within 5–10 hours.",
  },
  {
    q: "How long does it take to withdraw funds?",
    a: "Within 5–10 hours of your request.",
  },
  {
    q: "What is the minimum withdrawal amount?",
    a: "$1.00 in this build.",
  },
  {
    q: "Is there a fee for depositing or withdrawing?",
    a: "No platform fee. The deposit conversion rate includes a spread, which is where a real processor takes its margin.",
  },
  {
    q: "Why is my bonus not withdrawable?",
    a: "A 100% deposit bonus carries a 3× turnover requirement. Until that trading volume is reached, bonus funds stay separate from your withdrawable balance.",
  },
  {
    q: "What is account verification?",
    a: "Verification confirms who you are before money leaves the platform. Fill in every field under Account → Personal data and save — your details go to review, and withdrawals unlock once the account shows Verified.",
  },
  {
    q: "Why does my deposit say Processing?",
    a: "A deposit is confirmed by matching the exact amount against the receiving account. Until that match is found it stays in Processing, which can take up to 48 hours.",
  },
  {
    q: "Is this a real trading platform?",
    a: "No. ASM Trade is a demonstration of how manipulated trading platforms operate. No real money is involved and no order reaches any market.",
  },
] as const;
