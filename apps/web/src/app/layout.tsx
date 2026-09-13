import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASM Trade",
  description: "Demonstration trading platform — simulated, no real money.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
