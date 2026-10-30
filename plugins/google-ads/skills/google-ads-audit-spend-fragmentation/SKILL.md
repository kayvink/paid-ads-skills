---
name: google-ads-audit-spend-fragmentation
description: Quick check of whether a Google Ads account's budget is spread across too many Search and Performance Max campaigns for Smart Bidding to learn, with the share of campaigns below the learning-phase conversion floor, a bid-strategy cross-check and merge candidates. Use when the user asks for a fast read on account structure or fragmentation, or during an account audit. For the deep per-campaign audit with taxonomy-based merge rules use google-ads-check-spend-fragmentation.
---

# Audit spend fragmentation

> Is the account's budget spread across too many campaigns for Smart Bidding to optimise effectively?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The conversion floors come from `references/learning-phase-thresholds.md` and priorities follow `references/priority-tiers.md`.

## Question

How many conversion-focused campaigns fall below the learning-phase threshold, and are there consolidation opportunities that would give Smart Bidding enough signal to work?

## Data required

Run for each account in scope over the last 30 complete days (today excluded). Don't select `segments.date`, so each campaign comes back as one 30-day row.

```sql
-- Campaigns: structure, spend, funnel conversions
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.status,
  campaign.advertising_channel_type, campaign.bidding_strategy_type,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

```sql
-- Primary-action conversions (when a primary action is configured)
SELECT campaign.id, segments.conversion_action_name,
  metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

Exclude awareness and brand-awareness campaigns (bidding `TARGET_IMPRESSION_SHARE` or `TARGET_CPM`, or marked awareness in `ads/taxonomy.md`) and paused campaigns. Read the primary conversion action from `ads/google/index.md`; when it is set, conversions below mean primary-action conversions from the second query (0 for a campaign with no rows there).

## Method

Use Python for every step: load both queries, join on `(customer_id, campaign.id)`, and add `cost = cost_micros / 1e6`.

### 1. Assess conversion sufficiency

For each active campaign, compare 30-day primary conversions against the learning-phase floor (`references/learning-phase-thresholds.md`):

| Campaign type | Minimum conversions (last 30 days) |
|---------------|---------------------------|
| Search | 30 |
| PMax | 50 |

Classify each campaign: meets threshold (yes / no).

### 2. Compute fragmentation severity

Per account, compute `share_below = campaigns below threshold / conversion-focused Search + PMax campaigns`:

| Share below threshold | Severity |
|----------------------|----------|
| < 30% | Acceptable: some campaigns are niche or newly launched |
| 30–50% | Fragmented: signal is being split; identify merge candidates |
| > 50% | Severely fragmented: the majority of campaigns cannot learn effectively |

### 3. Audit bid strategies

For each campaign, record the current bidding strategy (Smart Bidding = `MAXIMIZE_CONVERSIONS`, `MAXIMIZE_CONVERSION_VALUE`, `TARGET_CPA`, `TARGET_ROAS`; everything else is non-Smart). Cross-reference against conversion sufficiency:

| Sufficiency | Bid strategy | Status |
|-------------|-------------|--------|
| Meets threshold | Smart Bidding | Healthy |
| Meets threshold | Non-Smart (Manual CPC, eCPC) | Opportunity: test Smart Bidding |
| Below threshold | Smart Bidding | Risk: insufficient signal for the algorithm |
| Below threshold | Non-Smart | Double issue: low volume + suboptimal strategy |

### 4. Identify merge candidates

Group campaigns by theme (similar naming patterns, overlapping targeting, same conversion actions). In Python, normalise each campaign name (lowercase, strip geo, numbering and match-type tokens such as "exact", "broad", "1", "2") and group below-threshold campaigns of the same channel type by the normalised name; use `ads/taxonomy.md` groups instead when it exists. Flag groups where:
- Multiple campaigns in the same theme each fall below threshold.
- Combined volume would exceed the threshold.
- No structural reason prevents merging (different geos, different funnel stages, or deliberate A/B tests are valid reasons to keep them separate).

Print each candidate group with its combined conversions and combined spend.

### 5. Prioritise recommendations

Apply priority tiers (`references/priority-tiers.md`):
- **Critical:** > 50% of campaigns below threshold, OR below-threshold campaigns on Smart Bidding with material spend.
- **Moderate:** 30–50% below threshold, OR merge candidates with a clear consolidation path.
- **Low:** < 30% below threshold, campaigns newly launched or intentionally niche.

Skip campaigns the user has acknowledged in `ads/google/memory/MEMORY.md` (testing, new markets).

## Interpretation guide

- Fragmentation is about structure, not total volume. An account with 500 conversions a month across 30 campaigns is fragmented; the same volume across 5 campaigns is healthy.
- Below-threshold campaigns on Smart Bidding are actively harming performance: the algorithm makes near-random bid decisions without enough signal. This is higher priority than below-threshold campaigns on manual bidding.
- Not every below-threshold campaign should be merged. Campaigns with distinct geos, distinct funnel stages, or deliberate tests have structural reasons to exist separately. Flag but don't force.
- The typical Smart Bidding onboarding path is: Maximize Conversions (no target) for 2–4 weeks, then introduce tCPA / tROAS based on observed performance.

## Output

One finding: `category: structure`, `kind: audit`. Fill the standard body with:

1. **Coverage summary:** total campaigns (Search + PMax) | meeting threshold (count, %) | below threshold (count, %) | fragmentation severity.
2. **Campaign table** (sorted by spend, descending): account | campaign | type | bid strategy | spend (30d) | conversions (30d) | meets threshold? | priority | recommendation.
3. **Merge candidates** (if any): account | theme | campaigns | combined conversions | combined spend | recommendation.
4. **Wrap-up:** fragmentation severity, the top 2–3 actions, and the conversion volume each merge would pool (the combined 30-day conversions, against the floor).
