import { describe, expect, it } from "vitest";
import { certificateHtml, certificateName } from "./certificate";

describe("certificateName", () => {
  it("prefers the full name", () => {
    expect(
      certificateName({ firstName: "Rashmi", lastName: "Swain", nickname: "rx", email: "r@x.com" }),
    ).toBe("Rashmi Swain");
  });

  it("falls back to the nickname when no name is set", () => {
    expect(
      certificateName({ firstName: null, lastName: null, nickname: "AceTrader", email: "r@x.com" }),
    ).toBe("AceTrader");
  });

  it("falls back to the email local part when nothing else is set", () => {
    expect(certificateName({ firstName: null, lastName: null, nickname: null, email: "neo@x.com" })).toBe(
      "neo",
    );
  });
});

describe("certificateHtml", () => {
  it("embeds the name, amount, date and reference", () => {
    const html = certificateHtml({
      name: "Rashmi Swain",
      amountLabel: "₹500.00",
      dateLabel: "25 Sept 2026",
      refId: "8F3A21C9",
    });
    expect(html).toContain("Rashmi Swain");
    expect(html).toContain("₹500.00");
    expect(html).toContain("25 Sept 2026");
    expect(html).toContain("8F3A21C9");
    expect(html).toContain("Proudly presented to");
  });

  it("escapes HTML in the name to prevent injection", () => {
    const html = certificateHtml({
      name: '<script>alert(1)</script>',
      amountLabel: "₹1.00",
      dateLabel: "25 Sept 2026",
      refId: "X",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
