---
name: google-ads-audit-match-type-strategy
description: Quick check of whether Google Ads keyword match types (exact, phrase, broad) are used intentionally - spend and CPA or ROAS by match type per campaign, broad match query quality and overlap with exact keywords, exact and phrase coverage of top converters, and negative keyword guardrails on broad campaigns. Use when the user asks about broad vs exact match, match type mix, whether broad match is working, or during an account audit. For keyword-by-keyword performance buckets use google-ads-check-keyword-performance.
---

# Audit match type strategy

> Are keyword match types being used intentionally and effectively?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

Is the distribution of Exact, Phrase and Broad match keywords aligned with the account's performance goals, volume levels and negative keyword coverage?

## Data required

Run for each account in scope; use a 30-day window ending yesterday (excluding today).

```sql
-- Keyword performance with match type
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  metrics.cost_micros, metrics.clicks, metrics.conversions, metrics.conversions_value
FROM keyword_view
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Search terms with the triggering keyword and its match type, to assess Broad query quality
SELECT customer.descriptive_name, campaign.id, campaign.name,
  search_term_view.search_term, search_term_view.status,
  segments.keyword.info.text, segments.keyword.info.match_type,
  metrics.cost_micros, metrics.clicks, metrics.conversions
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Campaign-level negatives
SELECT campaign.id, campaign.name,
  campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
FROM campaign_criterion
WHERE campaign_criterion.type = 'KEYWORD'
  AND campaign_criterion.negative = TRUE
  AND campaign.status = 'ENABLED'
```

```sql
-- Shared negative lists applied to campaigns
SELECT campaign.id, campaign.name, shared_set.id, shared_set.name, shared_set.member_count
FROM campaign_shared_set
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  AND campaign_shared_set.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

```sql
-- Recent negative keyword additions, for evidence of active management (LIMIT 10000 or less)
SELECT change_event.change_date_time, change_event.change_resource_type,
  change_event.resource_change_operation, campaign.id
FROM change_event
WHERE change_event.change_date_time >= '<30 days ago> 00:00:00'
  AND change_event.change_date_time <= '<today> 00:00:00'
  AND change_event.change_resource_type IN ('CAMPAIGN_CRITERION', 'AD_GROUP_CRITERION')
  AND change_event.resource_change_operation = 'CREATE'
LIMIT 10000
```

`change_event` can't filter on whether a criterion is negative; treat criterion creations as an upper bound on negative additions, or parse `change_event.new_resource` for `negative: true` (see `google-ads-write-gaql-queries`).

When a primary conversion action is configured, pull primary-event conversions per keyword with the two-query pattern and use them instead of `metrics.conversions`. Read per-campaign target CPA or ROAS from `ads/google/rules/`, and `brand_terms` from `ads/google/index.md`.

## Method

Use Python for every step; key every table on `customer_id` plus the entity ID.

### 1. Report spend distribution by match type

Per campaign and account-wide: group keyword cost by match type and divide by the total, giving % of spend on Exact, Phrase and Broad. Focus on the campaigns covering the top 80% of spend (sort campaigns by cost descending and keep them until the cumulative share reaches 80%).

### 2. Compare performance by match type

Per campaign and match type: CPA = sum(cost) / sum(conversions), ROAS = sum(value) / sum(cost). Calculate the variance from the campaign target: `(cpa - target_cpa) / target_cpa`, or `(roas - target_roas) / target_roas`.

### 3. Assess Broad match health

For campaigns with Broad keywords:
- Check Broad CPA/ROAS vs the campaign target. Flag if CPA >= 1.5× target or ROAS materially below target.
- Review the search terms triggered by Broad (`segments.keyword.info.match_type = 'BROAD'`): are they relevant? What share leads to conversions? Compute the share of Broad-triggered terms and of their cost with conversions > 0, and label the top terms by spend Relevant / Marginal / Irrelevant against `wiki/company.md`.
- Check overlap: are Broad keywords triggering queries already covered by Exact or Phrase keywords? Normalise both sides (lowercase, strip punctuation, sort the words), join Broad-triggered terms to the account's Exact and Phrase keyword texts, and compute the Broad-to-Exact overlap % = cost of Broad-triggered terms that match an existing Exact or Phrase keyword / total Broad-triggered cost. That is wasted Broad spend on queries that already have explicit keywords.

### 4. Assess Exact/Phrase coverage

- Are top-converting search terms protected with Exact or Phrase keywords? Take the top 20 terms by conversions and check each against the normalised Exact and Phrase inventory.
- If the account is Exact-only: is volume sufficient, or is coverage missing because no Broad or Phrase exists to discover new terms?
- If there is no Broad at all: note it as a potential test opportunity (low urgency, not a problem).

### 5. Check negative keyword guardrails

For campaigns running Broad:
- Are negative keyword lists applied (an account-level shared list plus campaign-level negatives)?
- Are brand terms excluded from non-brand Broad campaigns? Check whether any brand term appears among the campaign's negatives or in a shared list applied to it.
- Is there active negative keyword management (recent additions in the `change_event` query)?

### 6. Classify findings

| Scenario | Priority |
|----------|----------|
| Broad-heavy (> 65% spend) + CPA >= 1.5× target | Critical: rebalance, move converters to Exact/Phrase, add negatives |
| Broad-heavy + performance on target | Moderate: maintain, but move top converters to Exact for control |
| Exact-only + low volume / missing coverage | Moderate: add Phrase to expand; consider a controlled Broad test |
| Exact-only + performance strong | Low: intentionally conservative, note missed discovery |
| Balanced mix + strong performance | Low: no action, structure is healthy |
| Broad running without negative lists | Critical: add negatives immediately |

Apply the minimum-data rule in `references/priority-tiers.md`: below the event threshold, mark the finding as directional.

## Interpretation guide

- Broad match is a tool, not a default. It works well with Smart Bidding, sufficient volume (>= 30 conversions/month) and active negative keyword management. Without those preconditions, Broad typically wastes spend.
- The most actionable finding is usually Broad queries that overlap with existing Exact keywords: the account is paying Broad CPCs for queries it already controls.
- Exact-only accounts aren't broken, but they sacrifice discovery. A controlled Broad test (small budget, Smart Bidding, negatives, a 2-4 week window) is low risk.
- Negative keyword gaps on Broad campaigns are urgent. Without negatives, Broad match serves irrelevant queries that drain budget.

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body with:

1. **Spend distribution:** account-wide and per campaign, % Exact | % Phrase | % Broad.
2. **Match type table** (per campaign, sorted by spend): account | campaign | spend % by match type | CPA/ROAS by match type vs target | negatives applied? | Broad-to-Exact overlap % | priority | recommendation.
3. **Broad query review** (top queries by spend): query | triggering keyword | match type | spend | conversions | relevance (Relevant / Marginal / Irrelevant) | action.
4. **Wrap-up:** match type balance assessment, top rebalancing actions, negative keyword gaps.
