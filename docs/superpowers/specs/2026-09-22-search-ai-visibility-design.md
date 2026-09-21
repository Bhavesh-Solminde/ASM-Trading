# Search & AI Visibility — Design

**Date:** 2026-09-22
**Status:** Approved for implementation
**Domain:** asmtrader.com
**Canonical brand:** ASM Trade (single entity name — no more "ASM Trading" / "ASM Trade" drift)

## Goal

Two reinforcing outcomes:

1. **New trader signups** — be found and recommended for high-intent and
   comparison queries.
2. **Brand & entity trust** — be recognized as a real, legitimate entity so
   the acquisition traffic actually converts in a scam-wary vertical.

## Constraints (these shape every decision)

- **YMYL vertical.** This is a "Your Money or Your Life" niche; Google holds
  it to the highest E-E-A-T bar. Thin content is a liability, not an asset.
- **Ads-hostile.** Paid search/social for this product is banned in most
  markets — organic and AI visibility is the channel.
- **Target markets:** Bangladesh, Pakistan, India (South Asia). Mobile-first,
  English-first with later regional-language expansion.
- **Operator capacity:** solo, lean, AI-assisted. No CMS, no editorial team.
  Favor one-time technical wins + a small high-leverage content core.
- **Strict CSP** (`script-src 'self' 'unsafe-inline'`, `connect-src 'self'`):
  inline JSON-LD is allowed; third-party analytics (GA) would need CSP changes,
  so measurement avoids it.

## Out of scope (deliberately dropped)

- **Local SEO** — no Google Maps relevance for an online-only platform.
- **Video SEO** — production cost too high for a solo operator.
- **News SEO** — needs Google News approval + a cadence that can't be
  sustained solo.
- **Paid ads** — banned in the vertical/markets.
- **A CMS** — MDX/CMS overhead unjustified; content authored as typed content
  modules in the repo.

## Architecture — five layers

1. **Technical foundation** — `robots.ts`, `sitemap.ts`, `manifest.ts`,
   per-route metadata + canonicals, OG images, hreflang scaffolding.
2. **Entity & trust layer** — `Organization` + `WebSite` JSON-LD, a single
   canonical NAP (name/URL/logo/socials) source of truth, `sameAs` graph.
3. **Public content surface** — a new indexable `(content)` route group
   (`/guides`, `/compare`, `/about`, `/legit`, `/security`); today only `/`
   is public.
4. **GEO/AEO/LLM layer** — `FAQPage` + `HowTo` schema, question-first quotable
   answers, `llms.txt`, factual consistency for ChatGPT/Gemini/Perplexity/Claude.
   Rides on the same content as layer 3.
5. **Off-page & measurement** — legitimate citations (no link-buying), Search
   Console (script-free verification), a monthly AI-citation loop.

### Key implementation decisions

- **Content as typed TSX/TS modules, not MDX or a CMS.** Guarantees a clean
  build under the existing strict Next config, stays type-safe and
  version-controlled, and a shared renderer auto-emits Article/Breadcrumb/FAQ/
  HowTo schema so every page is GEO/AEO-ready by construction. Editing a
  content object is well within a solo operator's reach.
- **Single site-config source of truth** (`lib/site.ts`) drives metadata,
  JSON-LD, sitemap, and the off-site NAP checklist. Entity consistency is the
  mechanism behind a Knowledge Panel, so it must have exactly one origin.
- **`SITE_URL` from `NEXT_PUBLIC_SITE_URL`** (default `https://asmtrader.com`)
  so canonicals/OG resolve correctly per environment.

## Components / files

| File | Purpose |
|---|---|
| `lib/site.ts` | Canonical NAP + entity facts, `absoluteUrl()` |
| `lib/seo.ts` | `buildMetadata()` (title/desc/canonical/OG/Twitter) |
| `components/seo/JsonLd.tsx` | Inline JSON-LD renderer + schema builders (Organization, WebSite, FAQPage, HowTo, BreadcrumbList, Article) |
| `content/types.ts` | `Article` content type |
| `content/guides.ts` | Guide articles |
| `content/compare.ts` | Comparison articles |
| `components/content/*` | Shared content layout + article/prose renderer |
| `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts` | Crawl/index config |
| `app/opengraph-image.tsx` | Default branded OG image (next/og) |
| `app/llms.txt/route.ts` | LLM-facing entity + content summary |
| `app/(content)/…` | `/guides`, `/compare`, `/about`, `/legit`, `/security` |
| Root `layout.tsx` / `page.tsx` | Real metadata + Organization/WebSite/FAQ JSON-LD |

## Phase plan

**Phase 1 — Foundation (code, one-time):** layers 1 + 2 + the empty content
scaffold of layer 3.

**Phase 2 — Content core (lean, AI-assisted):** ~8–12 double-duty pages:
- Trust/brand-defense: `/legit`, `/about`, `/security`.
- High-intent guides: how-binary-options-works, how-to-deposit, how-to-withdraw,
  demo-account.
- Comparison: `/compare/asm-trader-vs-quotex` (+1–2 competitors).
- English first; regional-language versions of the top converters later via the
  hreflang scaffold — not upfront.

**Phase 3 — Amplify & measure (recurring, ~monthly):**
- Off-page: legitimate directories + `sameAs` profiles matching the NAP sheet
  exactly; natural forum/Q&A participation. No link-buying.
- Measurement: Google Search Console (DNS/meta verification, no script);
  privacy-friendly first-party analytics (or explicit CSP allowlist);
  a fixed monthly prompt set run against the major AI assistants, logged, to
  decide the next page to write.

## Success signals

- Indexed content pages + valid rich results (schema) in Search Console.
- Brand-name and "is asmtrader legit" SERPs owned by first-party pages.
- Knowledge Panel / accurate AI answers about the entity.
- Growth in organic signups attributed to guide/comparison pages.
