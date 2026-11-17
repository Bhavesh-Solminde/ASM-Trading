// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReasonForm, SettingEditForm } from "./program-ui";

afterEach(cleanup);
const action = vi.fn(async () => {});

describe("SettingEditForm", () => {
  it("is a closed in-row panel that posts key, value, effective time and a required reason", () => {
    const { container } = render(
      createElement(SettingEditForm, {
        action,
        settingKey: "DEFAULT_REVENUE_SHARE_BPS",
        label: "Default Revenue Share",
        unit: "bps",
        current: "0",
        cancelHref: "/admin/affiliate-program?tab=settings",
      }),
    );
    const details = container.querySelector("details.admin-reject")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Edit").className).toBe("admin-btn admin-btn--sm admin-btn--ghost");
    const form = details.querySelector("form")!;
    expect(new FormData(form).get("key")).toBe("DEFAULT_REVENUE_SHARE_BPS");
    const value = screen.getByLabelText("New value (%)") as HTMLInputElement;
    expect([value.name, value.value, value.required]).toEqual(["value", "0", true]);
    expect((screen.getByLabelText(/effective from/i) as HTMLInputElement).type).toBe("datetime-local");
    expect((screen.getByLabelText("Reason") as HTMLInputElement).required).toBe(true);
    expect(screen.getByText("Cancel").getAttribute("href")).toBe("/admin/affiliate-program?tab=settings");
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("submit");
  });

  it("uses an On/Off picker for switches", () => {
    render(createElement(SettingEditForm, { action, settingKey: "AFFILIATE_REQUIRES_APPROVAL", label: "x", unit: "bool", current: "0", cancelHref: "/" }));
    const select = screen.getByLabelText("New value") as HTMLSelectElement;
    expect([select.tagName, select.value]).toEqual(["SELECT", "0"]);
  });
});

describe("ReasonForm", () => {
  it("keeps field ids unique when Reject and Approve share a row and field name", () => {
    const common = { action, hidden: { withdrawalId: "w1" }, field: "reason", submit: "Go" } as const;
    render(
      createElement("div", null,
        createElement(ReasonForm, { ...common, button: "Reject", tone: "danger", label: "Reason shown to the user" }),
        createElement(ReasonForm, { ...common, button: "Approve", tone: "pos", label: "Reason for approval" }),
      ),
    );
    const reject = screen.getByLabelText("Reason shown to the user");
    const approve = screen.getByLabelText("Reason for approval");
    expect(reject.id).not.toBe(approve.id);
    expect((approve as HTMLInputElement).required).toBe(true);
  });
});
