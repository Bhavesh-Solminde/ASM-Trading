import { connection } from "next/server";
import { TradeWorkspace } from "@/components/trade/TradeWorkspace";

// Accounts, assets and recent trades are loaded once by the platform layout.
export default async function TradePage() {
  await connection();
  const tradingModel = process.env.TRADING_MODEL === "CFD" ? "CFD" : "BINARY";
  return <TradeWorkspace tradingModel={tradingModel} />;
}
