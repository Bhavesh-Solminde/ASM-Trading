// permission-moment.ts
export function shouldAskPermission(s: {
  asked: boolean;
  status: "granted" | "denied" | "undetermined";
  event: "live_trade_settled" | "deposit_created" | "other";
}): boolean {
  return !s.asked && s.status === "undetermined" && s.event !== "other";
}
