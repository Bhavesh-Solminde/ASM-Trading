import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { allArticles, articlePath } from "@/content";

/** Static indexable routes (excluding article detail pages, added below). */
const STATIC_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/about", priority: 0.8, changeFrequency: "monthly" },
  { path: "/legit", priority: 0.8, changeFrequency: "monthly" },
  { path: "/security", priority: 0.7, changeFrequency: "monthly" },
  { path: "/guides", priority: 0.7, changeFrequency: "weekly" },
  { path: "/compare", priority: 0.7, changeFrequency: "weekly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const articleEntries: MetadataRoute.Sitemap = allArticles.map((a) => ({
    url: absoluteUrl(articlePath(a)),
    lastModified: new Date(a.updated),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...articleEntries];
}
