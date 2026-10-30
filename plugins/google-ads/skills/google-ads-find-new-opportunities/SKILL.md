---
name: google-ads-find-new-opportunities
description: Build a focused shortlist of three to eight new Google Ads keyword themes, launch ideas and tests that expand the account beyond what it already covers, each anchored in search demand or a landing page, with a suggested first test. Use when the user asks what to test next, where to expand, which new keywords or campaigns to try, or how to grow beyond current coverage. For scaling campaigns that already work use google-ads-find-scale-candidates.
---

# Find new opportunities

> Find keyword themes, launch ideas, and tests that could expand the account beyond current coverage.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

Produce a focused opportunity shortlist grounded in the business, the website, current search demand, and what the account already covers. This is for choosing what to test next, not for generating a long keyword dump.

## Inputs you need

1. Business context: read `wiki/company.md`.
2. Products or offers: read each relevant product or offer page under `wiki/` (for example `wiki/products/`), when present.
3. Taxonomy: read `ads/taxonomy.md` to avoid duplicating existing themes.
4. Memory: read `ads/google/memory/MEMORY.md`; themes the user has ruled out stay out.
5. Current keyword and search-term data: queries A and B below, for each account in scope, over the last 30 days ending yesterday. For field questions use the `google-ads-write-gaql-queries` skill.
6. Website context: when the company domain is known and you can fetch web pages, read `https://<domain>/sitemap.xml` and the pages for each product or offer.
7. Recent launches: list `launches/` if launch material exists in the workspace.

**Query A: what the account already targets**

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type
FROM keyword_view
WHERE ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND campaign.status = 'ENABLED'
```

**Query B: what people search to find the ads**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  search_term_view.search_term,
  search_term_view.status,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use Python to build the coverage set: lowercase and strip the keyword texts from query A, and tokenise them together with campaign and ad group names and the theme names in `ads/taxonomy.md`. This set is what "already covered" means in the merge step.

## Method

Run the opportunity skills that fit the ask:

- The `google-ads-research-keyword-opportunities` skill for outside-in keyword themes.
- The `google-ads-check-keyword-expansion` skill for converting search terms the account is not explicitly targeting.
- The `google-ads-evaluate-launch` skill when recent launch material could create a campaign or keyword opportunity.

If one isn't installed, cover its ground lightly: for outside-in themes, list the products and offers from the wiki and website that no campaign targets; for converting terms, use query B to find terms with conversions whose `search_term_view.status` is `NONE` (not yet a keyword); for launches, read the latest launch brief.

Merge the outputs into one shortlist. Use Python for the dedup and coverage filter: normalise each candidate theme (lowercase, strip punctuation, drop stop words), drop exact duplicates across sources, and drop any candidate whose tokens are all in the coverage set. Then, by judgement, drop speculative ideas without a landing-page or search-demand anchor, and anything already covered by taxonomy or memory. Say how many candidates each source produced and how many survived.

## Output

Give, in the conversation:

1. Top 3-8 opportunities.
2. The evidence behind each one: search volume or converting search terms (clicks, cost, conversions from query B), and the landing page that would serve it.
3. Suggested first test.
4. Required asset, landing page, or account change.

Then write one finding (`kind: recommendation`, `category: keywords`) per conventions section 4, with the shortlist as the recommendations table (account, opportunity, evidence, first test, what's needed). Update an open finding from this skill instead when one covers the same themes. If nothing is ready, write a `status: ok` finding that explains the strongest rejected ideas and what would make them viable.
