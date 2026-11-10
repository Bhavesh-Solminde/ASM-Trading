/** Adds supported instruments without changing existing prices, pauses, payouts, users or trades. */
import { prisma } from "../src/client";
import { MARKETS } from "../src/catalogue";
import { MARKET_CALIBRATIONS } from "@asm/pricing";

async function main() {
  const data = MARKETS.map(market => {
    const calibration = MARKET_CALIBRATIONS.find(c => c.symbol === market.symbol);
    if (!calibration) throw new Error(`Missing calibration: ${market.symbol}`);
    return { ...market, isOpen: true, payoutPct: 93, payoutMin: 60, payoutMax: 93,
      msmSigma: calibration.sigma, msmM0: calibration.m0, intradayProfile: calibration.profile };
  });
  await prisma.$transaction(data.map(market => prisma.asset.upsert({ where: { symbol: market.symbol }, update: {}, create: market })));
  const count = await prisma.asset.count({ where: { symbol: { in: MARKETS.map(m => m.symbol) } } });
  console.log(`Catalogue sync complete: ${count}/${MARKETS.length} supported instruments present. Existing instruments were preserved.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Catalogue sync failed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
