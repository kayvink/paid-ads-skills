---
name: google-ads-check-keyword-expansion
description: Find non-brand Google Ads search terms from Search and Performance Max that convert at or above benchmark but aren't covered by any keyword, and recommend EXACT adds, new themed ad groups, or PMax-to-Search promotions. Use when the user asks which keywords to add, about keyword expansion, converting queries without a keyword, or what PMax is finding that Search should target. The mirror of google-ads-check-search-terms (same data, opposite goal). For a quick structural check of the expansion process use google-ads-audit-keyword-expansion.
---

# Check keyword expansion

> Find non-brand search terms driving conversions or strong ROAS that aren't covered by existing keyword targeting. Recommend adding them as EXACT, clustering them into new ad groups where themes emerge, or promoting them from PMax to Search. Mirror operation to `google-ads-check-search-terms`: same data, opposite goal.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. For the insight-resource and primary-conversion query patterns, the `google-ads-write-gaql-queries` skill has the details.

## Goal

For every live Search and PMax campaign, identify search terms that (a) convert at or above the campaign's average, (b) have meaningful volume, (c) aren't brand terms, and (d) aren't already captured as keywords anywhere in the account. Recommend promotion as EXACT keywords, grouped into new ad groups when recurring themes appear. Focus on actionable expansion, not a dump of every high-performing variant.

## Scope

