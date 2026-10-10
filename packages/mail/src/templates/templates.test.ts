import { describe, expect, it } from "vitest";
import {
  certificateHtml,
  details,
  displayName,
  emailLayout,
  escapeHtml,
  formatDateLabel,
  formatDateTimeLabel,
  payToLabel,
  shortRef,
} from "./index";

describe("escapeHtml", () => {
  it("escapes markup and quotes", () => {
    expect(escapeHtml(`<a href="x">'</a>&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;&amp;");
  });
});

describe("emailLayout", () => {
  it("renders the wordmark, heading, body and button", () => {
    const html = emailLayout({
      preheader: "Preview line",
      heading: "Deposit credited",
      bodyHtml: "<p>Body</p>",
      cta: { label: "Start trading", url: "https://indianxtrade.com/trade" },
    });
    expect(html).toContain("INDIANXTRADE");
    expect(html).toContain("Deposit credited");
    expect(html).toContain("Preview line");
    expect(html).toContain('href="https://indianxtrade.com/trade"');
    expect(html).toContain("support@indianxtrade.com");
  });

  it("drops a button whose link is not http(s)", () => {
    const html = emailLayout({ preheader: "x", heading: "x", bodyHtml: "", cta: { label: "Go", url: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
  });
});

describe("details", () => {
  it("escapes labels and values", () => {
    const html = details([{ label: "Name", value: "<b>Asha</b>" }]);
    expect(html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
  });
});

describe("format helpers", () => {
  it("formats dates in IST, not UTC", () => {
    // 20:00 UTC on 10 Oct is 01:30 IST on 11 Oct.
    const d = new Date("2026-10-10T20:00:00Z");
    expect(formatDateLabel(d)).toBe("11 Oct 2026");
    expect(formatDateTimeLabel(d)).toBe("11 Oct 2026, 01:30 IST");
  });

  it("shortens a uuid to an 8-character reference", () => {
    expect(shortRef("8f3a21c9-1111-2222-3333-444455556666")).toBe("8F3A21C9");
  });

  it("labels the payout destination", () => {
    expect(payToLabel("UPI", "asha@okhdfc")).toBe("UPI · asha@okhdfc");
    expect(payToLabel("BANK", "HDFC0001234 ••6789")).toBe("Bank account · HDFC0001234 ••6789");
    expect(payToLabel("USDT", null)).toBe("USDT");
  });
});

describe("displayName", () => {
  it("prefers the full name", () => {
    expect(displayName({ firstName: "Rashmi", lastName: "Swain", nickname: "rx", email: "r@x.com" })).toBe("Rashmi Swain");
  });
  it("falls back to the nickname", () => {
    expect(displayName({ firstName: null, lastName: null, nickname: "AceTrader", email: "r@x.com" })).toBe("AceTrader");
  });
  it("falls back to the email local part", () => {
    expect(displayName({ firstName: null, lastName: null, nickname: null, email: "neo@x.com" })).toBe("neo");
  });
});

describe("certificateHtml", () => {
  const data = { name: "Rashmi Swain", amountLabel: "₹500.00", dateLabel: "25 Sept 2026", refId: "8F3A21C9" };

  it("embeds the name, amount, date and reference", () => {
    const html = certificateHtml(data);
    for (const s of ["Rashmi Swain", "₹500.00", "25 Sept 2026", "8F3A21C9", "Proudly presented to"]) {
      expect(html).toContain(s);
    }
  });

  it("escapes HTML in the name", () => {
    const html = certificateHtml({ ...data, name: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("words the note for a request vs. a paid withdrawal", () => {
    expect(certificateHtml(data)).toContain("confirms a withdrawal request");
    expect(certificateHtml(data, "paid")).toContain("paid out by IndianxTrade");
    expect(certificateHtml(data)).not.toContain("original deposit method");
  });
});
