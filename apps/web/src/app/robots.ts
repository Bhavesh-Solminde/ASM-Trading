import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/site";

/** Crawl policy: public marketing/content is indexable; the authenticated
 *  app, API, admin and checkout/auth utility routes are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/admin",
        "/trade",
        "/deposit",
        "/withdrawal",
        "/balance",
        "/account",
        "/support",
        "/leaderboard",
        "/checkout",
        "/login",
        "/register",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
