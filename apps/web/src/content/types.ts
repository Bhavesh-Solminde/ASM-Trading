/* ---------------------------------------------------------------------------
 * Content model for public guide/comparison articles. Content is authored as
 * typed data (not MDX/CMS) so a shared renderer can emit consistent markup AND
 * Article/Breadcrumb/FAQ/HowTo JSON-LD by construction — every page is
 * GEO/AEO-ready without per-page schema wiring.
 * ------------------------------------------------------------------------- */

/** A block within a section body. */
export type ContentBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | {
      kind: "table";
      head: string[];
      rows: string[][];
    };

export type ContentSection = {
  /** Rendered as an <h2>; also the readable anchor. */
  heading: string;
  blocks: ContentBlock[];
};

export type Article = {
  slug: string;
  /** Which route group this belongs to; drives URL + breadcrumb. */
  collection: "guides" | "compare";
  /** <title> (brand appended by buildMetadata) and <h1>. */
  title: string;
  /** Meta description + article schema description + intro lede. */
  description: string;
  /** ISO date; feeds Article schema + sitemap lastModified. */
  updated: string;
  /** Optional keyword hints for metadata. */
  keywords?: string[];
  /** Body sections rendered in order. */
  sections: ContentSection[];
  /** Emits HowTo schema + a numbered step block when present. */
  howTo?: {
    name: string;
    description?: string;
    steps: { title: string; body: string }[];
  };
  /** Emits FAQPage schema + an accordion-free FAQ block when present. */
  faqs?: { q: string; a: string }[];
};

export function articlePath(a: Pick<Article, "collection" | "slug">): string {
  return `/${a.collection}/${a.slug}`;
}
