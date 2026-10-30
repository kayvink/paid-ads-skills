---
name: google-ads-check-keyword-performance
description: Deep audit of Google Ads Search keywords against per-campaign brand and non-brand benchmarks, classifying each keyword as a Winner, Keeper, Lucky Shot, Bleeder, Sleeper or Ghost and diagnosing Bleeders from Quality Score components. Use when the user asks which keywords to pause or scale, why keywords underperform, about keyword-level CPA or ROAS, or for a full keyword audit. For a quick account-level keyword health check use google-ads-audit-keyword-performance.
---

# Check keyword performance

> Audit Search keywords against per-campaign benchmarks. Classify each keyword into one of six buckets (Winners / Keepers / Lucky Shots / Bleeders / Sleepers / Ghosts) and recommend scale / monitor / pause / investigate actions. Run brand and non-brand separately so brand doesn't skew the non-brand averages.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Reading campaign impression share for the Sleepers bucket follows `references/sis-headroom.md`.

## Goal

For every live Search keyword with meaningful volume (≥ 30 clicks OR ≥ €50 spend over 30 days, in the account's currency), compare its CPA or ROAS, CTR and CPC to the relevant benchmark (campaign average, split brand vs non-brand) and classify it. Surface keywords worth pausing, scaling, investigating, or just monitoring. Hypothesise the *why* for Bleeders so the user knows what to check first (landing page, ad relevance, auction, intent).

## Scope

Google Ads Search only. Display, Video, PMax, Shopping and Demand Gen don't have conventional keyword lists in the same sense (PMax has `campaign_search_term_insight`, Shopping has product groups, Display has placements and audiences); other skills cover them. Other search engines such as Microsoft Ads are out of scope; if the user brings their data, treat each engine's keywords on their own and never mix Google and Bing averages.

This skill recommends only. The user applies pauses, bid changes and match-type changes.

## Preconditions

This skill works best when the account has a declared KPI per group; otherwise the "vs average" comparison has no direction.

- `ads/google/rules/<group>.md` present: read the primary KPI (ROAS or CPA) and target per group. Use the KPI direction to compute "better" vs "worse" against the average.
- Rules missing and the user is present: confirm the KPI before running ("is this a ROAS-focused account or a CPA-focused one?"). Offer to save the answer under `ads/google/memory/` so later runs don't re-ask.
- Unattended run with no rules and no memory answer: fall back to CPA-focused for lead-gen, B2B and SaaS business types (per `wiki/company.md`), ROAS-focused for e-commerce. State the assumption explicitly in the finding body.

## Context

Ground truths the skill uses to reason about match types and keyword hygiene. Use these to contextualise classifications and recommendations; do not parrot Google's own messaging on match types, which is self-serving.

**Match type strategy:**
- Independent data across thousands of accounts shows EXACT outperforms BROAD on ROAS, CPA and CTR for about 75% of accounts.
- BROAD + Smart Bidding can outperform EXACT *only* when ALL of these hold: strong conversion tracking, ≥30 primary conversions/month for Search (≥50 for PMax), active ongoing negative-keyword management, non-trivial budget for exploration.
- Without those preconditions, BROAD typically wastes: the algorithm can't steer without signal and budget.
- Default posture: EXACT-led. BROAD is a test, not a default recommendation.
- Google's own documentation pushes BROAD aggressively (it drives their revenue). Treat its guidance as a vendor's sales pitch, not a neutral source.

**Brand keywords specifically:**
- EXACT is the standard for brand defence. It prevents competitor bidding from taking your brand traffic.
- BROAD on brand matches competitor-adjacent and modifier queries (`"cheap X alternative"`, `"X vs Y"`), usually the opposite of what brand defence wants.
- PHRASE is a middle ground; EXACT is tighter.

**Match type mechanics (post-2020, relevant to detecting redundancy):**
- EXACT already includes close variants: misspellings, word order, stemming, synonyms, same-intent paraphrases.
- Enumerating word-order permutations as separate EXACT keywords is redundant: Google collapses them. Flag as technical debt, not active harm.
- PHRASE absorbed BROAD MATCH MODIFIER in 2021; `+modifier` syntax is legacy.

**Budget and volume constraints:**
- Budget-constrained accounts (tight monthly cap, can't afford exploration spend) should lean EXACT-heavy: BROAD needs exploration budget to work.
- Low-conversion-volume campaigns (below the Smart Bidding learning threshold) should not run BROAD: the algorithm can't learn, and spend goes to low-intent queries.

**Keyword hygiene:**
- A high paused-to-enabled ratio is technical debt; it adds audit noise without operational value.
- Legacy forms (`www.`, `.com` fragments, URL-like keywords) match almost nothing useful post-2015.
- Near-duplicate enabled keywords in the same ad group compete in-auction with themselves (self-cannibalisation).
- Single-word or very short BROAD or PHRASE keywords match too broadly to be useful outside Smart-Bidding-with-volume contexts.

## Inputs you need

1. **Business context:** `wiki/company.md`, for the KPI direction fallback and ROAS vs CPA calibration.
2. **Taxonomy:** `ads/taxonomy.md`, for any declared campaign groupings.
3. **Brand terms:** `brand_terms` in `ads/google/index.md`. A keyword is brand when its text contains any brand term, case-insensitive (conventions section 3).
4. **Rules:** list `ads/google/rules/` and read each group file for its KPI and target.
5. **Memory:** `ads/google/memory/MEMORY.md`. Scan for acknowledged exceptions ("defensive brand term, don't flag it") and read the individual files for full context.
6. **Primary conversion action:** `ads/google/index.md`.
7. **Live keyword data:** four queries per account in scope. Use a 30-day window ending yesterday, written as an explicit `BETWEEN` range. Two come from `keyword_view` (spend and funnel, primary event), one at campaign level for impression share (see the note below on why it isn't on the keyword query), and one inventory query.

**Important constraint:** `metrics.search_impression_share` (and the related `*_impression_share` metrics) cannot be combined with `segments.date` on `keyword_view`: the API rejects the query. Pull search impression share (SIS) at campaign level instead, where it's more meaningful anyway for the *"is there auction headroom to scale this keyword?"* question that drives the Sleepers bucket. Apply the campaign's SIS to every keyword inside that campaign when classifying.

**Query A: keyword-level spend and funnel (no impression share)**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  ad_group.id, ad_group.name,
  ad_group_criterion.resource_name,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.ctr,
  metrics.average_cpc,
  metrics.conversions,
  metrics.conversions_value,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM keyword_view
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`ad_group_criterion.status = 'ENABLED'` is intentionally omitted: some field combinations are rejected when that filter is included alongside date and metrics on `keyword_view`. Filter paused and removed criteria in Python after joining with query D. `metrics.conversions` and `metrics.conversions_value` here are Google's aggregate, used only when no primary action is configured.

**Query B: primary-event conversions at keyword level** (skip when no primary event is configured)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  ad_group_criterion.resource_name,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM keyword_view
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

**Query C: campaign-level impression share** (a separate query; impression share is allowed with a date filter at campaign level)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Don't select `segments.date`, so you get one aggregated row per campaign over the window. Map `(customer_id, campaign.id)` to `search_impression_share` and apply it to every keyword inside that campaign. A null share means "not available" (too little volume), not zero.

**Query D: quality score and full keyword inventory** (no `segments.date`, no metrics)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  ad_group_criterion.resource_name,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
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

Query D serves two purposes: (1) per-keyword quality score signals for diagnosis, and (2) **the full keyword inventory including PAUSED and REMOVED criteria**, which lets the skill detect bloat, legacy and near-duplicate patterns (see "General improvements" under Output). Queries A and B only return rows with activity in the window; query D returns the static configuration.

**Join.** Use Python to load the four results and build one keyword table:

- Left-join A to B on `(customer_id, ad_group_criterion.resource_name)`; fill missing primary conversions and value with 0.
- Join query D on the same key for `status` and the quality-info fields, and keep only `ad_group_criterion.status == "ENABLED"` for classification.
- Join query C on `(customer_id, campaign.id)` for `campaign_sis`.
- Add `cost = cost_micros / 1e6`, `tier = "brand"` when the keyword text contains a brand term (case-insensitive), else `"non-brand"`.

All "vs average" and "vs target" comparisons use the **primary-event** counts from query B when available. Fall back to `metrics.conversions` from query A (Google's aggregate) only when no primary event is configured.

## Volume floor

A keyword is **pre-floor** when `clicks < 30` AND `cost < 50` (account currency) over the 30 days. Use Python to set `above_floor = (clicks >= 30) | (cost >= 50)`.

Pre-floor keywords still get classified, but only as **Lucky Shots** or **Ghosts**, never as Bleeders, Winners, Keepers or Sleepers. Low-volume keywords have metrics too noisy to benchmark confidently. Pre-floor keywords that are neither are counted in the totals but not bucketed.

## Benchmarks

**Campaign-level average, split by brand tier.** Use Python to compute, per `(customer_id, campaign.id, tier)`, the pooled averages from summed totals over all enabled keywords in that tier:

- CPA = sum(cost) / sum(primary conversions); ROAS = sum(primary conversion value) / sum(cost).
- CTR = sum(clicks) / sum(impressions); CPC = sum(cost) / sum(clicks).

Compare each keyword against its own tier's average within its own campaign.

**Fallback when a campaign has fewer than 5 above-floor keywords** in a tier: use the group-level average instead, computed the same way over the same tier across all campaigns in the same declared group from `ads/taxonomy.md`. Record which benchmark each keyword used and note the fallback in the finding body so the user knows the benchmark's provenance.

**Never mix brand and non-brand keywords in one average.** Brand always looks better; non-brand always looks worse. Comparing non-brand keywords to the blended average makes all non-brand look like Bleeders.

## Six-bucket classification

Classify each keyword into one bucket. Thresholds are relative to its tier-within-campaign average. "Primary KPI" is ROAS or CPA from rules (or the fallback).

Use Python to compute the deviation first:

- CPA-focused: `kpi_vs_avg = (kw_cpa - avg_cpa) / avg_cpa`; positive is worse.
- ROAS-focused: `kpi_vs_avg = (kw_roas - avg_roas) / avg_roas`; positive is better.
- Normalise to `better = -kpi_vs_avg` for CPA and `better = kpi_vs_avg` for ROAS, so `better > 0.20` means "more than 20% better" and `better < -0.30` means "more than 30% worse" in both cases.
- An above-floor keyword with spend and zero primary conversions has no CPA: treat it as worse than every threshold (a Bleeder) and use `|deviation| = 1` for its impact score. Under ROAS this falls out naturally (ROAS 0 is -100%).
- Also compute `ctr_vs_avg` and `cpc_vs_avg` as `(kw - avg) / avg` for the diagnostic layer.

Then apply the buckets:

| Bucket | Definition | Default action |
|---|---|---|
| **Winners** | Above volume floor; primary KPI > 20% better than avg; containing campaign's SIS ≥ 80% (already capturing most demand) | Keep spend; consider SKAG / siloed test to compound learnings |
| **Keepers** | Above volume floor; primary KPI within ±20% of avg | Keep; no action |
| **Lucky Shots** | Below volume floor; apparent primary KPI > 20% better than avg but 0–30 clicks so evidence is thin | Bid up cautiously; monitor next 2–4 weeks; don't scale aggressively until volume confirms |
| **Bleeders** | Above volume floor; primary KPI > 30% worse than avg | Pause (if > 50% worse and spend material) OR investigate (see hypotheses below) |
| **Sleepers** | Above volume floor; primary KPI > 20% better than avg AND containing campaign's SIS < 50% (room to grow) | Expand: raise budget in the containing campaign or bid up on this keyword specifically |
| **Ghosts** | 0 clicks in 30 days AND > 0 impressions | Pause keyword: it's earning impressions without engagement, cluttering the auction |

Above-floor keywords that fit none of these (20–30% worse than avg, or more than 20% better with campaign SIS between 50% and 80% or not reported) go to **Keepers**, flagged "monitor" in `suggested_action`.

Ambiguity: Winners with high SIS scale differently from Sleepers with low SIS. A keyword > 20% better than avg in a high-SIS campaign (80%+) is already capturing most available demand: scaling means replicating the *approach* (SKAG, sibling keywords). A keyword > 20% better in a low-SIS campaign (< 50%) has headroom: raise bids or budget and volume grows.

**SIS is campaign-level, not keyword-level**, for this classification. `metrics.search_impression_share` can't be combined with `segments.date` on `keyword_view`. Campaign-level SIS answers the real question anyway: *"does this keyword's auction have headroom for it to grow into?"* That's a campaign-scope property, not a keyword-scope one. See `references/sis-headroom.md` for how to read headroom.

## Diagnostic layer: why is a Bleeder underperforming?

Use two signal sources together. Quality Score components are the primary signal (they're Google's own labelled ratings, the most reliable). Observed metric patterns are the fallback when QS is UNKNOWN or the keyword has too little volume for QS to be stable.

### Primary signal: Quality Score components (from query D)

QS fields map directly to specific fixes:
- `ad_group_criterion.quality_info.creative_quality_score` → **Ad Relevance** (how well the ad matches the keyword intent)
- `ad_group_criterion.quality_info.post_click_quality_score` → **Landing Page Experience**
- `ad_group_criterion.quality_info.search_predicted_ctr` → **Expected CTR** (how well the ad is expected to perform for the auction position)

Each returns `ABOVE_AVERAGE`, `AVERAGE`, `BELOW_AVERAGE` or `UNKNOWN`.

| QS signal on a Bleeder | Recommended action |
|---|---|
| Ad Relevance = BELOW_AVERAGE | Update ad copy to align with keyword intent; consider adding negatives if the keyword is catching drifted queries |
| LP Experience = BELOW_AVERAGE | Landing page improvements: relevance to the query's intent, load speed, mobile layout, form friction |
| Expected CTR = BELOW_AVERAGE | Test new ad variants or refine targeting (match type, audience signals, negatives) |
| All three = AVERAGE / ABOVE_AVERAGE but primary KPI still > 30% worse than avg | Review offer competitiveness and market saturation; if consistent over 30+ days and spend is material, pause pending repositioning |
| All three = UNKNOWN | Fall back to the observed metric pattern (below). UNKNOWN typically means low volume or recently created. |

With multiple BELOW_AVERAGE signals, surface all of them in the suggested action. Rule of thumb for which to tackle first: LP > ad copy > targeting. LP issues cascade into everything (low CVR means a bad conversion signal, which means Smart Bidding can't steer); fix the LP first and the other two often improve.

### Fallback signal: observed metric patterns

When QS components are UNKNOWN or volume is too low for QS to be stable, use the observed-metric shape. Use Python to tag each Bleeder by comparing its CTR, CPC and CVR (primary conversions / clicks) with the tier-within-campaign averages; treat "high" as more than 20% above the average, "low" as more than 20% below, and "normal" as within that band.

| Observed shape on a Bleeder | Likely cause | What to check first |
|---|---|---|
| High CPC + normal CTR + low CVR | Landing page issue | LP load time, form friction, LP matches search intent |
| Low CTR + normal CPC | Ad relevance | Headline / keyword alignment, RSA asset mix |
| High CTR + very low CVR | Keyword intent mismatch | Raw search terms this keyword is matching (broad/phrase drift) |
| Normal CTR + high CPC + decent CVR | Auction pressure | Competitor bidding, IS lost to rank, bid strategy headroom |
| Very high impressions, few clicks | Match type too broad | Match type, negative-keyword coverage, search term report |

### Impact score for prioritisation

When sorting Bleeders (and Sleepers) within the output tables, use Python to compute:

```
impact_score = spend_30d × |primary_kpi_deviation|
```

where `primary_kpi_deviation` is the fractional difference from the target (when rules exist) or from the tier-within-campaign average (when there is no target). Higher-impact issues float to the top of the action list: a €4,000 / 30d Bleeder at -40% (impact 1,600) outranks a €300 / 30d Bleeder at -60% (impact 180).

Use `impact_score` for sort order. Severity stays the qualitative bucket (high, medium, low per the interpretation rules).

## Interpretation rules

- **Severity:**
  - `high`: Bleeders with > 50% worse primary KPI AND meaningful spend (> €500 / 30d); Ghosts at meaningful impression volume.
  - `medium`: Bleeders 30–50% worse than avg; Sleepers with clear SIS headroom on good performance.
  - `low`: Lucky Shots (evidence thin, monitor); Keepers within the normal band.
- **Respect memory.** A keyword acknowledged as "defensive brand term, stays regardless of CPA" should not be re-flagged.
- **Don't estimate business impact.** Report wasted-spend % (sum of Bleeder spend / total analysed spend, computed in Python) but don't say "you'd save €X": that's the user's decision.
- **Don't rewrite strategy.** Keyword-level pauses are in scope. Pausing campaigns, moving to Smart Bidding and changing bid strategies belong in other skills (`google-ads-check-spend-fragmentation`, `google-ads-create-channel-rules`).

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body as follows.

**Wrap-up:** one line with the wasted-spend % and the top lever.
Example: *"14% of non-brand spend (€2.1k/mo) on 12 Bleeders; 3 flagged for landing-page review, 5 for pause. 4 Sleepers with SIS headroom: room to scale Non-Brand Generic FR."*

**Per-account summary:** only if multi-account.

**Account bucket summary** (always, near the top). Use Python to count keywords per bucket and the Bleeder + Ghost share of spend, per account and tier:

| tier | total | winners | keepers | lucky_shots | bleeders | sleepers | ghosts | % wasted spend |
|---|---|---|---|---|---|---|---|---|

One row for Brand and one for Non-Brand, per account.

**General improvements:** structural observations, for example:
- "Average non-brand CPA €45 on campaign X; 4 keywords are 2× that. Likely an ad-group-level issue, not individual keywords."
- "Brand keywords on BROAD match: consider tightening to EXACT to reduce drift."
- "Campaign-level averages for 3 campaigns use fewer than 5 keywords; brand-tier averages for those campaigns used the group-level fallback."
- Hygiene from query D, computed in Python: the paused-to-enabled ratio per campaign, legacy URL-like keywords (text containing `www.` or `.com`), near-duplicate enabled keywords in the same ad group (same text after lowercasing, sorting the words and stripping `+`), single-word BROAD or PHRASE keywords, and `+modifier` syntax.

**Recommendations:** structural changes (match-type reviews, negative list updates, ad-group reorganisation), plus a table of keyword-level actions the user applies: account | campaign | ad_group | keyword | match_type | current state | proposed action | reason.

**Details tables, per campaign, split by tier (brand / non-brand).** Sort within each table by `impact_score` descending, then by severity. Bleeders and Ghosts rise naturally via impact; Sleepers follow; Keepers and Lucky Shots sit at the bottom. Cap at about 15 rows per campaign; summarise the tail if longer.

| account | campaign | tier | keyword | match_type | spend | kpi_vs_avg | ctr_vs_avg | cpc_vs_avg | ad_relevance | lp_experience | expected_ctr | bucket | impact_score | severity | suggested_action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

`ad_relevance`, `lp_experience` and `expected_ctr` values: `ABOVE` / `AVG` / `BELOW` / `—` (abbreviated from the QS enum; use `—` for UNKNOWN).

`suggested_action` comes from the diagnostic layer: name the specific fix (*"update ad copy; keyword drift to check"*, *"LP improvements: load speed"*, *"pause; no QS issues but ROAS poor for 45 days"*), not just `investigate`.

For very large accounts (> 20 campaigns), cap the tables to the top 8 campaigns by total flagged `impact_score`; summarise the tail.

**Impact summary** at the end of the body. Drivers grouped by the diagnostic classification (QS-primary, falling back to observed pattern); compute the sums in Python:
- *"% of analysed spend on Bleeders / Ghosts: X%"*
- *"Problem drivers (by flagged spend): LP issues €X (N keywords), ad relevance €Y (N), expected CTR / targeting €Z (N), offer/competition €W (N), match-type drift €V (N)"*
- *"Highest-impact single keyword: 'X' (€Y at -Z%)"*: name the top `impact_score` row so the user knows where to start.

The plain-language wrap-up echoes this structure, for example *"14% of spend wasted on 12 keywords. 5 flagged for LP improvements, 3 for ad copy, 2 for creative testing, 2 for pausing. Start with 'running shoes' (€680 on Brand FR): highest impact."*

**Pending example:**
- title: *14% non-brand spend on 12 Bleeders; 4 Sleepers with room to scale*
- summary: *€2.1k/mo on underperforming non-brand keywords. 5 flagged for LP improvements (QS: LP Experience below avg), 3 for ad copy (Ad Relevance below avg), 2 for pausing (all QS avg+ but ROAS -55% for 45 days). 4 Sleepers at >20% better than avg with campaign SIS under 50%: room to expand.*

**OK example:**
- title: *Keyword performance within range across all campaigns; no material Bleeders*
- summary: *Analysed 184 keywords (84 brand, 100 non-brand) across 5 Search campaigns. All primary-KPI deltas within ±25% of tier-within-campaign averages. No Bleeders above severity threshold; 2 Sleepers with minor SIS headroom noted but below action threshold.*
- Body: what was checked (campaigns, keywords by tier, benchmark method, volume floor applied) and why it passed.

## Workspace writes (when the user confirms)

- The user acknowledges a keyword exception ("defensive brand term, ignore CPA") → write a new file under `ads/google/memory/` with a scoped note (keyword text, match type, reason, date), then add a one-liner to `MEMORY.md`.
- The user confirms the KPI direction for the first time (no rules declared) → write it under `ads/google/memory/` so later runs don't re-ask. Suggest running `google-ads-create-channel-rules` for a proper KPI declaration.
- Pauses, scales and match-type changes happen in the platform: the finding records the recommendation, the user applies it.

In an unattended run, write only the finding; leave memory and rules untouched.

## Evidence rule

Every classification cites: keyword text, match type, 30-day spend, 30-day clicks, 30-day conversions (primary event and funnel), primary KPI, tier-within-campaign average, % delta vs average, campaign SIS, QS component values when available, and the diagnostic path (QS signal or observed-pattern fallback). Example:

> *"Keyword 'running shoes' (BROAD), Non-Brand Generic FR: €680 / 30d, 412 clicks, 4 primary conversions, CPA €170 vs non-brand avg €52 (+227%, >50% worse). Campaign SIS 62%. QS components: Ad Relevance ABOVE_AVERAGE, LP Experience BELOW_AVERAGE, Expected CTR AVERAGE. Diagnostic: LP Experience below avg + decent CTR + low CVR, landing page mismatch. Impact score: 680 × 2.27 = 1,544. Suggested action: LP improvements (intent alignment, form friction) before pausing."*

No "underperforming" without the numbers, the tier average and the diagnostic source (QS component or observed pattern).
