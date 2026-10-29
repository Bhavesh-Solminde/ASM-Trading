import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { CertificateData } from "@asm/mail/templates";

/**
 * The "All Time Best Trader" reward certificate as a JPEG, for the withdrawal
 * paid email. The artwork is a fixed background with the name, amount and date
 * slots left blank; only those three are drawn here. Positions are pixels on
 * the 1536x1024 background, measured against the original design.
 */

const W = 1536;
const H = 1024;
const NAVY = "rgb(3,21,78)";
const BLUE = "rgb(10,74,185)";

const ASSETS = join(process.cwd(), "src/assets/certificate");
// Read once per process: neither file changes at runtime.
let assets: Promise<{ background: string; font: Buffer }> | undefined;
function loadAssets() {
  assets ??= Promise.all([readFile(join(ASSETS, "background.jpg")), readFile(join(ASSETS, "Inter-Bold.ttf"))]).then(
    ([bg, font]) => ({ background: `data:image/jpeg;base64,${bg.toString("base64")}`, font }),
  );
  return assets;
}

// Inter Bold advance widths (per 1000 em) for ASCII 32..126, used to shrink a
// long name until it fits the name pill. Other characters count as 700.
const ADVANCE =
  "224,287,507,636,653,973,658,301,351,351,546,666,284,455,285,375,661,409,612,632,666,610,633,563,631,633,285,290,665,666,665,565,1011,728,653,732,711,608,584,743,732,269,572,701,561,911,742,758,639,760,653,653,649,717,724,1015,716,708,648,352,375,352,473,476,326,565,612,569,612,576,383,613,602,257,257,563,257,896,602,595,612,612,388,538,367,602,574,833,556,575,544,453,358,453,666"
    .split(",")
    .map(Number);

const NAME_SIZE = 35;
const NAME_TRACKING = 2 / NAME_SIZE; // letter spacing as a fraction of the font size
// The name is centred at x=555; the person icon's divider sits at x=313.
const NAME_MAX_WIDTH = 460;
const NAME_MIN_SIZE = 18;

/** Largest font size (<= the design's 35px) at which the name fits the pill. */
export function nameFontSize(name: string): number {
  const chars = [...name];
  const em = chars.reduce((sum, ch) => sum + (ADVANCE[ch.charCodeAt(0) - 32] ?? 700), 0) / 1000;
  const width = (size: number) => size * (em + NAME_TRACKING * (chars.length - 1));
  let size = NAME_SIZE;
  while (size > NAME_MIN_SIZE && width(size) > NAME_MAX_WIDTH) size--;
  return size;
}

export async function renderCertificateJpeg(cert: CertificateData): Promise<Buffer> {
  const { background, font } = await loadAssets();
  const name = cert.name.toUpperCase();
  const nameSize = nameFontSize(name);
  const field = { position: "absolute", display: "flex", alignItems: "center", lineHeight: 1 } as const;

  const png = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", fontFamily: "Inter", fontWeight: 700 }}>
        <img src={background} width={W} height={H} alt="" style={{ position: "absolute", top: 0, left: 0 }} />
        <div
          style={{
            ...field,
            left: 255,
            width: 600,
            top: 446,
            height: 51,
            justifyContent: "center",
            color: NAVY,
            fontSize: nameSize,
            letterSpacing: nameSize * NAME_TRACKING,
          }}
        >
          {name}
        </div>
        <div style={{ ...field, left: 581, top: 602, height: 54, color: BLUE, fontSize: 34 }}>{cert.amountLabel}</div>
        <div style={{ ...field, left: 582, top: 668, height: 56, color: NAVY, fontSize: 30 }}>{cert.dateLabel}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "Inter", data: font, weight: 700, style: "normal" }] },
  );
  // Satori outputs PNG (~2 MB for this artwork); JPEG keeps the email light.
  return sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}
