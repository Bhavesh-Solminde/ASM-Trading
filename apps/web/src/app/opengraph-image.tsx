import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The transparent wordmark (no black box to show at its edges). Read once at
// module scope — it never changes per request.
const wordmark = `data:image/png;base64,${await readFile(
  join(process.cwd(), "public/brand/indianxtrade-wordmark.png"),
  "base64",
)}`;

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
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#e8e6e1",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
        <img src={wordmark} width={1000} height={253} alt="" />
        <div style={{ marginTop: 28, fontSize: 40, color: "#9e9b95" }}>
          Fixed risk · up to 95% payout · free $10,000 demo
        </div>
      </div>
    ),
    { ...size },
  );
}
