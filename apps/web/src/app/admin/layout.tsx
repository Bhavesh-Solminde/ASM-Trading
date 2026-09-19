import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./admin.css";

// Self-hosted by next/font (the app CSP blocks external font stylesheets).
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-archivo",
});
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const ADMIN_THEME_COOKIE = "asm_admin_theme";

export const metadata: Metadata = {
  title: "ASM Trading — Admin Console",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const theme = store.get(ADMIN_THEME_COOKIE)?.value === "light" ? "light" : "dark";

  return (
    <div
      id="admin-root"
      className={`admin-root ${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}
      data-admin-theme={theme}
    >
      {children}
    </div>
  );
}
