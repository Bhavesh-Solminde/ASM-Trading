/** Local verification only: real CFD commands against a disposable DB and fixed fixture prices. */
import { prisma } from "@asm/db";
import { CfdDesk } from "../src/trading/cfd-desk";
import { createInternalApi } from "../src/internal-api";
const url = new URL(process.env.DATABASE_URL ?? "http://missing");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/asm_dashboard_verify") throw new Error("Disposable dashboard verification database required.");
const assets = await prisma.asset.findMany({ where: { isOpen: true }, select: { symbol: true, id: true, basePrice: true } });
const prices = new Map<string, number>();
for (const a of assets) { const candle = await prisma.candle.findFirst({ where: { assetId: a.id, timeframe: "1m" }, orderBy: { openTs: "desc" }, select: { c: true } }); prices.set(a.symbol, candle?.c ?? a.basePrice); }
const api = createInternalApi({ desk: { open: async () => { throw new Error("CFD verification only"); } }, secret: process.env.ENGINE_INTERNAL_SECRET ?? "", port: Number(process.env.ENGINE_HTTP_PORT ?? 4102), tradingModel: "CFD", cfdDesk: new CfdDesk(), shownMidPrice: symbol => prices.get(symbol) ?? 0, marketStatus: symbol => prices.has(symbol) ? "open" : "unavailable" });
await api.listen();console.log("Local verification API: fixed fixture quotes, real CFD validation/persistence; no external feeds or payment services.");
async function stop() { await api.close(); await prisma.$disconnect(); }
process.once("SIGINT", () => void stop());process.once("SIGTERM", () => void stop());
