import { describe, expect, it } from "vitest";
import {
  certificateHtml,
  depositCreditedEmail,
  passwordChangedEmail,
  passwordResetEmail,
  welcomeEmail,
  withdrawalPaidEmail,
  withdrawalRejectedEmail,
  withdrawalRequestedEmail,
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

describe("welcomeEmail", () => {
  it("greets by name and pitches the first-deposit bonus without wagering terms", () => {
    const { subject, html } = welcomeEmail({ name: "Asha", firstDepositBonusPercent: 100 });
    expect(subject).toBe("Welcome to IndianxTrade");
    expect(html).toContain("Hi Asha");
    expect(html).toContain("100% bonus");
    expect(html).not.toMatch(/wager|turnover|withdrawable/i);
  });
  it("leaves the bonus line out when there is no first-deposit bonus", () => {
    expect(welcomeEmail({ name: "Asha", firstDepositBonusPercent: 0 }).html).not.toContain("bonus");
  });
});

describe("password emails", () => {
  it("puts the reset link in the button and as plain text", () => {
    const url = "https://indianxtrade.com/reset-password?token=abc123";
    const { subject, html } = passwordResetEmail({ name: "Asha", resetUrl: url, ttlMinutes: 30 });
    expect(subject).toBe("Reset your IndianxTrade password");
    expect(html.split(url).length - 1).toBe(3); // button href, plain-link href, plain-link text
    expect(html).toContain("30 minutes");
  });
  it("tells the user when the password changed", () => {
    const { subject, html } = passwordChangedEmail({
      name: "Asha",
      changedAtLabel: "11 Oct 2026, 01:30 IST",
      resetUrl: "https://indianxtrade.com/forgot-password",
    });
    expect(subject).toBe("Your IndianxTrade password was changed");
    expect(html).toContain("11 Oct 2026, 01:30 IST");
    expect(html).toContain("signed you out");
  });
});

describe("depositCreditedEmail", () => {
  const base = { name: "Asha", creditLabel: "₹5,000.00", totalLabel: "₹10,000.00", dateLabel: "11 Oct 2026", refId: "D41C09AA" };
  it("shows the deposit, the bonus and the total", () => {
    const { subject, html } = depositCreditedEmail({ ...base, bonusLabel: "₹5,000.00" });
    expect(subject).toBe("₹5,000.00 added to your IndianxTrade account");
    expect(html).toContain("Bonus");
    expect(html).toContain("₹10,000.00");
    expect(html).not.toMatch(/wager|turnover|withdrawable/i);
  });
  it("has no bonus rows when no bonus was granted", () => {
    const { html } = depositCreditedEmail({ ...base, bonusLabel: null, totalLabel: "₹5,000.00" });
    expect(html).not.toContain("Bonus");
  });
});

describe("withdrawal emails", () => {
  it("confirms a request and promises the certificate on payout", () => {
    const { subject, html } = withdrawalRequestedEmail({
      name: "Asha", amountLabel: "₹2,500.00", payToLabel: "UPI · asha@okhdfc", held: false, refId: "8F3A21C9",
    });
    expect(subject).toBe("We've received your withdrawal request");
    expect(html).toContain("UPI · asha@okhdfc");
    expect(html).toContain("certificate");
    expect(html).toContain("Under review");
  });
  it("explains the first-withdrawal hold", () => {
    const { html } = withdrawalRequestedEmail({
      name: "Asha", amountLabel: "₹2,500.00", payToLabel: "UPI", held: true, refId: "8F3A21C9",
    });
    expect(html).toContain("On security hold");
  });
  it("embeds the paid-stage certificate", () => {
    const { subject, html } = withdrawalPaidEmail({
      certificate: { name: "Asha Rao", amountLabel: "₹2,500.00", dateLabel: "11 Oct 2026", refId: "8F3A21C9" },
      payToLabel: "UPI · asha@okhdfc",
    });
    expect(subject).toBe("Your withdrawal is paid. Here's your certificate");
    expect(html).toContain("Proudly presented to");
    expect(html).toContain("paid out by IndianxTrade");
  });
  it("gives the rejection reason and says the money is back", () => {
    const { html } = withdrawalRejectedEmail({
      name: "Asha", amountLabel: "₹2,500.00", reason: "The UPI ID couldn't receive the payment", refId: "8F3A21C9",
    });
    expect(html).toContain("The UPI ID couldn&#39;t receive the payment");
    expect(html).toContain("back in your balance");
  });
});
