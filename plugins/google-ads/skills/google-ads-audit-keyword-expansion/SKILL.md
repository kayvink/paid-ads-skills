---
name: google-ads-audit-keyword-expansion
description: Quick check of which converting non-brand Google Ads search terms reach the account only through broad match or Performance Max, with no exact or phrase keyword controlling their routing and bids, scored by impact and checked for overlap risk. Use when the user asks whether converting queries are covered by keywords, about keyword coverage gaps, or during an account audit. For the full expansion workflow with coverage states, theme ad groups and PMax-to-Search promotion tables use google-ads-check-keyword-expansion.
---

# Audit keyword expansion

> What converting search terms are not yet covered by your keyword list?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

Which non-brand search terms are driving conversions or strong ROAS through broad match or PMax but have no corresponding exact or phrase keyword to control routing and bids?

## Data required

Run for each account in scope; use a 30-day window ending yesterday (excluding today).

```sql
-- Search terms with the keyword that triggered them
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group.id, ad_group.name,
  search_term_view.search_term, search_term_view.status,
  segments.keyword.info.text, segments.keyword.info.match_type,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

When a primary conversion action is configured, also pull primary-event conversions for the same terms (the two-query pattern in `google-ads-write-gaql-queries`) and use them instead of `metrics.conversions`.

```sql
-- PMax campaigns, then one insight query per campaign
SELECT customer.descriptive_name, campaign.id, campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
```

```sql
SELECT campaign_search_term_insight.campaign_id,
  campaign_search_term_insight.id, campaign_search_term_insight.category_label,
  metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value
FROM campaign_search_term_insight
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign_search_term_insight.campaign_id = <campaign_id>
```

The insight resource has no cost metric, and `id = "0"` is the uncategorised residual (skip it).

```sql
-- Current keyword inventory
SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
FROM ad_group_criterion
WHERE campaign.status = 'ENABLED'
  AND ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = FALSE
  AND ad_group_criterion.status = 'ENABLED'
```

Also read `brand_terms` and `primary_conversion_action` from `ads/google/index.md`, and the per-group KPI direction (ROAS or CPA) and target from `ads/google/rules/`.

## Method

Use Python for every step. Load each result into a DataFrame keyed by `customer_id`.

### 1. Filter to expansion candidates

From the search term report (Search and PMax campaigns):
- Exclude brand terms (any term containing a brand term, case-insensitive) and brand misspellings (flag terms within one or two characters of a brand term, for example with `difflib.SequenceMatcher` ratio ≥ 0.8 against each brand term, and confirm them by eye).
- Keep terms with >= 2 conversions OR >= 1% of campaign spend (campaign spend = the sum of cost over all of that campaign's search term rows). PMax has no spend, so it qualifies on conversions alone, at >= 3 (see the interpretation guide).
- Keep terms with ROAS >= campaign average (or CPA <= campaign target). Campaign ROAS = sum(value) / sum(cost) over all its rows. For PMax, compare value per click (`conversions_value / clicks`) with the campaign's value per click instead, and mark it approximate.

### 2. Check keyword coverage

For each qualifying search term, compare a normalised form (lowercase, strip punctuation, sort the words) with the normalised keyword inventory:
- Does it exist as an exact or phrase keyword in the account? If yes, no action.
- Does it only match via broad match (`segments.keyword.info.match_type = BROAD` with no exact or phrase keyword for the term) or PMax? If yes, it's an expansion candidate: there's no explicit keyword controlling its routing or bids.
- Is it a close variant of an existing exact keyword (same words in a different order, or differing only by a plural "s")? If yes, note it for awareness but at lower priority (Google already routes close variants).

### 3. Cluster into themes

Group similar expansion candidates by topic or intent: tokenise the candidates, drop stop words ("the", "a", "of", "and", "for"), and count the candidates and summed conversions and spend per shared token. Clusters with 3+ qualifying terms and meaningful combined volume suggest a new ad group rather than individual keyword additions.

### 4. Score by impact

Impact = conversions × ROAS deviation from the campaign average, `(term_roas - campaign_roas) / campaign_roas` (or the CPA improvement vs target, `(target_cpa - term_cpa) / target_cpa`). Rank expansion candidates by impact descending.

### 5. Check for overlap risk

For each recommended keyword addition, check whether it could cannibalise an existing exact or phrase keyword in another campaign or ad group: find inventory keywords whose normalised text is contained in the candidate (or the reverse) in a different ad group. If overlap risk exists, note the need for negative keywords to protect routing.

### 6. Classify recommendations

- **Critical:** high-volume converting terms with no keyword coverage, material spend flowing through uncontrolled broad or PMax matching.
- **Moderate:** moderate-volume terms, partial coverage (a close variant exists but not exact), theme clusters worth structuring.
- **Low:** low-volume terms with good performance, worth monitoring before adding.

Apply the minimum-data rule in `references/priority-tiers.md`: below the event threshold, mark the finding as directional.

## Interpretation guide

- The core issue is control. A converting term matched by broad or PMax has no dedicated bid, no dedicated ad copy, and no protection against being outbid by another campaign. Adding it as exact or phrase gives the account explicit control over that demand.
- Theme clusters justify new ad groups because grouped keywords can share tailored ad copy and a relevant landing page; both improve Quality Score and conversion rate.
- Overlap risk is real: adding a keyword that competes with an existing one in another campaign creates cannibalisation. Always pair expansion with negative keyword adjustments.
- PMax search term insights are less granular than Search. Expansion candidates from PMax should be verified with higher confidence thresholds (>= 3 conversions rather than 2).

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body with:

1. **Coverage summary:** % of converting spend already covered by exact or phrase keywords | % flowing through uncontrolled broad or PMax (computed in Python over terms with conversions > 0).
2. **Expansion table** (sorted by impact descending): account | search term | source (Broad/PMax) | campaign | spend | conversions | ROAS/CPA vs avg | current coverage (Exact/Phrase/Broad/None) | recommendation (Add KW / New Ad Group / Monitor).
3. **Theme clusters** (if any): theme | terms | combined spend | combined conversions | recommended structure (new ad group, keywords, LP).
4. **Wrap-up:** % of conversions from uncovered terms, top expansion opportunities, overlap risks to address.
