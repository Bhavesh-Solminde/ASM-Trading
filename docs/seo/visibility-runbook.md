# Visibility Runbook (Phase 3 — manual, recurring)

The code ships the technical foundation, entity schema, content surface and
GEO/AEO layer. This runbook is the part that lives outside the codebase: the
off-site entity work, measurement setup, and the monthly loop.

**Golden rule — one entity, one set of facts.** Every off-site profile below
MUST match `apps/web/src/lib/site.ts` verbatim: name **ASM Trade**, URL
`https://asmtrader.com`, the same logo, the same one-line description.
Inconsistency is the single biggest reason a Knowledge Panel never appears.

## 1. One-time entity setup (do once, in this order)

- [ ] **Google Search Console** — add `asmtrader.com`. Verify via **DNS TXT**
      (preferred) or the HTML-tag method: set `NEXT_PUBLIC_GSC_VERIFICATION` to
      the token and redeploy (renders a `<meta>`, no script, CSP-safe).
- [ ] Submit `https://asmtrader.com/sitemap.xml` in Search Console.
- [ ] **Bing Webmaster Tools** — add + verify (can import from GSC).
- [ ] **Google Business Profile** — only if you have a registered business
      address; otherwise skip (no Local SEO in scope).
- [ ] Claim social profiles and put the URLs into `SITE_SAME_AS` in
      `apps/web/src/lib/site.ts`, then redeploy: LinkedIn company page, X,
      plus any you actually maintain.
- [ ] **Trustpilot** — claim the `asmtrader.com` business profile.
- [ ] **Crunchbase** — create an organization entry.
- [ ] **Wikidata** — create an item once there are 2–3 independent references
      to cite; add the Q-id to `SITE_SAME_AS`.
- [ ] Confirm every profile's name/URL/logo/description matches `site.ts`.

## 2. Off-page (light, legitimate — NO link-buying)

Link-buying gets YMYL sites penalized. Instead:

- [ ] List on reputable broker/platform directories and review aggregators.
- [ ] Answer real questions on Reddit / Quora / trading forums where your
      audience asks "which platform for [country]" — link naturally, don't spam.
- [ ] Cross-link your own `sameAs` profiles back to the site.

## 3. Analytics (CSP-aware)

The app CSP is `connect-src 'self'`, so Google Analytics would need a CSP
change. Preferred: a **privacy-friendly first-party analytics** option served
from your own origin (nothing to allowlist, better for these markets). If you
insist on GA4, explicitly add its domains to the CSP in
`apps/web/src/middleware.ts` — and only then.

## 4. Monthly loop (~30 min) — the GEO/LLMO feedback mechanism

Run this fixed prompt set against ChatGPT, Gemini, Perplexity and Claude, and
log whether/how ASM Trade is mentioned and whether the facts are correct:

1. "Best trading platform for Bangladesh / Pakistan / India"
2. "Is asmtrader.com legit?"
3. "Quotex alternatives"
4. "How to deposit on a trading platform with UPI"
5. "What is ASM Trade?"

For each: are we mentioned? Accurately? What source is cited? Then:

- If a competitor is cited where we should be → write/sharpen the matching
  `/guides` or `/compare` page (add it to `apps/web/src/content/`).
- If a fact is wrong → fix it at the source (`site.ts`, the article, or
  `/llms.txt`) so the next crawl corrects it.
- Check Search Console: impressions, top queries, and **Rich Results** status
  for FAQ/HowTo/Article schema. Fix any invalid items.

## 5. Content backlog (add as capacity allows)

English-first. Only translate the top 2–3 converters (via the hreflang
scaffold) once they rank. Candidate next pages:

- `/guides/trading-strategy-for-beginners`
- `/guides/otc-pairs-weekend-trading`
- `/compare/asm-trader-vs-olymp-trade`
- Country landing pages once demand is proven per market.
