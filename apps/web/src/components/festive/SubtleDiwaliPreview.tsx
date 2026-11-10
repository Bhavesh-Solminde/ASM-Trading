"use client";

import { SeasonalDiwali, FestiveLights, DiwaliEntry, DiwaliWish } from "./SeasonalDiwali";
import { LogoWordmark } from "@/components/brand/Logo";

export function SubtleDiwaliPreview() {
  return <SeasonalDiwali preview><div style={{ minHeight: "100%", background: "var(--color-ground)", display: "flex", flexDirection: "column" }}>
    <header style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--color-rule)", gap: 8 }}>
      <FestiveLights /><LogoWordmark compact className="h-6 max-w-[45%]" /><DiwaliEntry compact />
    </header>
    <section style={{ padding: "32px 20px", flex: 1 }}>
      <p style={{ color: "var(--color-ink-2)", fontSize: 12 }}>Preview · No orders are placed</p>
      <h2 style={{ fontSize: 20, marginTop: 24 }}>BTC / USD</h2>
      <p style={{ color: "var(--color-ink-2)", fontSize: 13 }}>Illustrative market chart</p>
      <svg viewBox="0 0 900 350" style={{ width: "100%", height: 300 }} role="img" aria-label="Illustrative market chart">
        <path d="M0 290 L60 280 90 210 150 190 175 220 235 180 300 195 360 155 420 145 480 165 540 145 600 110 660 100 720 110 780 80 840 55 900 45" fill="none" stroke="var(--color-up)" strokeWidth="3" />
      </svg>
      <DiwaliEntry />
    </section>
    <footer style={{ padding: 20 }}><DiwaliWish /></footer>
  </div></SeasonalDiwali>;
}
