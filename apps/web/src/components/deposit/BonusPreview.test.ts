// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BonusPreview } from "./BonusPreview";

vi.mock("@/components/shell/PromoBanner", () => ({ BonusOfferSheet: () => null }));

afterEach(cleanup);

describe("deposit bonus preview", () => {
  it("shows the ordinary first-deposit bonus for a regular user", () => {
    render(createElement(BonusPreview, { amountInr: 500, completedDeposits: 0 }));
    expect(screen.getByRole("heading").textContent).toContain("+100% bonus");
    expect(screen.queryByText(/a friend invited you/)).toBeNull();
  });

  it("shows the invited friend's 110% total and why", () => {
    render(createElement(BonusPreview, { amountInr: 500, completedDeposits: 0, extraPercent: 10 }));
    expect(screen.getByRole("heading").textContent).toContain("+110% bonus");
    expect(screen.getByText(/your money \+/).textContent).toContain("550");
    expect(screen.getByText("Includes an extra 10% because a friend invited you.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Bonus tiers" }).textContent).toContain("110%");
  });
});
