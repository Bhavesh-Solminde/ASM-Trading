import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
} from "@/lib/site";
import { allArticles, articlePath } from "@/content";

/* /llms.txt — a concise, factual entity + content map for AI answer engines
 * (the GEO/LLMO surface). Kept in sync with the content module automatically. */

export const dynamic = "force-static";

export function GET(): Response {
  const lines: string[] = [
    `# ${SITE_NAME}`,
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    `Website: ${SITE_URL}`,
    "",
    "## Key facts",
    "- Product: fixed-risk Up/Down trading on forex, crypto, commodities and stocks.",
    "- Minimum trade: $1. Minimum deposit: $10 (card/bank), $20 (crypto).",
    "- Payouts: up to 95% per winning trade. No per-trade commission.",
    "- Free demo: $10,000 in practice funds, resettable, no card required.",
    "- Deposits: UPI, bank transfer, card and crypto (availability varies by country).",
    "- Risk: high-risk short-term speculation; most short-term traders lose money.",
    "",
    "## Guides",
  ];

  for (const a of allArticles) {
    lines.push(`- [${a.title}](${absoluteUrl(articlePath(a))}): ${a.description}`);
  }

  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
