import type { Metadata } from "next";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
} from "@/lib/site";

type BuildMetadataInput = {
  /** Page title WITHOUT the brand suffix; the brand is appended automatically. */
  title?: string;
  description?: string;
  /** Site-relative path, e.g. "/guides/how-to-deposit". Drives the canonical. */
  path?: string;
  /** Override the OG image; defaults to the route's opengraph-image / site OG. */
  image?: string;
  /** Mark thin/utility pages non-indexable (login, checkout, etc.). */
  noindex?: boolean;
  // `| undefined` so callers can forward an optional article field directly
  // under exactOptionalPropertyTypes.
  keywords?: string[] | undefined;
};

/**
 * Central metadata factory. Produces a complete Next `Metadata` object with a
 * self-canonical URL, OpenGraph and Twitter cards, so no route has to
 * hand-assemble these. Titles get the brand appended; the homepage passes no
 * title and uses the brand as-is (handled by callers via `title: undefined`).
 */
export function buildMetadata({
  title,
  description = SITE_DESCRIPTION,
  path = "/",
  image,
  noindex = false,
  keywords,
}: BuildMetadataInput = {}): Metadata {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const canonical = absoluteUrl(path);
  const images = image ? [{ url: image }] : undefined;

  return {
    metadataBase: new URL(SITE_URL),
    title: fullTitle,
    description,
    keywords,
    alternates: { canonical },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      url: canonical,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: image ? [image] : undefined,
    },
  };
}
