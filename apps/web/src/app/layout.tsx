import type { Metadata, Viewport } from "next";
import { Doto, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Self-hosted by next/font: the CSP allows only same-origin stylesheets and
// fonts, so linking fonts.googleapis.com directly is blocked.
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken" });
const doto = Doto({ subsets: ["latin"], variable: "--font-doto" });

export const metadata: Metadata = {
  title: "ASM Trade",
  description: "Binary options trading platform",
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
