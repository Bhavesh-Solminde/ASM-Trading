import type { Metadata } from "next";
import { articlesIn } from "@/content";
import { CollectionIndex } from "@/components/content/CollectionIndex";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = buildMetadata({
  title: "Platform Comparisons",
  description: `Honest, feature-by-feature comparisons of ${SITE_NAME} against other short-term options platforms — deposits, payouts, demo and mobile experience.`,
  path: "/compare",
});

export default function CompareIndexPage() {
  return (
    <CollectionIndex
      title="Compare"
      intro="Feature-by-feature comparisons to help you choose a platform. We only make claims about our own product that we can back up."
      articles={articlesIn("compare")}
    />
  );
}
