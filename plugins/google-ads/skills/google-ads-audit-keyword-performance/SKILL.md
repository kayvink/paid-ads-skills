---
name: google-ads-audit-keyword-performance
description: Quick check of Google Ads Search keyword performance that sorts keywords into six buckets (Winners, Keepers, Lucky Shots, Bleeders, Sleepers, Ghosts) against brand-split campaign benchmarks and ranks pause and scale candidates by impact. Use when the user asks which keywords to pause or scale, or for keyword performance during an account audit. For the full audit with per-keyword Quality Score diagnosis, observed-pattern fallbacks and hygiene checks use google-ads-check-keyword-performance.
---

# Audit keyword performance

> Which Search keywords are underperforming and should be paused, and which are strong enough to scale?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

For every live Search keyword with meaningful volume, how does its CPA or ROAS compare to the campaign benchmark, and what action does that imply: scale, monitor, investigate, or pause?

## Data required

Run for each account in scope; use a 30-day window ending yesterday (excluding today).

```sql
-- Keyword spend and funnel
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.resource_name,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.ctr,
  metrics.average_cpc, metrics.conversions, metrics.conversions_value
FROM keyword_view
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Primary-event conversions (skip when no primary action is configured)
SELECT campaign.id, ad_group_criterion.resource_name,
  segments.conversion_action_name, metrics.conversions, metrics.conversions_value
FROM keyword_view
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

```sql
-- Campaign impression share (separate: it can't be combined with segments.date on keyword_view)
SELECT customer.descriptive_name, campaign.id, campaign.name,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Full keyword inventory with quality score components, including paused
SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  ad_group_criterion.status,
  ad_group_criterion.quality_info.quality_score,
  ad_group_criterion.quality_info.creative_quality_score,
  ad_group_criterion.quality_info.post_click_quality_score,
  ad_group_criterion.quality_info.search_predicted_ctr
FROM ad_group_criterion
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = FALSE
```

Also read `brand_terms` and `primary_conversion_action` from `ads/google/index.md`, and the per-group KPI direction (ROAS or CPA) and target from `ads/google/rules/`. Without rules, use CPA for lead-gen, B2B and SaaS businesses and ROAS for e-commerce (per `wiki/company.md`), and say so.

## Method

Use Python for every step. Left-join the primary-event rows onto the keyword rows on `(customer_id, ad_group_criterion.resource_name)` (missing conversions become 0), join the inventory on the same key and keep `status == "ENABLED"`, and join campaign impression share on `(customer_id, campaign.id)`. Without a primary action, use `metrics.conversions` from the first query. Mark a keyword brand when its text contains any brand term (case-insensitive).

### 1. Establish benchmarks

Compute campaign-level averages, split by brand tier, from summed totals per `(customer_id, campaign.id, tier)`: CPA = sum(cost) / sum(conversions), ROAS = sum(value) / sum(cost), plus pooled CTR and CPC for the comparison columns.
- Brand-keyword CPA/ROAS (keywords containing a brand term)
- Non-brand-keyword CPA/ROAS

Never mix brand and non-brand in one average. If a campaign has fewer than 5 meaningful-volume keywords in a tier, fall back to the group-level average (the same tier across the campaigns in that group in `ads/taxonomy.md`) and note the fallback.

### 2. Apply the volume floor

Drop keywords below both thresholds from the main classification:
- < 30 clicks (30 days) AND < about 50 in the account's currency of spend (30 days)

Sub-floor keywords are classified separately as Lucky Shots (apparent strong performance, thin evidence) or Ghosts (0 clicks, > 0 impressions).

### 3. Classify into six buckets

Compute each keyword's deviation from its tier-within-campaign average: for CPA, `(kw_cpa - avg_cpa) / avg_cpa` (positive is worse); for ROAS, `(kw_roas - avg_roas) / avg_roas` (positive is better). An above-floor keyword with zero conversions counts as worse than every threshold. Then apply:

| Bucket | Definition | Default action |
|--------|-----------|----------------|
| Winners | Above floor; primary KPI > 20% better than avg; campaign SIS >= 80% | Keep; consider siloed test |
| Keepers | Above floor; primary KPI within +/- 20% of avg | Keep; no action |
| Lucky Shots | Below floor; apparent KPI > 20% better than avg (0-30 clicks) | Bid up cautiously; monitor 2-4 weeks |
| Bleeders | Above floor; primary KPI > 30% worse than avg | Pause (if > 50% worse and material spend) or investigate |
| Sleepers | Above floor; primary KPI > 20% better than avg AND campaign SIS < 50% | Scale: raise budget or bid on this keyword |
| Ghosts | 0 clicks in 30d AND > 0 impressions | Pause: clutters the auction with no engagement |

Above-floor keywords between the bands (20–30% worse, or > 20% better with campaign SIS between 50% and 80% or not reported) count as Keepers to monitor.

### 4. Hypothesise the why for Bleeders

For each Bleeder, check the quality score components from the inventory query (`creative_quality_score` = Ad Relevance, `post_click_quality_score` = Landing Page Experience, `search_predicted_ctr` = Expected CTR):
- Ad Relevance = Below Average: ad copy doesn't match the keyword intent. Recommend an ad copy update or a negative keyword to redirect.
- Landing Page Experience = Below Average: the LP doesn't satisfy the query. Recommend LP improvement or alignment.
- Expected CTR = Below Average: creatives aren't compelling. Recommend new creative testing.
- All components Average/Above but performance poor: likely competitive pressure, a weak offer, or a conversion tracking gap. Review the offer and competition.

### 5. Prioritise by impact

Impact score = spend × |deviation from benchmark|. Rank Bleeders by impact score descending. The highest-impact Bleeders are the first pause or investigate candidates. Rank Sleepers the same way for scaling potential.

## Interpretation guide

- Bleeders > 50% worse than average with material spend are the clearest pause candidates. The evidence threshold is high enough that continued spend is indefensible.
- Bleeders 30-50% worse deserve investigation before pausing: the QS diagnosis often reveals a fixable issue (LP mismatch, ad copy gap).
- Sleepers are the most underappreciated bucket. A keyword outperforming average in a campaign with < 50% SIS has room to capture significantly more demand.
- Lucky Shots are tempting to scale but the evidence is thin. Small sample sizes produce extreme metrics. Monitor for 2-4 weeks before committing budget.
- Ghosts are technical debt. They earn impressions (lowering account CTR) without contributing. Pause in bulk.

Apply the minimum-data rule in `references/priority-tiers.md`: below the event threshold, mark the finding as directional.

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body with:

1. **Coverage summary:** keywords analysed | % classified as Bleeders | % as Sleepers | % as Winners/Keepers | Ghosts count.
2. **Classification table** (per campaign, sorted by impact score descending): account | keyword | match type | brand/non-brand | spend | CPA/ROAS vs avg (% diff) | CTR vs avg | CPC vs avg | QS / AdRel / LPExp | bucket | recommended action.
3. **Impact summary:** estimated waste (Bleeder spend × efficiency gap, summed in Python) | top 5 Bleeders by impact | top 5 Sleepers by scaling potential.
4. **Wrap-up:** % of spend on Bleeders, top problem drivers, biggest scaling opportunities.
