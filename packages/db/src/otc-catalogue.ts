import { MULTI_MARKETS } from "@asm/market-sim";

/** The order-book mode's asset rows come from its shared 30-market catalogue. */
export const OTC_MARKETS = MULTI_MARKETS.map(m=>({
  symbol:m.symbol,displayName:m.name,kind:"OTC" as const,
  assetClass:({Crypto:"CRYPTO",Forex:"FOREX",India:"INDEX",Commodities:"COMMODITY"} as const)[m.group],
  basePrice:m.base,precision:m.precision,tickSize:10**-m.precision,
  payoutPct:92,payoutMin:92,payoutMax:92,
  // Compatibility metadata only. Order-book volatility uses minuteBps, not MSM.
  msmSigma:m.minuteBps/10000/Math.sqrt(60),msmM0:1.5,
  intradayProfile:({Crypto:"CRYPTO",Forex:"FX_MAJOR",India:"INDEX",Commodities:"METAL"} as const)[m.group],
  feedSource:"SYNTHETIC" as const,
}));
