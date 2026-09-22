import type { Article } from "./types";
import { SITE_NAME } from "@/lib/site";

/* Guide articles — high-intent, double-duty pages. Each ranks for a real query
 * and carries HowTo/FAQ schema so it can be quoted by AI answer engines.
 * Facts here mirror the platform's marketing data (min deposit, demo size,
 * payouts) — keep them in sync if the product changes. */

export const guides: Article[] = [
  {
    slug: "how-trading-works",
    collection: "guides",
    title: "How Trading Works",
    description:
      "A plain-English guide to how a fixed-risk Up/Down trade is priced, how payouts are calculated, the risks, and how to practice safely on a demo.",
    updated: "2026-09-22",
    keywords: [
      "how it works",
      "up or down trading",
      "fixed payout trading",
    ],
    sections: [
      {
        heading: "What a fixed-risk trade is",
        blocks: [
          {
            kind: "p",
            text: "A fixed-risk trade is a bet on which way a price will move over a set time. You pick an asset — a currency pair, a crypto, a commodity or a stock — choose a direction (UP or DOWN) and a duration (from 15 seconds to end-of-day), and stake an amount. When the timer ends, the trade settles on the market price at that tick.",
          },
          {
            kind: "p",
            text: "There are only two outcomes. If the market finished on your side, you win a fixed payout. If it did not, you lose the amount you staked — never more than that. You know both numbers before you click.",
          },
        ],
      },
      {
        heading: "How the payout is calculated",
        blocks: [
          {
            kind: "p",
            text: "Each asset shows a payout percentage before you trade. A winning trade returns your stake plus that percentage as profit; a losing trade returns nothing.",
          },
          {
            kind: "list",
            items: [
              "Stake $10 at a 93% payout and win: you receive $19.30 — your $10 back plus $9.30 profit.",
              "Stake $10 and lose: you lose the $10 stake and nothing else.",
              "There is no per-trade commission; the payout percentage is the platform's only revenue on a winning trade.",
            ],
          },
        ],
      },
      {
        heading: "The risks you should understand",
        blocks: [
          {
            kind: "p",
            text: "This is high-risk, short-term speculation, not investing. Most short-term traders lose money. Because outcomes are all-or-nothing, losses accumulate quickly if you over-stake or chase them.",
          },
          {
            kind: "list",
            items: [
              "Only trade money you can afford to lose entirely.",
              "Fix your stake size in advance and do not increase it to recover a loss.",
              "Availability is restricted in some jurisdictions — your eligibility is checked at sign-up.",
            ],
          },
        ],
      },
      {
        heading: `Practising safely on ${SITE_NAME}`,
        blocks: [
          {
            kind: "p",
            text: `On ${SITE_NAME} you can open a free demo account funded with $10,000 in practice money — no card, no deposit. It uses the same live streaming prices and settlement engine as a live account, so you can learn how expiries and payouts behave before risking anything.`,
          },
        ],
      },
    ],
    faqs: [
      {
        q: "Is trading gambling?",
        a: "It shares features with gambling — fixed risk, short time horizon, all-or-nothing outcomes — and should be treated with the same caution. It is not a savings or investment product. Only stake money you can afford to lose.",
      },
      {
        q: "How much can I lose on a single trade?",
        a: "Never more than the amount you stake. If a $10 trade loses, you lose exactly $10. There is no leverage or margin call that can take more than your stake.",
      },
      {
        q: "Can I practise without depositing money?",
        a: `Yes. ${SITE_NAME} gives every new account a free $10,000 demo balance using real market prices. You can reset it and switch to a live account whenever you are ready.`,
      },
    ],
  },
  {
    slug: "how-to-deposit",
    collection: "guides",
    title: `How to Deposit on ${SITE_NAME}`,
    description: `Step-by-step: how to fund your ${SITE_NAME} account with UPI, bank transfer, card or crypto. Minimum deposit, timing, and answers to the most common deposit questions.`,
    updated: "2026-09-22",
    keywords: [
      "asm trade deposit",
      "how to deposit",
      "upi deposit trading",
      "minimum deposit",
    ],
    sections: [
      {
        heading: "Deposit methods",
        blocks: [
          {
            kind: "p",
            text: "You can fund a live account with local and global rails. Available methods depend on your country and are shown at checkout.",
          },
          {
            kind: "list",
            items: [
              "UPI and local bank transfer — the fastest options in India, Bangladesh and Pakistan.",
              "Debit/credit card.",
              "Crypto (USDT and others) for wallet-to-platform transfers.",
            ],
          },
        ],
      },
      {
        heading: "Minimum deposit and fees",
        blocks: [
          {
            kind: "list",
            items: [
              "Minimum deposit is $10 on card and bank transfer, $20 on crypto.",
              "Deposits are free on most rails — no platform fee is added.",
              "The minimum live trade size is $1, so a small first deposit is enough to start.",
            ],
          },
        ],
      },
    ],
    howTo: {
      name: `Deposit funds on ${SITE_NAME}`,
      description: "Fund a live account in a few steps.",
      steps: [
        {
          title: "Open the Deposit page",
          body: "Log in and open Deposit from the main menu.",
        },
        {
          title: "Choose an amount and method",
          body: "Enter an amount (from $10) and pick UPI, bank transfer, card or crypto.",
        },
        {
          title: "Complete the payment",
          body: "Follow your provider's confirmation. UPI and card deposits usually credit within seconds.",
        },
        {
          title: "Start trading",
          body: "Your live balance updates automatically once the payment confirms.",
        },
      ],
    },
    faqs: [
      {
        q: "What is the minimum deposit?",
        a: "$10 on card and bank transfer, $20 on crypto.",
      },
      {
        q: "How long does a deposit take?",
        a: "UPI and card deposits typically credit within seconds. Bank transfers can take longer depending on your bank. Crypto credits after network confirmation.",
      },
      {
        q: "Are there deposit fees?",
        a: "No platform fee is charged on deposits on most rails. Your bank or card issuer may apply its own charges.",
      },
    ],
  },
  {
    slug: "how-to-withdraw",
    collection: "guides",
    title: `How to Withdraw on ${SITE_NAME}`,
    description: `How to withdraw your balance from ${SITE_NAME}: methods, timing, verification, and why withdrawals are processed the way they are. Clear answers for first-time withdrawals.`,
    updated: "2026-09-22",
    keywords: [
      "asm trade withdrawal",
      "how to withdraw",
      "withdrawal time",
      "trading withdrawal",
    ],
    sections: [
      {
        heading: "How withdrawals work",
        blocks: [
          {
            kind: "p",
            text: "You can request a withdrawal of your available balance at any time. Funds are returned to a verified method — usually the same rail you deposited with, which is standard anti-fraud practice across regulated finance.",
          },
          {
            kind: "list",
            items: [
              "Bank and card withdrawals typically settle within one business day of approval.",
              "Crypto withdrawals are usually confirmed within an hour once approved.",
              "Nothing is locked — unspent deposits can be withdrawn without trading first.",
            ],
          },
        ],
      },
      {
        heading: "Verification",
        blocks: [
          {
            kind: "p",
            text: "First withdrawals may require identity verification (KYC). This protects your account and is required to prevent fraud and money laundering. Completing it once speeds up every later withdrawal.",
          },
        ],
      },
    ],
    howTo: {
      name: `Withdraw funds from ${SITE_NAME}`,
      steps: [
        {
          title: "Open the Withdrawal page",
          body: "Log in and open Withdrawal from the main menu.",
        },
        {
          title: "Enter an amount and destination",
          body: "Choose how much to withdraw and select a verified bank, card or crypto destination.",
        },
        {
          title: "Confirm and wait for approval",
          body: "Submit the request. You will be notified when it is approved and sent.",
        },
      ],
    },
    faqs: [
      {
        q: "How long do withdrawals take?",
        a: "Bank and card withdrawals typically settle within one business day of approval; crypto usually within an hour.",
      },
      {
        q: "Why do I need to verify my identity?",
        a: "Identity verification (KYC) is a standard anti-fraud and anti-money-laundering requirement. It protects your funds and is usually only needed once.",
      },
      {
        q: "Can I withdraw a deposit I haven't traded?",
        a: "Yes. Unspent deposits are not locked and can be withdrawn, subject to verification.",
      },
    ],
  },
  {
    slug: "demo-account",
    collection: "guides",
    title: `The Free ${SITE_NAME} Demo Account`,
    description: `Learn to trade with zero risk on the ${SITE_NAME} demo: $10,000 in practice funds, real market prices, resettable balance, and no card required. How it works and how to switch to live.`,
    updated: "2026-09-22",
    keywords: [
      "free demo account",
      "demo account",
      "practice trading account",
      "asm trade demo",
    ],
    sections: [
      {
        heading: "What the demo gives you",
        blocks: [
          {
            kind: "list",
            items: [
              "$10,000 in practice funds the moment you sign up — no card, no deposit, no verification.",
              "The same live streaming prices and settlement engine as a live account.",
              "A resettable balance so you can start a fresh practice run whenever you want.",
            ],
          },
        ],
      },
      {
        heading: "Why start on the demo",
        blocks: [
          {
            kind: "p",
            text: "The demo is the safest way to learn how expiries, payouts and the Up/Down mechanics behave. Test a strategy on OTC pairs over a weekend, get comfortable with the mobile Up/Down bar, and only move to a live account once your approach is consistent.",
          },
        ],
      },
    ],
    faqs: [
      {
        q: "Is the demo account really free?",
        a: "Yes. Sign up with an email and get $10,000 in demo funds — no card and no verification required.",
      },
      {
        q: "Do demo prices match the live market?",
        a: "Yes. The demo streams the same live prices from the same engine as live accounts, so what you practise reflects real market behaviour.",
      },
      {
        q: "How do I switch from demo to live?",
        a: "Use the account switcher any time. Fund a live account from $10 when you are ready; your demo stays available alongside it.",
      },
    ],
  },
];