Google Ads only. Covers:
- **Search:** full row-per-query support via `search_term_view`; the `status` field gives a clean coverage signal.
- **Performance Max:** per campaign via `campaign_search_term_insight`. There is no cost metric on this resource, so classification relies on clicks, conversions and value only. PMax expansion recommendations are "promote this to Search as an EXACT keyword", not "add to PMax" (PMax doesn't use keywords).

Cross-channel expansion (Meta to Google and so on) is out of scope. Microsoft Ads and other engines are out of scope too.

This skill recommends only. The user adds the keywords and builds the ad groups.

## Preconditions

Works with or without declared rules, but better with them.

- `ads/google/rules/<group>.md` present: use the per-group target ROAS or CPA as the "good performance" threshold. Cleaner than campaign averages.
- Rules missing: fall back to the campaign-level average as the benchmark. Note the fallback in the finding body.
- **Brand terms** must be set (`brand_terms` in `ads/google/index.md`, conventions section 3). Without them, brand traffic gets mixed into the non-brand analysis and brand will look like the biggest expansion opportunity (it's not: brand is already captured). If they're missing, propose a list and confirm it before running.

## Context

Ground truths for keyword expansion. Use these to contextualise recommendations.

**Expansion mechanics:**
- EXACT keywords take precedence over BROAD and PHRASE in Google's matching: adding a term as EXACT works even if a broader keyword is currently catching it. No need to remove the broader keyword first.
- Adding a converting query as EXACT gives tighter bid control and clearer attribution than relying on a BROAD keyword to catch it.
- Not every high-performing variant should become its own keyword. Google's EXACT already handles misspellings, word order, stemming and close paraphrases: adding 8 permutations of the same intent is technical debt, not coverage.

**PMax to Search promotion:**
- PMax search-term insights often surface high-intent queries that deserve dedicated Search targeting. Promoting these to Search as EXACT gives predictable bid control, clearer budget accounting, and an escape from PMax's black-box attribution.
- PMax doesn't have keywords of its own, so "expansion in PMax" isn't a thing. The recommendation is always "move to Search" or "no action".
- The residual bucket (`campaign_search_term_insight.id = "0"`) is a blind spot: terms inside it aren't identifiable or drillable. We can't expand what we can't see.

**Brand vs non-brand:**
- Brand terms are already captured by the brand campaign's keyword list (that's what brand campaigns exist for). Expansion on brand is noise: skip terms that contain a brand term.
- Exception: if a brand-adjacent query is matching via a non-brand campaign's broad keyword and outperforming, that's a brand-routing issue, not expansion. Flag it for structure review.

**Hygiene guardrails:**
- Never recommend adding a query that already exists as a keyword in *any* campaign (not just the current one). Duplicate keywords across ad groups cause self-cannibalisation and unpredictable routing.
- Cluster before recommending. 5 converting queries around the same theme rarely need 5 individual keyword adds; they usually want one thematic ad group with 1–2 EXACT keywords that Google's matching will expand to cover the variants.

## Inputs you need

1. **Business context:** `wiki/company.md`, for the KPI direction fallback (ROAS-focused vs CPA-focused).
2. **Taxonomy:** `ads/taxonomy.md`, for declared groupings.
3. **Brand terms and primary conversion action:** `ads/google/index.md`. Critical: without brand terms, brand traffic pollutes the analysis.
4. **Rules:** list `ads/google/rules/` for per-group target KPIs. Fall back to campaign averages when missing.
5. **Memory:** `ads/google/memory/MEMORY.md`. Scan for previously rejected expansion proposals and "don't add this term" notes; read the individual files for full context.
6. **Existing findings:** `ads/google/findings/` for recent keyword-expansion findings; append an update rather than creating a duplicate (conventions section 4).
7. **Search-term data:** the same queries as `google-ads-check-search-terms`. If both skills run in one session, reuse the saved results rather than re-querying. Use a 30-day window ending yesterday, written as an explicit `BETWEEN` range, for each account in scope.

### Step 1a: Search terms (Search campaigns)

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
  metrics.conversions,
  metrics.conversions_value,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

When a primary event is configured, also run the primary-event query (the second half of the two-query pattern in `google-ads-write-gaql-queries`):

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

Use Python to left-join it onto step 1a on `(customer_id, campaign.id, ad_group.id, search_term_view.search_term)`, filling missing primary conversions with 0. Use the primary-event counts for the benchmark comparison; use `metrics.conversions` from step 1a only when no primary event is configured.

`search_term_view.status` is the key signal:
- `NONE`: not a keyword. Expansion candidate if performance clears the floor.
- `ADDED`: already a keyword. Skip.
- `EXCLUDED`: already a negative. Skip; never propose adding it as a positive.

### Step 1b: PMax search term insights (per campaign)

List the PMax campaign IDs first, then loop:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
```

Then for each PMax campaign:

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

`metrics.cost_micros` is not available on this resource, so classification uses clicks, conversions and value only. `id = "0"` is the residual bucket and cannot be an expansion candidate (there is no specific term to add).

### Step 1c: Existing keyword inventory (for deduplication)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  ad_group_criterion.resource_name,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.status
FROM ad_group_criterion
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = FALSE
```

Used to check whether a candidate term already exists as a keyword *anywhere* in the account (not just the current campaign). If it does, don't propose adding it: that's duplication. Surface it as a routing observation instead (*"'running shoes' performs well in Campaign A but is already an EXACT keyword in Campaign B: check routing and ad-group fit"*).

## Candidate filter

Use Python to apply the filter. First compute the benchmarks per `(customer_id, campaign.id)` from all of that campaign's rows (not only candidates): Search campaign ROAS = sum(primary value) / sum(cost), CPA = sum(cost) / sum(primary conversions), campaign spend = sum(cost); PMax campaign value per click = sum(value) / sum(clicks) and conversions per click = sum(conversions) / sum(clicks) over all categories including the residual. Use the target from rules instead of the average when one is declared.

A term must pass ALL of these to be an expansion candidate:

1. **Not brand:** contains no brand term (case-insensitive). Brand terms are already in the brand campaign.
2. **Volume floor:** meets one of:
   - **Search:** ≥ 2 primary conversions OR ≥ 1% of campaign spend over 30 days
   - **PMax:** ≥ 2 primary conversions (no spend signal available)
3. **Performance floor:** one of:
   - ROAS ≥ campaign-average ROAS (or ≥ target ROAS when rules are declared)
   - CPA ≤ campaign-average CPA (or ≤ target CPA when rules are declared)
   - For PMax, where neither exists, use value per click ≥ the campaign's value per click (ROAS-focused) or conversions per click ≥ the campaign's (CPA-focused), and mark it approximate.
4. **Not already covered:** one of:
   - Search: `search_term_view.status = NONE`
   - PMax: the term doesn't match any existing EXACT keyword in the account (per step 1c)
5. **Not previously rejected:** not flagged with a "don't add" acknowledgement in `ads/google/memory/`.

## Coverage classification

For surviving candidates, label the current coverage state. Use Python to normalise both the candidate and every keyword from step 1c the same way (lowercase, strip punctuation, drop a trailing plural "s" from each word, sort the words) and compare the normalised forms.

| Coverage state | Detected by | Recommended action |
|---|---|---|
| Uncovered (Search, status=NONE, no matching keyword anywhere) | `search_term_view.status = NONE` AND not in the step 1c keyword list | Add as EXACT in the ad group most thematically aligned |
| Uncovered (PMax, not in any Search keyword list) | PMax category or term AND not in the step 1c keyword list | Promote to Search: add as EXACT in a relevant Search ad group, or create a new one |
| In another campaign | Term text matches an existing EXACT keyword in a *different* campaign | Routing or structure observation, not an expansion. Surface for review: *"converting here but the keyword lives elsewhere: intentional split or routing misfire?"* |
| Close variant of existing | Term text differs from an existing EXACT keyword only by order, stemming or close variant (the normalised forms match, the raw text doesn't) | Skip: Google's EXACT already matches. Not a real gap. |

## Theme clustering

Before listing individual candidates, cluster recurring tokens to surface "new ad group" opportunities. Use Python:

- Tokenise each candidate, lowercased (drop stop words: "the", "a", "of", "and", "for").
- For each token, count the candidate queries containing it, the distinct ad groups and campaigns they come from, and their summed primary conversions.
- A theme qualifies for a "new ad group" recommendation when:
  - the same token appears in ≥ 3 candidate queries, AND
  - it spans ≥ 2 ad groups OR campaigns, AND
  - combined conversions are ≥ 10 over 30 days.

Theme recommendations beat individual keyword adds when they apply. 5 converting queries around "eco-friendly [X]" become 1 new ad group with 1–2 EXACT keywords, not 5 individual additions.

## Impact score

Use Python to rank candidates by:

```
impact_score = primary_conversions × max(0, roas_vs_avg_deviation)
```

where `roas_vs_avg_deviation` is the fractional difference from the campaign or target benchmark: `(term_roas - benchmark_roas) / benchmark_roas`. For CPA-focused accounts use `(benchmark_cpa - term_cpa) / benchmark_cpa`, so a cheaper CPA is a positive deviation. Only positive deviations count (by definition, candidates must already outperform to survive the filter).

PMax candidates: no cost, so the deviation is computed from value per click (`conversions_value / clicks`) against the campaign's value per click. This is approximate; surface the approximation note in the output.

Higher-impact candidates float to the top of the action list. Typical cutoff for "act now" vs "monitor": the top 5–10 by impact score; the tail stays as "monitor for scaling potential if volume grows".

## Interpretation rules

- **Severity:**
  - `high`: candidates in the top 3 by impact score, OR themes warranting new ad groups (a multi-keyword cluster with a strong aggregate conversion signal).
  - `medium`: individual candidates outside the top 3 but clearly above the volume and performance floors.
  - `low`: borderline candidates (just above the volume floor, ROAS close to average): monitor rather than act.
- **Respect memory:** previously rejected terms stay rejected until the user explicitly lifts the acknowledgement.
- **Don't recommend more than about 10 keyword adds in one finding.** Expansion should be a curated list, not a dump. If 50 candidates survive the filter, group by theme and recommend at the theme level.
- **Don't propose PMax keyword adds:** PMax doesn't use keywords. Recommendations for PMax terms are always "promote to Search".

## Output

One finding: `category: keywords`, `kind: recommendation` (it's a proposal to adopt, not a diagnostic audit). Fill the standard body as follows.

**Wrap-up:** one line with the uncovered converting spend % and the top theme or action.
Example: *"12% of converting spend on 10 uncovered queries; a cluster around 'eco-friendly [X]' (5 queries, 18 conversions) warrants a new ad group. 3 standalone EXACT adds and 2 PMax promotions round out the list."*

**Per-account summary:** only if multi-account.

**Coverage summary** (always). Compute in Python from the step 1a rows that have primary conversions > 0:
- % of 30-day converting spend on terms already covered as keywords (Search side, status = ADDED)
- % on uncovered terms (status = NONE): the expansion opportunity surface
- PMax split: % of PMax conversions attributed to categories that have a Search-keyword equivalent vs those that don't

**General improvements:** structural observations, for example:
- "PMax campaign X is absorbing 8 high-converting queries that have no Search coverage; promoting these to a dedicated Search campaign would improve bid control and attribution clarity."
- "Non-brand campaign Y has no ad group for [theme] despite 12 converting queries on the theme over 30 days."

**Recommendations:** cluster-level structural proposals (new ad groups, promotion campaigns), then three tables the user can apply directly.

*Proposed keyword adds*

| account | campaign | ad_group | keyword | match_type | conversions_30d | roas_vs_avg |
|---|---|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | Running | eco-friendly running shoes | EXACT | 8 | +40% |

*Proposed new ad groups*

| account | campaign | new ad group | keywords (EXACT) | theme evidence |
|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | Eco-friendly (EXACT) | eco-friendly running shoes; sustainable running shoes | 5 queries, 18 conversions |

*PMax to Search promotions*

| account | source PMax campaign | term | target campaign | target ad group | match_type | evidence |
|---|---|---|---|---|---|---|
| Acme FR | PMax FR | rooftop bar paris | Non-Brand Generic FR | Generic Paris FR | EXACT | 4 conversions, 71 clicks |

**Details table:** per candidate, sorted by impact score descending, capped at about 15 rows:

| account | source | campaign | ad_group | query_or_category | primary_conversions | spend | roas_vs_avg | coverage_state | cluster | impact_score | severity | suggested_action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

- `source`: `Search` or `PMax`.
- `cluster`: the theme name if the candidate belongs to a multi-keyword cluster; blank for standalone.
- `suggested_action` examples: *"Add as EXACT in Non-Brand Generic FR / 'running shoes' ad group"*, *"Promote to Search: create EXACT in non-brand campaign"*, *"Routing review: already EXACT in Campaign X"*, *"Monitor: above floor but borderline"*.

**Theme summary** at the end of the body, before the plain-language summary:

> "Themes worth clustering into ad groups:
> - 'eco-friendly [X]': 5 queries, 18 conversions, impact X. Recommend a new ad group in Non-Brand Generic FR.
> - '[colour] running shoes': 4 queries, 12 conversions, impact Y. Recommend a new ad group or sub-group."

**Plain-language summary,** the final line:

> "14% of conversions from 10 uncovered queries. 5 standalone EXACT adds (top: 'X'), 1 new ad group around 'eco-friendly [X]', 2 PMax-to-Search promotions, 2 monitor-only. 1 routing issue flagged."

**Pending example:**
- title: *10 uncovered converting queries; 1 theme warrants a new ad group*
- summary: *14% of 30-day conversions from queries not in the keyword list. Top 5 impact scores range €180 to €620 of efficiency upside. Theme 'eco-friendly [X]' recurs across 3 ad groups and warrants a dedicated ad group. 2 PMax terms worth promoting to Search.*

**OK example:**
- title: *Keyword coverage healthy; no material expansion candidates*
- summary: *Analysed 284 non-brand search terms over 30 days. All high-performing terms above the volume and ROAS floor are already covered as EXACT keywords, or are close variants of existing EXACT keywords (Google's matching covers them). No PMax categories warrant Search promotion at current performance.*
- Body: what was checked (search term counts, the candidate filter breakdown, PMax campaigns scanned, the residual bucket noted as a blind spot) and why it passed.

## Workspace writes (when the user confirms)

- The user says a candidate should not be added ("we tested that theme last year, it didn't work") → write a new file under `ads/google/memory/` with a dated rejection note, then add a one-liner to `MEMORY.md` so the skill doesn't re-propose it.
- The user confirms a structural observation ("yes, PMax is absorbing queries we want in Search") → write it under `ads/google/memory/` so future runs align.
- Actual keyword adds and ad group creation happen in the platform: the finding records the recommendation, the user applies it.

In an unattended run, write only the finding; leave memory untouched.

## Evidence rule

Every candidate cites: query text, source (Search or PMax), campaign, ad group (Search only), 30-day primary conversions, 30-day spend (Search; not available for PMax), ROAS vs benchmark, coverage state (with the specific reason: NONE status, not in the keyword inventory, and so on), and impact score. Example:

> *"Query 'eco-friendly running shoes', Search, Non-Brand Generic FR / Running ad group: €340 / 30d, 8 primary conversions, ROAS 4.8 vs campaign avg 3.2 (+50%). search_term_view.status = NONE; confirmed not in any keyword in the account. Impact score 8 × 0.5 = 4.0. Cluster 'eco-friendly': 5 queries, 18 conversions over 30 days, candidate for a new dedicated ad group."*

No "high-performing uncovered query" claims without the numbers, the coverage check and the cluster context where applicable.
