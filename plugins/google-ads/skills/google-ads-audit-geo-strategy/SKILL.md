---
name: google-ads-audit-geo-strategy
description: Quick check of Google Ads geo strategy, covering which countries over- or under-perform the account average on ROAS or CPA, whether spend allocation matches the media plan, spend leaking to unintended markets and Presence or Interest location settings. Use when the user asks which countries to scale or cut, whether geo spend matches plan, or during an account audit. For the deep audit with name, targeting and actual-click reconciliation use google-ads-check-geo-targeting.
---

# Audit geo strategy

> Are geos performing in line with account averages, and does spend allocation match the media plan?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Each campaign's intended market and the leakage thresholds come from `references/market-partitioning.md`; priorities follow `references/priority-tiers.md`.

## Question

Which geographies are over- or under-performing relative to the account average, where is spend leaking to unintended markets, and does actual allocation match planned allocation?

## Data required

Run for each account in scope over the last 30 complete days (today excluded).

```sql
-- Country performance (targeting level)
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, geographic_view.country_criterion_id,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

```sql
-- Primary-action conversions per country (when a primary action is configured)
SELECT campaign.id, geographic_view.country_criterion_id,
  segments.conversion_action_name, metrics.conversions, metrics.conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

```sql
-- Campaign spend and location setting
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  campaign.geo_target_type_setting.positive_geo_target_type,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

```sql
-- Targeted locations, for each campaign's intended market
SELECT campaign.id, campaign.name,
  campaign_criterion.location.geo_target_constant, campaign_criterion.negative
FROM campaign_criterion
WHERE campaign_criterion.type = 'LOCATION'
  AND campaign.status = 'ENABLED'
```

Resolve country IDs and geo target constants to country codes with `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.id IN (<ids>)`.

Also read:
- The media plan geo allocations (% spend by country or region) from `ads/media-plan.md`, if present.
- The primary metric (ROAS or CPA) from `ads/google/rules/*.md`; when the rules don't say, ask the user (ROAS for e-commerce, CPA for lead generation is the usual default).
- The primary conversion action from `ads/google/index.md`, and `ads/google/memory/MEMORY.md` for acknowledged geo exceptions.

## Method

Use Python for every step: load the queries, add `cost = cost_micros / 1e6`, map country IDs to country codes, and use primary-action conversions when configured.

### 1. Compute geo-level performance

For each country with spend, sum cost, conversions and conversion value per `(customer_id, country)` and per account, then:
- Calculate CPA or ROAS (per the user's metric) from the sums.
- Calculate the variance vs the account average: `((geo_metric - account_avg) / account_avg) × 100`. For CPA, positive variance is weaker; for ROAS, negative variance is weaker. Express "stronger" and "weaker" with that sign flip applied.

### 2. Compare allocation vs plan

If a media plan exists:
- Calculate planned % spend vs actual % spend per geo (`actual_pct = geo cost / account cost × 100`).
- Flag deviations above 10% (percentage points of share).

### 3. Detect spend leakage

Derive each campaign's intended market with the MarketKey rules in `references/market-partitioning.md` (location targeting first, then the geo token in the campaign name). Identify spend in geos not present in the media plan or not in the campaign's intended market. Per campaign, `leak_share = cost in unintended geos / campaign cost`. Classify severity (`references/market-partitioning.md`):

| Leakage share | Severity |
|---------------|----------|
| > 1% of campaign spend | High: add geo exclusions |
| < 1% of campaign spend | Low: flag for awareness |

### 4. Check location targeting settings

For each campaign, check whether location targeting is set to Presence only (`PRESENCE`) or Presence or Interest (`PRESENCE_OR_INTEREST`). Flag Presence or Interest as a potential source of leakage: it shows ads to users who searched for or showed interest in a location without being physically there.

### 5. Classify and recommend

| Variance from average | Action |
|-----------------------|--------|
| Within ±10% | Expected range, no action |
| ≥ 10% stronger with scalable volume | Scale spend toward this geo |
| ≥ 10% weaker | Reduce spend or investigate (landing page, offer relevance, competition) |
| Spend skew vs plan > 10% | Adjust allocations to match the plan, or update the plan if intentional |
| Spend in off-plan geo | Flag and recommend geo exclusion |
| Low-volume geos (insufficient data) | Monitor only, do not action |

A geo has insufficient data when it falls below the minimum-confidence event threshold in `references/priority-tiers.md`; mark those rows as directional.

Priority tiers (`references/priority-tiers.md`):
- **Critical:** > 25% weaker performance, OR > 1% leakage to unapproved geos, OR > 20% spend skew vs plan.
- **Moderate:** 10–25% weaker performance, OR < 1% leakage, OR 10–20% spend skew.
- **Low:** within the expected range, minor allocation drift.

Skip geos the user has acknowledged in memory.

## Interpretation guide

- Strong geo performance with scalable volume is the highest-leverage finding: reallocating budget to proven geos compounds returns.
- Weak geo performance may stem from the ad, the offer, or the market. Don't assume the geo is bad; investigate landing page relevance and the competitive landscape first.
- Presence or Interest targeting is Google's default and the most common source of geo leakage. Switching to Presence only is a quick win in most accounts.
- Media plan alignment matters for accountability: if actual spend deviates materially, either adjust spend or update the plan to reflect reality.

## Output

One finding: `category: structure`, `kind: audit`. Fill the standard body with:

1. **Coverage check:** % of spend in planned geos | % in off-plan geos.
2. **Geo performance table** (sorted by absolute variance, descending): account | geo | planned % spend | actual % spend | CPA/ROAS vs account avg (% diff) | location setting | priority | recommendation.
3. **Leakage table** (if any): account | campaign | geo | spend | % of campaign spend | severity | recommendation.
4. **Wrap-up:** top scaling opportunities, top reduction targets, leakage issues, location setting flags.
