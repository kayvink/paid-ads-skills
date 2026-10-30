---
name: google-ads-audit-keyword-cannibalisation
description: Quick check of Google Ads keyword and search query collisions where two or more campaigns in the same market compete for the same keyword or query, measuring the spend share going to the worse-performing duplicate and flagging brand cannibalisation. Use when the user asks about campaigns competing with each other, duplicate keywords across campaigns, internal competition within a market, or during an account audit. For Search vs Performance Max query overlap and routing use google-ads-audit-search-term-cannibalisation.
---

# Audit keyword cannibalisation

> Are multiple campaigns competing for the same keywords or search queries within the same market, wasting spend on underperforming duplicates?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Markets are resolved with `references/market-partitioning.md`, and priorities follow `references/priority-tiers.md`.

## Question

Which keywords and search queries are triggering ads from more than one campaign in the same market, and how much spend is going to the worse-performing variant?

## Data required

Run for each account in scope; use a 30-day window ending yesterday (excluding today).

```sql
-- Campaigns
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

```sql
-- Location targeting per campaign (positive targets only)
SELECT campaign.id, campaign_criterion.location.geo_target_constant
FROM campaign_criterion
WHERE campaign_criterion.type = 'LOCATION'
  AND campaign_criterion.negative = FALSE
  AND campaign.status = 'ENABLED'
```

```sql
-- Resolve the targeted locations to countries
SELECT geo_target_constant.resource_name, geo_target_constant.name,
  geo_target_constant.country_code, geo_target_constant.target_type
FROM geo_target_constant
WHERE geo_target_constant.resource_name IN ('<geoTargetConstants/...>', ...)
```

```sql
-- Keyword performance
SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM keyword_view
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Search term performance
SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
  search_term_view.search_term,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

When a primary conversion action is configured, pull primary-event conversions for keywords and search terms with the two-query pattern in `google-ads-write-gaql-queries` and use them instead of `metrics.conversions`.

**User inputs:** the primary metric (ROAS or CPA; from `ads/google/rules/` when declared), the brand terms (`brand_terms` in `ads/google/index.md`), the market encoding convention (from `ads/taxonomy.md` when present), `tier_as_market` (default true) and whether GLOBAL collides with named countries (`global_collides_with_named`, default: no). Ask once when the user is present and these aren't in the workspace; otherwise use the defaults and say so.

## Method

Use Python for every step. Key campaigns on `(customer_id, campaign.id)`; never compare campaigns across accounts.

### 1. Assign MarketKeys

Follow the market partitioning hierarchy in `references/market-partitioning.md`:
1. Derive LocMarket from the targeted locations: collect the distinct `country_code` values per campaign (single country > multi-country set > GLOBAL > UNKNOWN; a campaign with no location criteria targets everywhere, which is GLOBAL).
2. Extract GeoTokens and TierTokens from campaign names (lowercase, split on delimiters such as `|`, `-`, `_`, space), matched against the token lists in the reference.
3. Resolve the final MarketKey: LocMarket (if single country) > GeoToken > TierToken (if `tier_as_market` is true) > GLOBAL > UNKNOWN.
4. Apply the integrity assertion: if the MarketKey is a Tier but the campaign has a single-country LocMarket or a GeoToken, override to the geo and flag it.

Output a Market Audit Table for transparency: Campaign | Locations Targeted | NameMarket | LocMarket | MarketKey | Match? | Note.

### 2. Detect query-level collisions

Attach the MarketKey to each search term row, then group the rows by `(customer_id, query, MarketKey)` with per-campaign sums of cost, conversions and value. Keep only groups with 2+ campaigns.

For each collision group:
- TotalSpend = sum of spend across all campaigns on that query.
- Best = the campaign with the highest ROAS (or lowest CPA, per the user's metric), computed from that campaign's sums for the query.
- NonBestSpendShare% = (non-best spend / TotalSpend) × 100, rounded to a whole %.
- PerfGap%: for ROAS = ((BestROAS - WorstROAS) / WorstROAS) × 100; for CPA = ((WorstCPA - BestCPA) / BestCPA) × 100. When the worst campaign has no conversions (ROAS 0 or CPA undefined), report the gap as "not computable, worst variant has no conversions" and treat it as ≥ 30%.
- Flag "low data" if total conversion events < 20.
- Flag "brand cannibalisation" if the query contains a brand term and appears in a non-brand campaign (non-brand per `ads/taxonomy.md`, or a campaign name without "brand").

### 3. Detect keyword-level collisions

Create key = lower(keyword_text) + "|" + match_type. Group by `(customer_id, key, MarketKey)`. Keep groups with 2+ campaigns or ad groups.

Apply the same metrics as for query collisions. Exception: similar keywords within the same ad group are not flagged unless the worse variant spends materially more than the better one.

### 4. List cross-market overlaps

Queries or keywords appearing in campaigns with different MarketKeys are listed as cross-market overlap (audit-only, not actionable): group by query alone and keep groups whose campaigns span 2+ MarketKeys. Note the overlap without recommending intervention. With `global_collides_with_named` false, GLOBAL vs named-country pairs belong here too.

### 5. Prioritise and recommend

Apply the priority tiers in `references/priority-tiers.md`:

| Tier | Condition |
|------|-----------|
| Critical | NonBestSpendShare% >= 30% AND (PerfGap% >= 30% OR brand cannibalisation flag) |
| Moderate | NonBestSpendShare% 5-30% OR notable absolute spend on non-best |
| Low | NonBestSpendShare% < 5% AND low absolute spend |

For each collision:
- Critical with brand cannibalisation: consolidate to the best performer, add exact/phrase negatives in the others, route brand queries to a brand-only campaign.
- Critical non-brand: consolidate to the best performer, add negative keywords in the losing campaigns, consider pausing the underperformer.
- Moderate: investigate intent or test nuance, consider negatives, cap the losers.
- Low: monitor, no immediate action.

## Interpretation guide

- High NonBestSpendShare% with high PerfGap% means significant budget actively wasted on worse-performing duplicates. The gap compounds daily.
- Brand queries in non-brand campaigns are always Critical: they inflate non-brand CPA and leak brand equity to uncontrolled ad copy.
- Low-data collisions (< 20 events) are directional, not definitive. Present them with the qualifier.
- Cross-market overlaps are expected in multi-geo accounts. Flag for awareness, not action.

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body with:

1. **Market audit table:** account | campaign | locations targeted | NameMarket | LocMarket | MarketKey | match? | note.
2. **Consolidated collision table** (sorted by NonBestSpendShare% descending): account | level (Query/Keyword) | term | MarketKey | campaigns | ad groups | total spend | NonBestSpendShare% | best performer | PerfGap% | priority | recommendation.
3. **Cross-market overlaps** (if any): term | campaigns | MarketKeys | why ignored.
4. **Impact summary:** estimated avoidable spend = the sum of non-best spend on Critical rows (computed in Python).
5. **Wrap-up:** 2-4 bullets: the biggest fixes, persistent name-vs-location mismatches, brand cannibalisation instances.
