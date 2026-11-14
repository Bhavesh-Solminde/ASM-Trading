// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReferralClient } from "./ReferralClient";

afterEach(cleanup);

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
      }),
    );
    expect(screen.getByText("Up to 50% RevShare")).toBeTruthy();

    const expected: [string, string, string, string][] = [
      ["Total Referrals", "7", "text-xl font-bold tracking-tight text-ink", "Registered users"],
      ["Active Traders", "2", "text-xl font-bold tracking-tight text-ink", "Funded accounts"],
      ["Total Earned", "₹1,250.00", "text-xl font-bold tracking-tight text-up", "View earnings & withdraw →"],
      ["Current Tier", "50%", "text-xl font-bold tracking-tight text-brand", "Top VIP tier"],
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
    expect(card("Current Tier").tagName).toBe("DIV");
  });
});
