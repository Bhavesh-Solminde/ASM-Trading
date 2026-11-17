// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReferralClient } from "./ReferralClient";

afterEach(cleanup);

const TERMS = { reward: "₹75", minDeposit: "₹1,500", minTrade: "₹250", friendBonusPct: 115 };
const CARD = "flex flex-col gap-1 rounded-xl border border-rule bg-panel p-4";

function card(label: string): HTMLElement {
  return screen.getByText(label).parentElement!;
}

describe("/referral stat cards", () => {
  it("keeps the existing cards and copy, with real values", () => {
    render(
      createElement(ReferralClient, {
        referralCode: "ABCD2345",
        referralUrl: "https://x.test/invite/ABCD2345",
        stats: { totalReferrals: 7, activeTraders: 2, totalEarned: "₹1,250.00" },
        terms: TERMS,
      }),
    );

    const expected: [string, string, string, string][] = [
      ["Total Referrals", "7", "text-xl font-bold tracking-tight text-ink", "Registered users"],
      ["Active Traders", "2", "text-xl font-bold tracking-tight text-ink", "Funded accounts"],
      ["Total Earned", "₹1,250.00", "text-xl font-bold tracking-tight text-up", "View earnings & withdraw →"],
      ["Your Reward", "₹75", "text-xl font-bold tracking-tight text-brand", "Per qualified friend"],
    ];
    for (const [label, value, valueClass, note] of expected) {
      const el = card(label);
      expect(el.className).toBe(CARD);
      const [l, v, n] = Array.from(el.children) as HTMLElement[];
      expect(l!.className).toBe("text-[10px] font-semibold uppercase tracking-wider text-ink-3");
      expect([v!.textContent, v!.className]).toEqual([value, valueClass]);
      expect([n!.textContent, n!.className]).toEqual([note, "text-[10px] text-ink-3"]);
    }

    // Only Total Earned became a link, with the same classes as the other cards.
    expect(card("Total Earned").tagName).toBe("A");
    expect(card("Total Earned").getAttribute("href")).toBe("/referral/earnings");
    expect(card("Total Referrals").tagName).toBe("DIV");
    expect(card("Your Reward").tagName).toBe("DIV");
  });

  it("states the real rules with the configured numbers and no revenue-share, tier or binary wording", () => {
    const { container } = render(
      createElement(ReferralClient, {
        referralCode: "ABCD2345",
        referralUrl: "https://x.test/invite/ABCD2345",
        stats: { totalReferrals: 0, activeTraders: 0, totalEarned: "₹0.00" },
        terms: TERMS,
      }),
    );
    const text = container.textContent!;
    expect(screen.getByRole("heading", { name: "Your friend gets a 115% first-deposit bonus" })).toBeTruthy();
    expect(text).toContain("₹75 per qualified friend");
    expect(text).toContain("at least ₹1,500 and a settled live trade of at least ₹250");
    expect(text).toContain("pending until the day closes (midnight IST)");
    for (const banned of [/rev\s*share/i, /revenue/i, /tier/i, /VIP/i, /binary/i, /instant/i, /commission/i, /50%/]) {
      expect(text).not.toMatch(banned);
    }
  });
});
