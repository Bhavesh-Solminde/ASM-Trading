import { fmtPrice } from "@/chart/format-price";
import { countdownText } from "./countdown-text";

type T = (key: string, options?: Record<string, unknown>) => string;

/**
 * The words on the position strip. After the expiry `time` stays "Settling…" until the engine's result arrives
 * (never a frozen 0:00), and the spoken label switches to the settling wording.
 */
export function positionCopy(
  a: {
    live: { expired: boolean; remainingSec: number };
    direction: "UP" | "DOWN";
    name: string;
    /** Already formatted with the currency (money()). */
    stake: string;
    entryPrice: number;
    precision: number;
    /** Other open trades besides this one. */
    more: number;
  },
  t: T,
): { side: string; time: string; label: string; detail: string } {
  const { live, name, stake, more } = a;
  const side = a.direction === "UP" ? t("trade.up") : t("trade.down");
  const time = countdownText(live, t("trade.settling"));
  const moreText = more > 0 ? t("trade.moreOpen", { n: more }) : "";
  const spoken = live.expired ? t("trade.positionLabelSettling", { side, name, stake }) : t("trade.positionLabel", { side, name, stake, time });
  return {
    side,
    time,
    label: moreText ? `${spoken} ${moreText}` : spoken,
    detail: t("trade.at", { stake, price: fmtPrice(a.entryPrice, a.precision) }) + (moreText ? ` · ${moreText}` : ""),
  };
}
