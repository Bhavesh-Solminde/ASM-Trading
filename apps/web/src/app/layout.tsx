import type { Metadata, Viewport } from "next";
import { Doto, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";
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

const homeTitle = `${SITE_NAME} — Binary Options Trading Platform`;

export const metadata: Metadata = {
  ...buildMetadata({ path: "/" }),
  // Homepage keeps a bespoke title (no brand suffix appended twice) that leads
  // with the entity name for brand queries.
  title: homeTitle,
  applicationName: SITE_NAME,
  openGraph: { ...buildMetadata({ path: "/" }).openGraph, title: homeTitle },
  twitter: { ...buildMetadata({ path: "/" }).twitter, title: homeTitle },
  ...(gscVerification ? { verification: { google: gscVerification } } : {}),
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
      </body>
    </html>
  );
}
