import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./admin.css";

// The console uses the trader app's face (Hanken Grotesk, loaded by the root
// layout as --font-hanken). Mono is only for identifiers: UTRs, UPI IDs,
// wallet addresses, record IDs. Self-hosted by next/font (the CSP blocks
// external font stylesheets).
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-admin-mono",
});

export const metadata: Metadata = {
  title: "IndianxTrade — Admin Console",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="admin-root" className={`admin-root ${mono.variable}`}>
      {children}
    </div>
  );
}
