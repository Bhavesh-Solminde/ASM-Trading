import type { Metadata, Viewport } from "next";
import { Doto, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";
import { FirstVisitDiwali } from "@/components/festive/FirstVisitDiwali";
import {
  JsonLd,
  organizationSchema,
  websiteSchema,
} from "@/components/seo/JsonLd";

// Self-hosted by next/font: the CSP allows only same-origin stylesheets and
// fonts, so linking fonts.googleapis.com directly is blocked.
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken" });
const doto = Doto({ subsets: ["latin"], variable: "--font-doto" });

// Google Search Console verification: set NEXT_PUBLIC_GSC_VERIFICATION to the
// token from the "HTML tag" method. Renders a <meta> (no script), so the CSP
// is untouched. DNS verification is an alternative that needs nothing here.
const gscVerification = process.env.NEXT_PUBLIC_GSC_VERIFICATION;

const homeTitle = `${SITE_NAME} — SEBI Regulated CFD Trading Platform`;

export const metadata: Metadata = {
...buildMetadata({
    path: "/",
    keywords: [
      "CFD trading platform",
      "SEBI regulated trading",
      "forex CFD India",
      "crypto CFD trading",
      "NIFTY 50 CFD",
      "stop loss take profit",
      "leverage trading India",
      "real-time market prices",
      "online trading India",
      "IndianxTrade",
    ],
  }),
  title: homeTitle,
  applicationName: SITE_NAME,
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
    startupImage: [
      { url: "/icons/apple-splash-1170x2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-1179x2556.png", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-1290x2796.png", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-1125x2436.png", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/apple-splash-828x1792.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/icons/apple-splash-750x1334.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
  openGraph: {...buildMetadata({ path: "/" }).openGraph, title: homeTitle },
  twitter: {...buildMetadata({ path: "/" }).twitter, title: homeTitle },
...(gscVerification ? { verification: { google: gscVerification } }: {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1e2024",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${hanken.variable} ${doto.variable}`}>
      <body className="min-h-screen antialiased">
        {/* Site-wide entity graph — Organization + WebSite. */}
        <JsonLd data={[organizationSchema(), websiteSchema()]} />
        {children}
        <FirstVisitDiwali />
      </body>
    </html>
);
}
