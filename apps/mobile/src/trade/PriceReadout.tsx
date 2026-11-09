import { useLayoutEffect } from "react";
import { useSocket } from "@/socket/socket-store";
import { color } from "@/theme/tokens";
import { Txt } from "@/theme/ui";
import { fmtPrice } from "@/chart/format-price";
import { commitDisplayedQuote, clearDisplayedQuote } from "./displayed-quote";

export function PriceReadout({ symbol, precision }: { symbol: string; precision: number }) {
  const chart = useSocket(s => s.chart);
  const quote = chart.symbol === symbol ? chart.displayQuote : null;
  const price = quote?.price ?? null;
  useLayoutEffect(() => {
    commitDisplayedQuote(quote && chart.generation ? { ...quote, symbol, timeframe: chart.timeframe, generation: chart.generation } : null);
    return clearDisplayedQuote;
  }, [quote, symbol, chart.timeframe, chart.generation]);
  return <Txt testID="displayed-price" font="fig" size={18} weight={600} color={color.ink}>{price === null ? "—" : fmtPrice(price, precision)}</Txt>;
}
