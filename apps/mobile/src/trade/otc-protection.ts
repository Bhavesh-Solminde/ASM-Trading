export interface Protection {
  enabled: boolean;
  direction: "UP" | "DOWN";
  stopLoss: number | null;
  takeProfit: number | null;
}
export const EMPTY_PROTECTION: Protection = { enabled: false, direction: "UP", stopLoss: null, takeProfit: null };
export function initialProtection(price: number, precision: number, direction: Protection["direction"]): Protection {
  const gap = Math.max(price * .0015, 10 ** -precision * 5);
  const sign = direction === "UP" ? 1 : -1;
  return { enabled: true, direction, stopLoss: Number((price - sign * gap).toFixed(precision)), takeProfit: Number((price + sign * gap).toFixed(precision)) };
}
export function protectionValid(draft: Protection, direction: Protection["direction"], price: number) {
  if (!draft.enabled) return true;
  const { stopLoss: sl, takeProfit: tp } = draft;
  if (draft.direction !== direction || !sl || !tp || !Number.isFinite(sl) || !Number.isFinite(tp) || sl <= 0 || tp <= 0) return false;
  return direction === "UP" ? sl < price && tp > price : sl > price && tp < price;
}
