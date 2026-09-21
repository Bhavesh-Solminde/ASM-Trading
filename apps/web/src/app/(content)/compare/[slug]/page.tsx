import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { articlesIn, findArticle } from "@/content";
import { ArticleView } from "@/components/content/ArticleView";
import { buildMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return articlesIn("compare").map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = findArticle("compare", slug);
  if (!article)
    return buildMetadata({ noindex: true, path: `/compare/${slug}` });
  return buildMetadata({
    title: article.title,
    description: article.description,
    path: `/compare/${article.slug}`,
    keywords: article.keywords,
  });
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = findArticle("compare", slug);
  if (!article) notFound();
  return <ArticleView article={article} />;
}
