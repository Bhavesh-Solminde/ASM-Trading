import type { Article } from "./types";
import { guides } from "./guides";

export * from "./types";
export { guides } from "./guides";

/** Every public content article, in one list for sitemap + static params. */
export const allArticles: Article[] = [...guides];

export function articlesIn(collection: Article["collection"]): Article[] {
  return allArticles.filter((a) => a.collection === collection);
}

export function findArticle(
  collection: Article["collection"],
  slug: string,
): Article | undefined {
  return allArticles.find(
    (a) => a.collection === collection && a.slug === slug,
  );
}
