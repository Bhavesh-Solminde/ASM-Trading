import { describe, expect, it } from "vitest";
import { beginProtectionEdit, protectionChanged, protectionPatch } from "./protection-edit";
describe("protection editing", () => {
  it("reopens from the newest server protection rather than the mount-time nulls", () => {
    const mounted = { stopLoss: null, takeProfit: null };
    const first = beginProtectionEdit(mounted);
    expect(first.stopLossText).toBe("");
    const updated = { stopLoss: 99, takeProfit: 110 };
    const reopened = beginProtectionEdit(updated);
    expect(reopened.stopLossText).toBe("99");
    expect(protectionPatch({ ...reopened, takeProfitText: "115" }, updated)).toEqual({ takeProfit: 115 });
  });
  it("sends only the explicit change so a TP edit cannot clear the unedited SL", () => {
    const current = { stopLoss: 99, takeProfit: 110 };
    expect(protectionPatch({ ...beginProtectionEdit(current), takeProfitText: "115" }, current)).toEqual({ takeProfit: 115 });
    expect(protectionPatch({ ...beginProtectionEdit(current), takeProfitText: "" }, current)).toEqual({ takeProfit: null });
    expect(protectionPatch(beginProtectionEdit(current), current)).toEqual({});
  });
  it("refuses submission if another client changes protection while the editor is open", () => {
    const draft = { ...beginProtectionEdit({ stopLoss: 99, takeProfit: 110 }), takeProfitText: "115" };
    const current = { stopLoss: 100, takeProfit: 110 };
    expect(protectionChanged(draft, current)).toBe(true);
    expect(protectionPatch(draft, current)).toBeNull();
    const reloaded = beginProtectionEdit(current);
    expect(protectionChanged(reloaded, current)).toBe(false);
    expect(reloaded.stopLossText).toBe("100");
  });
});
