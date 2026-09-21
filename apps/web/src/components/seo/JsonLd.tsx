import {
  SITE_CONTACT,
  SITE_DESCRIPTION,
  SITE_LOGO,
  SITE_NAME,
  SITE_SAME_AS,
  SITE_URL,
  absoluteUrl,
} from "@/lib/site";

/* ---------------------------------------------------------------------------
 * Inline JSON-LD. The site CSP allows `script-src 'self' 'unsafe-inline'`, so
 * an inline <script type="application/ld+json"> is served without a nonce.
 *
 * React does not HTML-escape the text child of a <script> element (it is a raw
 * text element), so passing the JSON string as a child renders valid JSON-LD
 * without `dangerouslySetInnerHTML` (which the repo bans). We neutralise every
 * `<` to `<` so no `</script>` sequence in user-derived strings can break
 * out of the script element.
 * ------------------------------------------------------------------------- */

export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json">{json}</script>;
}

/** Organization — the core entity node. Drives Knowledge Panel eligibility. */
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: SITE_LOGO,
    },
    description: SITE_DESCRIPTION,
    ...(SITE_SAME_AS.length ? { sameAs: SITE_SAME_AS } : {}),
    contactPoint: {
      "@type": "ContactPoint",
      contactType: SITE_CONTACT.contactType,
      email: SITE_CONTACT.email,
    },
  };
}

/** WebSite node, linked to the Organization as publisher. */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** FAQPage — the workhorse for AEO featured snippets and AI answers. */
export function faqSchema(faqs: ReadonlyArray<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

/** HowTo — step-by-step guides (deposit, withdraw, getting started). */
export function howToSchema(input: {
  name: string;
  description?: string;
  steps: ReadonlyArray<{ title: string; body: string }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.body,
    })),
  };
}

/** BreadcrumbList — clarifies site hierarchy for crawlers and rich results. */
export function breadcrumbSchema(
  crumbs: ReadonlyArray<{ name: string; path: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

/** Article — for guide/comparison content pages. */
export function articleSchema(input: {
  title: string;
  description: string;
  path: string;
  datePublished?: string;
  dateModified?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    mainEntityOfPage: absoluteUrl(input.path),
    ...(input.datePublished ? { datePublished: input.datePublished } : {}),
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    author: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}
