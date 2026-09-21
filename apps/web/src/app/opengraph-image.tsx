import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default social share card. Individual routes may override with their own
 *  opengraph-image; this is the site-wide fallback. Uses only system fonts to
 *  stay build-safe (no remote font fetch under the CSP). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(1000px 500px at 20% 0%, #2a2d33, #1e2024)",
          color: "#e8e6e1",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: "0.2em",
            color: "#ffb000",
          }}
        >
          ASM
        </div>
        <div
          style={{
            marginTop: 24,
            fontSize: 84,
            fontWeight: 800,
            lineHeight: 1.05,
            maxWidth: 900,
          }}
        >
          Trade every market.
        </div>
        <div style={{ marginTop: 20, fontSize: 34, color: "#9e9b95" }}>
          Fixed risk · up to 95% payout · free $10,000 demo
        </div>
      </div>
    ),
    { ...size },
  );
}
