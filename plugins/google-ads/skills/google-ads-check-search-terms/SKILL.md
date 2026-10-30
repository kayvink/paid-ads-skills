---
name: google-ads-check-search-terms
description: Audit Google Ads search terms across Search and Performance Max campaigns to find wasted and inefficient spend, propose negative keywords, and spot recurring themes that belong in a shared negative list. Use when the user asks about wasted spend, irrelevant queries, search term reports, negative keywords, or "what are people searching to find our ads".
---

# Check search terms

> Audit search term reports across Search and Performance Max campaigns. Identify high-spend, low-conversion queries; recommend negatives; cluster recurring themes across campaigns.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

For every Search and PMax campaign, pull the search term report, identify queries that waste spend (volume, no conversions) or run inefficiently (conversions, but CPA well above the campaign average), and propose negatives. Cluster recurring wasted themes across campaigns so the user can add shared negative lists rather than piecemeal per-campaign negatives.

## Scope

**Search:** full row-per-query data via `search_term_view`. Detailed recommendations are possible.

**Performance Max:** via `campaign_search_term_insight`. It returns category labels with metrics, and the labels are often specific enough to act on directly (for example `"rooftop bar paris"`). Hard constraints (see step 3b): a per-campaign filter is required, `metrics.cost_micros` isn't available on this resource, and a residual bucket (`id = "0"`, empty label) usually carries most of the traffic but can't be drilled into. **Be honest about the missing cost dimension:** PMax classification uses clicks, conversions and value only, with no CPA-versus-campaign-average comparison.

This skill recommends only. The user adds the negatives.

## Inputs you need

1. **Business context:** `wiki/company.md`. Some terms that look wasteful are legitimate: "free trial" is valid for a freemium SaaS, while "free" is a straight negative for a premium e-commerce brand.
2. **Taxonomy:** `ads/taxonomy.md` for campaign groupings (used to spot cross-campaign themes).
3. **Rules:** `ads/google/rules/*.md` for per-group target CPA or ROAS.
4. **Memory:** `ads/google/memory/MEMORY.md`. Look for acknowledged exceptions (for example "'cheap' is valid for our budget-tier products") and read the individual files for context.
5. **Recent findings:** `ads/google/findings/` from the last 14 days, so you don't re-propose the same negatives.
6. **Primary conversion action and brand terms:** `ads/google/index.md`.
7. **Live data:** the queries below, for each account in scope. Use a 30-day window ending yesterday, written as an explicit `BETWEEN` range.

## Step 1: Search terms on Search campaigns

The "converting" classification uses the primary conversion action when one is configured. Run two queries and join them in Python on `(customer_id, campaign.id, ad_group.id, search_term_view.search_term)`.

**Query A: clicks, impressions, spend and all conversions**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  search_term_view.search_term,
  search_term_view.status,
  metrics.clicks,
  metrics.impressions,
  metrics.cost_micros,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Query B: primary-action conversions** (skip when no primary action is configured, and use `metrics.conversions` from query A instead)

```sql
SELECT
  campaign.id,
  ad_group.id,
  search_term_view.search_term,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

`search_term_view.status` tells you whether the term is already a keyword (`ADDED`), already excluded (`EXCLUDED`), or neither (`NONE`). Skip `EXCLUDED` terms.

## Step 2: Campaign baselines

Use Python to compute each campaign's 30-day totals from the query A rows (all terms, not only flagged ones): sum `cost` and conversions per `(customer_id, campaign.id)`, then campaign CPA = total cost / total conversions. This is the within-campaign baseline the classification compares against. It is deliberately not the rules target: comparing to target is `google-ads-check-pacing`'s job.

## Step 3: Search term insights on PMax campaigns (if present)

`campaign_search_term_insight` constraints:

- **One campaign per query.** `campaign_search_term_insight.campaign_id = <id>` must be in the conditions, otherwise the API returns `REQUIRES_FILTER_BY_SINGLE_RESOURCE`. N PMax campaigns means N queries.
- **`campaign.status` and `campaign.advertising_channel_type` aren't valid filters** on this resource. Find the PMax campaigns with a separate `campaign` query first.
- **`metrics.cost_micros` is blocked** (`PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE`).
- **`id = "0"` is the residual bucket**, always returned with an empty `category_label`. It usually holds most impressions and clicks.
- **Non-residual labels are specific**, often close to the raw search terms, so category-level data is usually actionable without drilling down.

**3a. List PMax campaigns**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
```

