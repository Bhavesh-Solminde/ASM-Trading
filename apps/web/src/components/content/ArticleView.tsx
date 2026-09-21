import Link from "next/link";
import type { Article, ContentBlock, ContentSection } from "@/content/types";
import { SITE_NAME } from "@/lib/site";
import {
  JsonLd,
  articleSchema,
  breadcrumbSchema,
  faqSchema,
  howToSchema,
} from "@/components/seo/JsonLd";

function Block({ block }: { block: ContentBlock }) {
  if (block.kind === "p") {
    return <p className="mt-4 leading-relaxed text-ink-2">{block.text}</p>;
  }
  if (block.kind === "list") {
    return (
      <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {block.head.map((h, i) => (
              <th
                key={i}
                className="border-b border-rule px-3 py-2 font-semibold text-ink"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="border-b border-rule/60 px-3 py-2 text-ink-2"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ section }: { section: ContentSection }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold tracking-tight text-ink md:text-2xl">
        {section.heading}
      </h2>
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </section>
  );
}

const COLLECTION_LABEL: Record<Article["collection"], string> = {
  guides: "Guides",
  compare: "Compare",
};

/** Renders a content article and emits Article + Breadcrumb + (optional)
 *  HowTo/FAQ JSON-LD, so every content page is rich-result and AI-answer ready
 *  without per-page schema wiring. */
export function ArticleView({ article }: { article: Article }) {
  const path = `/${article.collection}/${article.slug}`;
  const schema: object[] = [
    articleSchema({
      title: article.title,
      description: article.description,
      path,
      datePublished: article.updated,
      dateModified: article.updated,
    }),
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: COLLECTION_LABEL[article.collection], path: `/${article.collection}` },
      { name: article.title, path },
    ]),
  ];
  if (article.howTo) {
    schema.push(howToSchema(article.howTo));
  }
  if (article.faqs?.length) {
    schema.push(faqSchema(article.faqs));
  }

  return (
    <article>
      <JsonLd data={schema} />

      <nav className="text-xs text-ink-3">
        <Link href="/" className="hover:text-ink-2">
          Home
        </Link>
        {" / "}
        <Link href={`/${article.collection}`} className="hover:text-ink-2">
          {COLLECTION_LABEL[article.collection]}
        </Link>
      </nav>

      <h1 className="mt-3 text-3xl font-black tracking-tight text-ink md:text-4xl">
        {article.title}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-2">
        {article.description}
      </p>

      {article.sections.map((section, i) => (
        <Section key={i} section={section} />
      ))}

      {article.howTo ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight text-ink md:text-2xl">
            Steps
          </h2>
          <ol className="mt-4 space-y-4">
            {article.howTo.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-bold text-brand">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 text-ink-2">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {article.faqs?.length ? (
        <section className="mt-10">
          <h2 className="text-xl font-bold tracking-tight text-ink md:text-2xl">
            Frequently asked questions
          </h2>
          <dl className="mt-4 space-y-5">
            {article.faqs.map((faq, i) => (
              <div key={i}>
                <dt className="font-semibold text-ink">{faq.q}</dt>
                <dd className="mt-1 text-ink-2">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="mt-12 rounded-2xl border border-rule bg-panel p-6">
        <p className="text-lg font-bold text-ink">
          Start on the free {SITE_NAME} demo
        </p>
        <p className="mt-2 text-ink-2">
          $10,000 in practice funds, real market prices, no card required.
        </p>
        <Link
          href="/register"
          className="mt-4 inline-flex rounded-full bg-brand px-5 py-2 font-semibold text-brand-ink"
        >
          Create a free account
        </Link>
      </div>
    </article>
  );
}
