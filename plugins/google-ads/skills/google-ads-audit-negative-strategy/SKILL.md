---
name: google-ads-audit-negative-strategy
description: Quick check of a Google Ads account's negative keyword strategy - shared lists, brand and non-brand separation, match-type sculpting, and missed exclusions in the search term report. Use when the user asks whether negatives are set up properly, about brand leakage into non-brand campaigns, or during an account audit. For a query-by-query waste audit use google-ads-check-search-terms.
---

# Audit negative keyword strategy

> Are negative keywords deployed strategically to prevent waste, avoid cannibalisation, and keep targeting clean?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

Does the account have structured negative keyword lists at the right levels (account, campaign, ad group), and is wasted spend being caught by effective exclusions?

## Data required

Run for each account in scope; use a 30-day window ending yesterday.

```sql
-- Campaign-level negatives
SELECT customer.descriptive_name, campaign.id, campaign.name,
  campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
FROM campaign_criterion
WHERE campaign_criterion.type = 'KEYWORD'
  AND campaign_criterion.negative = TRUE
  AND campaign.status = 'ENABLED'
```

```sql
-- Shared negative lists and their size
SELECT shared_set.id, shared_set.name, shared_set.member_count, shared_set.status
FROM shared_set
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  AND shared_set.status = 'ENABLED'
```

```sql
-- Which campaigns each shared list is applied to
SELECT campaign.id, campaign.name, shared_set.id, shared_set.name
FROM campaign_shared_set
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  AND campaign_shared_set.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

```sql
-- Search terms, for missed exclusions and brand leakage
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, search_term_view.search_term, search_term_view.status,
  metrics.clicks, metrics.cost_micros, metrics.conversions
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Positive keywords, for sculpting checks
SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
FROM keyword_view
WHERE ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND campaign.status = 'ENABLED'
```

Also read the brand terms from `ads/google/index.md`, and campaign groupings (brand or non-brand) from `ads/taxonomy.md` when present. Without a taxonomy, treat a campaign as brand when its name contains "brand" or most of its keywords contain a brand term.

## Method

Use Python for every step: load each query into a DataFrame and join on `(customer_id, campaign.id)`.

### 1. Account-level shared negatives

Does a shared negative list exist with universal exclusions (jobs, careers, free, login, irrelevant geos, competitors)? Use `member_count` for size, and find duplicated negatives: group the campaign-level negatives by lowercase text and match type and count distinct campaigns; any negative present in 3 or more campaigns but in no shared list is a consolidation candidate.

| Finding | Priority |
|---|---|
| No shared negative list | Critical |
| Shared list exists but has fewer than 20 terms | Moderate (likely incomplete) |
| Shared list with broad coverage | Healthy |
| The same negatives duplicated across campaigns instead of shared | Moderate (consolidate into a shared list) |

### 2. Brand and non-brand separation

Flag a search term as brand when it contains any brand term (case-insensitive). Then compute, per non-brand campaign, the share of clicks and cost from brand terms, and per brand campaign, the cost from terms with no brand term in them.

| Finding | Priority |
|---|---|
| Non-brand campaigns serving brand queries (no brand negatives) | Critical |
| Brand campaigns serving irrelevant non-brand queries | Moderate |

### 3. Ad group sculpting

For accounts using mixed match types: for each exact-match keyword, check whether a broad or phrase keyword in another ad group of the same campaign also matches its search term, and whether that sibling carries the exact keyword as a negative.

| Finding | Priority |
|---|---|
| Broad keywords cannibalising exact keywords with no sculpting negatives | Moderate |
| Sculpting in place and working | Healthy |

### 4. Missed exclusions in the search term report

From the last 30 days of search terms (skip `status = EXCLUDED`), list the terms that should have been negated:
- zero conversions and material spend (cost above 1% of the campaign's cost, or above 30 clicks);
- clearly outside the offering, matched with Python against a token list such as jobs, careers, salary, review, reviews, complaint, login, free, cheap, download, meaning, plus anything `wiki/company.md` says the business doesn't do;
- competitor brands, unless the account targets them on purpose.

Sum the cost of these terms per campaign: that is the waste to quantify.

### 5. Structural organisation

- Are negatives organised into named shared lists (for example "Irrelevant terms", "Competitors", "Geo exclusions")?
- Are lists applied consistently: what share of enabled Search and Shopping campaigns has each list?
- Is there evidence of maintenance? If the account allows it, query `change_event` for the last 30 days (`LIMIT` 10000 or less) and count negative keyword additions.

### 6. Classify

- **Critical:** no shared negative list, or brand and non-brand leakage with material spend.
- **Moderate:** an incomplete shared list, negatives fragmented across campaigns, sculpting gaps, recurring irrelevant terms.
- **Low:** minor maintenance gaps, low-spend irrelevant terms.

Apply the minimum-data rule in `references/priority-tiers.md`: below the event threshold, mark the finding as directional.

## Interpretation guide

- No shared negative list is the most common structural gap. Creating one with 50–100 universal exclusions is a one-off task with ongoing savings.
- Brand leaking into non-brand campaigns flatters non-brand CPA (brand converts easily, so the campaign looks worse once brand queries are removed) and weakens control of the brand campaign.
- Sculpting negatives are tedious but essential with mixed match types. Without them broad cannibalises exact, and the account loses the control exact provides.
- Recurring irrelevant terms are maintenance, not structure. A monthly search term review catches most of them.

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body with:

1. **Coverage check:** shared list exists? Share of campaigns with negatives applied. Brand and non-brand separation in place?
2. **Negatives table**, sorted by priority: account | campaign | negatives (count) | shared list applied? | missed terms (from the search term report, with spend) | overlap or cannibalisation risk | priority | recommendation.
3. **Wasted spend summary:** spend on terms that should have been excluded, per campaign and in total.
4. **Wrap-up:** structural gaps, brand leakage, the waste figure, top actions.
