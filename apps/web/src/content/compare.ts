import type { Article } from "./types";
import { SITE_NAME } from "@/lib/site";

/* Comparison articles — high commercial intent, and the pages AI assistants
 * pull recommendations from. Keep comparisons honest and specific: unverifiable
 * claims about a competitor are both an SEO and a legal liability in YMYL. */

export const comparisons: Article[] = [
  {
    slug: "asm-trader-vs-quotex",
    collection: "compare",
    title: `${SITE_NAME} vs Quotex`,
    description: `An honest, feature-by-feature comparison of ${SITE_NAME} and Quotex for short-term binary options traders in South Asia — minimum deposit, demo, payouts, payment methods and mobile experience.`,
    updated: "2026-09-22",
    keywords: [
      "asm trade vs quotex",
      "quotex alternative",
      "best binary options platform",
      "quotex comparison",
    ],
    sections: [
      {
        heading: "At a glance",
        blocks: [
          {
            kind: "p",
            text: `Quotex is a well-known short-term options platform. ${SITE_NAME} is built for the same kind of trader with a focus on a fast mobile Up/Down experience, transparent settlement and local deposit rails. This comparison sticks to what we can state factually about ${SITE_NAME}; always confirm a competitor's current terms on their own site before deciding.`,
          },
          {
            kind: "table",
            head: ["Feature", SITE_NAME, "Quotex"],
            rows: [
              ["Free demo", "$10,000, resettable, no card", "Yes"],
              ["Minimum deposit", "$10 (card/bank), $20 (crypto)", "Check current terms"],
              ["Minimum trade", "$1", "Check current terms"],
              ["Max payout", "Up to 95%", "Check current terms"],
              ["Local rails (UPI/bank)", "Yes", "Varies by region"],
              ["Mobile Up/Down bar", "Pinned, one-tap", "Yes"],
            ],
          },
        ],
      },
      {
        heading: `Where ${SITE_NAME} focuses`,
        blocks: [
          {
            kind: "list",
            items: [
              "A pinned one-tap Up/Down bar designed for phones, where most trading in the region happens.",
              "Local deposit rails (UPI and bank transfer) alongside card and crypto.",
              "An audited settlement ledger — every trade's open, close and settle tick is recorded and inspectable.",
              "A free, resettable $10,000 demo on the same engine as live trading.",
            ],
          },
        ],
      },
      {
        heading: "How to choose",
        blocks: [
          {
            kind: "p",
            text: "Both are short-term, high-risk platforms — most short-term traders lose money on either. Judge them on the things that actually affect you: whether your local deposit method is supported, how fast withdrawals clear, and how the mobile app feels. Start on each platform's free demo before funding anything.",
          },
        ],
      },
    ],
    faqs: [
      {
        q: `Is ${SITE_NAME} a good Quotex alternative?`,
        a: `${SITE_NAME} targets the same short-term trader with a $1 minimum trade, up to 95% payout, local UPI/bank deposits and a free resettable demo. Whether it is right for you depends on your country and preferred deposit method — try the demo first.`,
      },
      {
        q: "Which has lower fees?",
        a: `${SITE_NAME} charges no per-trade commission and no deposit fee on most rails; the payout percentage is its only revenue on winning trades. Compare against Quotex's current published terms before deciding.`,
      },
    ],
  },
];
