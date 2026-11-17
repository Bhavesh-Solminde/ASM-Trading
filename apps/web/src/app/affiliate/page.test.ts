import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ extra: 10 }));
vi.mock("@asm/db", () => ({
  BONUS_TIERS: [100, 100, 50, 50],
  attachReferralAtSignup: vi.fn(),
  getProgramSettings: async () => ({ values: { INVITE_EXTRA_BONUS_PCT: settings.extra } }),
}));
vi.mock("@/components/content/ContentShell", () => ({ ContentShell: ({ children }: { children: React.ReactNode }) => children }));

import AffiliateLandingPage, { generateMetadata } from "./page";

describe("/affiliate landing", () => {
  it("leads with the first-deposit bonus computed from the ordinary tier plus the invite extra in force", async () => {
    const html = renderToStaticMarkup(await AffiliateLandingPage());
    expect(html).toContain("Your friend gets a 110% first-deposit bonus");
    expect(html).not.toMatch(/enhanced/i);
    expect((await generateMetadata()).description).toContain("110% first-deposit bonus");

    settings.extra = 25;
    expect(renderToStaticMarkup(await AffiliateLandingPage())).toContain("Your friend gets a 125% first-deposit bonus");
  });
});
