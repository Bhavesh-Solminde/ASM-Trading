import type { Article } from "./types";
import { guides } from "./guides";
import { comparisons } from "./compare";

export * from "./types";
export { guides } from "./guides";
export { comparisons } from "./compare";

/** Every public content article, in one list for sitemap + static params. */
export const allArticles: Article[] = [...guides, ...comparisons];

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
