import type { Metadata } from "next";
import { articlesIn } from "@/content";
import { CollectionIndex } from "@/components/content/CollectionIndex";
import { buildMetadata } from "@/lib/seo";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = buildMetadata({
  title: "Trading Guides",
  description: `Plain-English guides to trading on ${SITE_NAME}: how it works, how to deposit and withdraw, and how to practise risk-free on the demo.`,
  path: "/guides",
});

export default function GuidesIndexPage() {
  return (
    <CollectionIndex
      title="Guides"
      intro="Straightforward guides to getting started, funding your account, and understanding how fixed-risk trading actually works."
      articles={articlesIn("guides")}
    />
);
}
