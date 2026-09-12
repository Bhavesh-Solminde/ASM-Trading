import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ASM Relay — Test Build",
  description: "Test harness for the ASM Relay companion app.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#0b1118",
          color: "#e8edf3",
        }}
      >
        {children}
      </body>
    </html>
  );
}
