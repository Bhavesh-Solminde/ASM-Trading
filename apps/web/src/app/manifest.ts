import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/?app=pwa",
    scope: "/",
    orientation: "portrait",
    name: `${SITE_NAME} — Trading`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/trade?source=pwa",
    display: "standalone",
    background_color: "#1e2024",
    theme_color: "#1e2024",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
