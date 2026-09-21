import Link from "next/link";
import type { Article } from "@/content/types";
import { articlePath } from "@/content/types";

/** Simple index listing for a content collection. The internal links here are
 *  also how crawlers reach each article. */
export function CollectionIndex({
  title,
  intro,
  articles,
}: {
  title: string;
  intro: string;
  articles: Article[];
}) {
  return (
    <div>
      <h1 className="text-3xl font-black tracking-tight text-ink md:text-4xl">
        {title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-2">{intro}</p>

      <ul className="mt-8 space-y-4">
        {articles.map((a) => (
          <li key={a.slug}>
            <Link
              href={articlePath(a)}
              className="block rounded-2xl border border-rule bg-panel p-5 transition-colors hover:border-brand/40"
            >
              <p className="text-lg font-bold text-ink">{a.title}</p>
              <p className="mt-1 text-ink-2">{a.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
