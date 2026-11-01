export interface Protection {
  stopLoss: number | null;
  takeProfit: number | null;
}
export interface ProtectionDraft {
  baseline: Protection;
  stopLossText: string;
  takeProfitText: string;
}
/** Begin from the latest server position on every opening, never a component's mount-time copy. */
export function beginProtectionEdit(value: Protection): ProtectionDraft {
  return { baseline: { stopLoss: value.stopLoss, takeProfit: value.takeProfit }, stopLossText: value.stopLoss?.toString() ?? "", takeProfitText: value.takeProfit?.toString() ?? "" };
}
export function protectionChanged(draft: ProtectionDraft, current: Protection): boolean {
  return current.stopLoss !== draft.baseline.stopLoss || current.takeProfit !== draft.baseline.takeProfit;
}
export function protectionPatch(draft: ProtectionDraft, current: Protection): Partial<Protection> | null {
  if (protectionChanged(draft, current)) return null;
  const parse = (text: string) => !text.trim() ? null : /^\d+(\.\d+)?$/.test(text) && Number.isFinite(Number(text)) && Number(text) > 0 ? Number(text) : NaN;
  const stopLoss = parse(draft.stopLossText), takeProfit = parse(draft.takeProfitText);
  if (Number.isNaN(stopLoss) || Number.isNaN(takeProfit)) return null;
  return { ...(stopLoss !== draft.baseline.stopLoss ? { stopLoss } : {}), ...(takeProfit !== draft.baseline.takeProfit ? { takeProfit } : {}) };
}