**3b. Category-level insights, one query per PMax campaign**

```sql
SELECT
  campaign_search_term_insight.campaign_id,
  campaign_search_term_insight.id,
  campaign_search_term_insight.category_label,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions,
  metrics.conversions_value
FROM campaign_search_term_insight
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign_search_term_insight.campaign_id = <campaign_id>
```

**3c. Raw terms inside one category (optional)**

```sql
SELECT
  segments.search_term,
  segments.search_subcategory,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions,
  metrics.conversions_value
FROM campaign_search_term_insight
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign_search_term_insight.campaign_id = <campaign_id>
  AND campaign_search_term_insight.id = <non-zero category_id>
```

Both filters are required. Skip `id = "0"`. Google often withholds raw terms under privacy thresholds, so an empty result is not an error.

Category labels tend to be tight: a category like `"rooftop bar paris"` drills down to spelling and word-order variants of the same query. For negatives, acting on the label is usually enough (PMax negatives are phrase or exact and Google matches the variants). Only drill down when:
- the label is vague or generic and intent is unclear,
- you suspect an unwanted term hides inside a benign-looking label, or
- a high-click category is flagged as wasted and you want to confirm before recommending a negative.

## Step 4: Volume floor

Only classify terms and categories with meaningful volume. Use Python to drop everything below the floor:

- **Search terms:** keep a term only when `clicks > 30` AND its cost is more than 1% of its campaign's 30-day cost.
- **PMax categories:** cost isn't available, so `clicks > 30` alone. The residual bucket is always above the floor but is handled separately in step 6, never as a negative candidate.

Without the floor the output fills up with long-tail noise.

## Step 5: Classify

Use Python to classify every term and category above the floor:

| Condition | Classification | Default action |
|---|---|---|
| Conversions = 0 | **Wasted** | Add negative |
| Conversions > 0, CPA > 2× campaign CPA | **Inefficient** | Review intent and landing page; negative if the intent doesn't match |
| Conversions > 0, CPA within ±30% of campaign CPA | **Keep** | No action |
| Conversions > 0, CPA below campaign CPA | **Scale** | No negative; consider promoting to a keyword |
| Conversions > 0, CPA between 1.3× and 2× | **Monitor** | Watch; not enough signal yet |

For each Search term, `cpa_vs_campaign = (cost / conversions) / campaign_cpa`. For PMax categories there is no cost, so compare value per click (`conversions_value / clicks`) against the median value per click of that campaign's categories; categories below half the median are **Inefficient**.

Then exclude anything matching an acknowledged exception in memory.

## Step 6: Themes and the PMax residual

**Themes.** Use Python to cluster recurring tokens across the Wasted and Inefficient terms:
- Lowercase and tokenise each flagged term; drop stop words ("the", "a", "of", "and", "for", "in", "near", "me").
- For each token, count the flagged terms containing it and the distinct campaigns they come from, and sum their clicks, cost and conversions.
- A token qualifies as a **shared negative list candidate** when it appears in at least 3 flagged terms AND spans at least 2 campaigns. Typical examples: "free", "jobs", "cheap", "wikipedia", "meaning", "download".

Shared negative lists live at account level and apply to selected campaigns. Recommend one when themes recur; otherwise keep recommendations at campaign or ad-group level.

**PMax residual.** If the `id = "0"` bucket holds more than 50% of a campaign's clicks and its conversion rate is below the campaign's, flag a structural observation: most PMax traffic is uncategorised, so review asset group theming and search themes. That fix is structural, not a negative.

**PMax framing.** Recommendations are coarser because the API returns less: frame them at category level ("add 'food delivery' as a campaign-level negative"), not as lists of guessed queries. You can't tell Search from YouTube or Display placements in this data; say so rather than guess.

