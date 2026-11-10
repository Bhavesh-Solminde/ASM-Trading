import type { Metadata } from "next";
import localFont from "next/font/local";
import "./admin.css";

// The console uses the trader app's face (Hanken Grotesk, loaded by the root
// layout as --font-hanken). Mono is only for identifiers: UTRs, UPI IDs,
// wallet addresses, record IDs. Bundled locally so builds do not depend on changing Google font URLs.
const mono = localFont({
  src: "./fonts/JetBrainsMono.ttf",
  weight: "100 800",
  display: "swap",
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
