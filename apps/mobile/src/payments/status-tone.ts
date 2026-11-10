import { statusTone, type Tone } from "@asm/client-core";
import type { color } from "@/theme/tokens";

/** The tone a `StatusTag` takes for a server status (DepositStatus, WithdrawalStatus or TradeStatus). Unknown values are neutral. */
export function statusTagTone(status: string): Tone {
  return statusTone(status);
}

type InkKey = keyof typeof color;

const INK: Record<Tone, InkKey> = { up: "up", caution: "accentText", down: "downText", neutral: "ink2" };

/** The token a tag's label is drawn in. `gold` is deliberately not here: it stays bonus-only. */
export function tagInkKey(tone: Tone): InkKey {
  return INK[tone];
}
