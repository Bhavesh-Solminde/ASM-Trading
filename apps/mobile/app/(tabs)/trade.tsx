import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useBootstrap } from "@/api/queries";
import { Chart } from "@/chart/Chart";
import { useSocket } from "@/socket/socket-store";
import { space } from "@/theme/tokens";
import { Screen, Txt } from "@/theme/ui";

const loadOlder = () => useSocket.getState().loadOlder();

/** Dev screen for the chart (Task 11); the real Trade screen replaces it. */
export default function Trade() {
  const { t } = useTranslation();
  const boot = useBootstrap(true).data;
  const chart = useSocket((s) => s.chart);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const symbol = boot?.defaultSymbol;
  useEffect(() => {
    if (symbol) useSocket.getState().subscribe(symbol, "1m");
  }, [symbol]);

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const precision = boot?.assets.find((a) => a.symbol === symbol)?.precision ?? 2;

  return (
    <Screen>
      <Txt variant="title" accessibilityRole="header" style={{ padding: space(4) }}>
        {t("tabs.trade")}
      </Txt>
      <View style={{ flex: 1 }}>
        <Chart
          type="candles"
          candles={chart.candles}
          forming={chart.forming}
          lastPrice={chart.lastPrice}
          precision={precision}
          openTrades={[]}
          nowSec={nowSec}
          onNearLeftEdge={loadOlder}
        />
      </View>
    </Screen>
  );
}
