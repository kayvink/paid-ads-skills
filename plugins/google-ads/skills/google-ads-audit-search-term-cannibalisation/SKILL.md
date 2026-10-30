---
name: google-ads-audit-search-term-cannibalisation
description: Quick check of Google Ads search terms served by more than one campaign (Search vs Search, Search vs Performance Max, PMax vs PMax), measuring CPC inflation and efficiency gaps and recommending which campaign should own each query, with brand routing out of PMax. Use when the user asks about PMax stealing Search traffic, brand queries in PMax, the same query in several campaigns, or during an account audit. For keyword collisions within a market use google-ads-audit-keyword-cannibalisation.
---

# Audit search term cannibalisation

> Which search terms are being served across multiple campaigns, inflating CPCs and diluting learnings?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Markets follow `references/market-partitioning.md`, and priorities follow `references/priority-tiers.md`.

## Question

Where are Search and PMax campaigns competing for the same search terms, and which campaign should own each query for optimal efficiency?

## Data required

Run for each account in scope; use a 30-day window ending yesterday (excluding today).

```sql
-- Search campaigns: one row per query per campaign
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  ad_group.id, ad_group.name,
  search_term_view.search_term,
  metrics.cost_micros, metrics.clicks, metrics.average_cpc,
  metrics.conversions, metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

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

PMax search terms come from `campaign_search_term_insight` (one query per campaign; see `google-ads-write-gaql-queries`). It returns category labels rather than raw queries, has no cost (so no CPC or CPA), and `id = "0"` is the uncategorised residual (skip it). Labels are usually close to the raw query; compare them with Search queries after normalising both. For PMax rows, efficiency is compared on conversions per click (CPA-focused) or value per click (ROAS-focused), and every PMax comparison is marked as approximate.

When a primary conversion action is configured, pull primary-event conversions for the Search terms with the two-query pattern and use them instead of `metrics.conversions`. Read the primary metric (ROAS or CPA) from `ads/google/rules/`, or ask the user once; read `brand_terms` from `ads/google/index.md`.

## Method

Use Python for every step. Normalise each query and PMax label (lowercase, strip punctuation, collapse whitespace) and stack Search and PMax rows into one table with `customer_id`, `campaign.id`, `campaign_type`, `query`, cost (NaN for PMax), clicks, conversions and value.

### 1. Identify overlapping queries

Group by `(customer_id, query)` and find all search terms appearing in 2+ campaigns. Classify the overlap type from the campaign types in each group:
- Search vs Search
- Search vs PMax
- PMax vs PMax

### 2. Measure overlap impact

For each overlapping query, from per-campaign sums:
- Spend per campaign on that query.
- CPC per campaign = cost / clicks (to detect CPC inflation from self-competition; Search only).
- CPA/ROAS per campaign (Search); conversions or value per click for PMax.
- Total spend across all campaigns on this query (Search spend only; state that PMax spend is not available).
- Best performer = the campaign with the highest ROAS or lowest CPA (or the per-click equivalent when PMax is involved).
- Efficiency gap = the performance difference between best and worst, as a percentage of the worse value: for ROAS `(best - worst) / worst`, for CPA `(worst - best) / best`.

### 3. Prioritise by impact

Weight by: total spend × ROAS/CPA deviation between best and worst. For Search vs PMax groups without PMax spend, use the Search spend. High-spend queries with large efficiency gaps between campaigns are the highest priority.

### 4. Apply routing rules by scenario

**Branded terms (queries containing a brand term), Search vs PMax overlap:**
Search is typically more efficient for brand queries. Recommend adding brand negatives in PMax or splitting brand into a dedicated Search campaign.

**Generic terms, Search vs PMax overlap:**
- If PMax outperforms on the query: reduce Search budget on those queries and let PMax handle them.
- If Search outperforms: route to Search and add negatives to suppress PMax on those terms.
- If performance is similar: keep whichever gives more control (usually Search), unless PMax demonstrates a clear scale advantage.

**Search vs Search overlap:**
Apply the same cannibalisation logic as `google-ads-audit-keyword-cannibalisation`: consolidate to the best performer, add negatives in the other.

**Intentional overlaps (geo splits, test campaigns):**
Keep, but flag them to ensure proper controls are in place. Treat campaigns with different MarketKeys (per `references/market-partitioning.md`) or names marking them as tests as intentional, and confirm with the user when present.

### 5. Classify findings

- **Critical:** branded terms in PMax with Search >= 20% more efficient. Or high-spend generic terms with a > 30% efficiency gap.
- **Moderate:** generic overlap with a 10-30% efficiency gap. Or moderate-spend overlap without a clear winner.
- **Low:** low-spend overlap, or performance within 10% between campaigns.

Apply the minimum-data rule in `references/priority-tiers.md`: below the event threshold, mark the finding as directional.

## Interpretation guide

- Search vs PMax overlap is the most common and highest-impact form. Google's auction dynamics mean PMax and Search can bid against each other on the same query, inflating CPCs for both.
- Brand queries in PMax are almost always a waste: Search is cheaper and offers more control. The exception is when PMax drives incremental Shopping or Display placements that Search can't reach, but for pure search queries, Search wins.
- A CPC difference across campaigns on the same query is the clearest signal of self-competition. If Campaign A pays 20% more CPC than Campaign B on the same query, the overlap is inflating costs.
- Intentional overlaps (geo splits, A/B tests) are legitimate. The audit flags them for transparency but doesn't force consolidation.

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body with:

1. **Coverage summary:** overlapping queries count | % of total search spend at risk (Search spend on overlapping queries / total Search term spend) | overlap types (Search/Search, Search/PMax, PMax/PMax).
2. **Overlap table** (sorted by total spend descending): account | query | campaigns (with type) | spend by campaign | CPA/ROAS by campaign | CPC by campaign | best performer | efficiency gap % | priority | recommendation (Route to X / Add Negatives / Consolidate / Keep).
3. **Impact summary:** estimated wasted spend (non-best spend on Critical rows) | CPC inflation estimate (for Search vs Search groups, the sum over non-best campaigns of `(their CPC - best CPC) × their clicks`).
4. **Wrap-up:** top overlap patterns, brand routing issues, recommended negative keyword actions.