## Interpretation rules

- **Severity:**
  - `high`: Wasted spend above 5% of total Search and PMax spend, or a shared-list theme spanning 3+ campaigns with material spend.
  - `medium`: Wasted terms at 1–5% of a campaign's cost; Inefficient terms at 2–3× campaign CPA.
  - `low`: individual low-volume Wasted terms; Monitor candidates.
- Respect memory and `search_term_view.status = EXCLUDED`.
- Don't estimate business impact. Report the spend share on Wasted terms and let the user judge what saving it means.
- Be specific for Search and honest about PMax coarseness.

## Output

One finding: `category: keywords`, `kind: audit`.

**Wrap-up example:** *"8% of Search and PMax spend went to non-converting queries in the last 30 days; 'free' recurs across 4 campaigns and is a shared negative list candidate."*

**General improvements**, for example:
- "Shared negative list candidate: 'free' appears in 12 flagged queries across 4 campaigns with €380 of non-converting spend in 30 days. Consider an account-level list applied to all conversion-focused campaigns."
- "PMax category insights carry clicks and conversions but no cost, so the PMax recommendations below rank by volume, not spend."

**Recommendations:** a table of proposed negatives the user can apply directly:

| account | level | campaign_or_list | negative | match_type | reason |
|---|---|---|---|---|---|
| Acme NL | shared list "Universal negatives" (apply to 4 campaigns) | | free | PHRASE | 12 wasted queries, €380, 0 conv |
| Acme NL | campaign | Non-Brand Generic NL | jobs | PHRASE | 94 clicks, €171, 0 conv |

**Details**, split by source because the columns differ:

*Search, per query*

| account | campaign | ad_group | query | clicks | spend | conversions | cpa_vs_campaign | classification | severity | suggested_action |
|---|---|---|---|---|---|---|---|---|---|---|

*PMax, per category or query where available*

| account | campaign | category_or_query | clicks | conversions | classification | severity | suggested_action | notes |
|---|---|---|---|---|---|---|---|---|

`notes` records what's missing or coarse ("cost not available", "category level only", "source unknown").

*Themes across campaigns*

| theme | campaigns_affected | flagged_queries | total_clicks | total_spend | conversions | recommendation |
|---|---|---|---|---|---|---|

**Pending example**
- title: *8% of Search and PMax spend on non-converting queries; 'free' across 4 campaigns*
- summary: *€380 in 30 days on queries with 0 conversions. 'Free' appears in 12 flagged queries across 4 campaigns, a shared negative list candidate. 3 Search campaigns also have high-CPA queries worth reviewing.*

**OK example**
- title: *Search term hygiene healthy; under 1% of spend on non-converting queries*
- summary: *Checked 842 search terms across Search and PMax for the last 30 days: 67 Search terms and 14 PMax categories above the 30-click floor. Every wasted-spend candidate is under 1% of its campaign; no recurring themes.*
- The body says what was checked (term counts, the floor applied, PMax data limits) and why it passed.

## Workspace writes (when the user confirms)

- The user says a recurring theme is intentional ("'free trial' is valid for us") → write a memory file under `ads/google/memory/` naming the theme, the campaigns and the reason, and add a line to `MEMORY.md`.
- The user agrees with a shared-list proposal → no file write; the recommendations table in the finding is what they apply.

## Evidence rule

Every flagged term cites the exact term or category, campaign, clicks, spend (when available), conversions, CPA against the campaign CPA, and the classification rule it matched:

> *"'free shipping', Non-Brand Generic NL: 87 clicks, €210, 0 conversions in 30 days. Wasted (above the 30-click floor, no conversions). Campaign CPA €45. Proposed: phrase-match negative at campaign level."*

For PMax, state the data limit:

> *"Category 'food delivery services', PMax NL: 124 clicks, cost not available, 4 conversions, category level, source unknown. Inefficient (value per click at 30% of the campaign median). Proposed: campaign-level negative 'food delivery'."*
