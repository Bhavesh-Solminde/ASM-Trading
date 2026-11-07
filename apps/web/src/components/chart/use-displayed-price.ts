"use client";

import { useLayoutEffect } from "react";
import { useMarket, type MarketStore } from "@/components/shell/market-store";

/** Capture the committed readout, rather than a newer unpainted market update. */
export function useDisplayedPrice(market:MarketStore, symbol:string, precision:number) {
  const price=useMarket(market,s=>(s.chart.symbol===symbol?s.chart.lastPrice:null)??s.quotes[symbol]?.price??null);
  const quote=useMarket(market,s=>s.otc?.symbol===symbol?s.otc.displayQuote:null);
  useLayoutEffect(()=>{
    market.markDisplayedQuote(symbol,price,precision,quote);
  },[market,symbol,price,precision,quote]);
  return price;
}
