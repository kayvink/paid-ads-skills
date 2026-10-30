---
name: google-ads-analyze-auction-insights
description: Analyse the Google Ads competitor landscape from Auction insights (impression share, overlap rate, position above rate, top of page rate, absolute top of page rate, outranking share) by Search campaign and over time, flag new entrants, competitors increasing pressure and competitors leaving, and relate those moves to the account's own impression share, rank-lost share and CPC trend. Falls back to an Auction insights CSV exported from the Google Ads interface when the API fields are not available to the account. Use when the user asks who they compete with, whether a new competitor appeared, why CPCs or impression share moved, about auction insights or auction pressure. For a full diagnosis of a performance drift use google-ads-diagnose-trend-drift; for impression share headroom and scaling use google-ads-find-scale-candidates.
---

# Analyse auction insights

> Who is in the auctions with you, who is gaining, and is the competition the reason your impression share or CPC moved?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Confidence tiers follow `references/priority-tiers.md`.

## Goal

For each Search campaign with enough impressions, build a competitor table per time window, then answer:

1. **Who is there?** The domains sharing the account's auctions, ranked by overlap and impression share.
2. **What changed?** New entrants, competitors increasing pressure, and competitors leaving, between a baseline and the latest window.
3. **Does it explain the account's own trend?** Whether the account's impression share, rank-lost impression share, top-of-page share and CPC moved in the direction the competitor moves predict.

## Scope

Search campaigns (`campaign.advertising_channel_type = 'SEARCH'`). Shopping campaigns have Auction insights in the interface with fewer columns (impression share, overlap rate, outranking share); include them only from a CSV export. Performance Max is out of scope for the API path.

Auction insights describe auctions the account entered. They say nothing about auctions it never entered (keywords it doesn't bid on), and they never show competitors' spend, bids or CPCs. A "spend increase" by a competitor can only be inferred from their impression share rising.

**Data access.** The API exposes these metrics through `segments.auction_insight_domain` and the `metrics.auction_insight_search_*` fields, but only to accounts and developer tokens that Google has allowlisted. Most connections will not have them. Step 1 checks; step 2b covers the CSV fallback, which works for everyone.

## Inputs you need

1. **Index:** `ads/google/index.md` for brand terms (brand and non-brand campaigns face different competitor sets; analyse them separately).
2. **Memory:** `ads/google/memory/MEMORY.md` for known competitors, resellers, affiliates or partner domains the user has named (a reseller bidding on the brand may be allowed).
3. **Previous snapshots:** `ads/google/analyses/*-auction-insights.md`. A saved snapshot gives a baseline when the API path isn't available and the user exports only the latest window.
4. **Recent findings:** `ads/google/findings/` from the last 14 days, especially `google-ads-diagnose-trend-drift` and `impression-share-losses` results that asked for an auction read.
5. **Live data or a CSV:** steps 1–2 below.

**Windows.** Auction ratios cannot be re-aggregated from daily rows (you don't know each competitor's impressions), so pull one aggregate per window rather than per day. Default: four consecutive 28-day windows ending yesterday (W1 oldest to W4 latest). Baseline = W1–W3, latest = W4. For a quick read, two windows (previous 28 days vs last 28 days). Drop a window that overlaps a known tracking outage or a major account change, and say so.

## Step 1: Check API access

Call `get_resource_metadata` for the `campaign` resource and look for `segments.auction_insight_domain` and `metrics.auction_insight_search_impression_share` among the selectable fields. Then run one small probe for the highest-spend Search campaign:

```sql
SELECT
  campaign.id,
  segments.auction_insight_domain,
  metrics.auction_insight_search_impression_share
FROM campaign
WHERE campaign.id = <campaign_id>
  AND segments.date BETWEEN '<start>' AND '<end>'
LIMIT 10
```

- Rows come back → API path (step 2a).
- The fields are missing from the metadata, or the query errors with a permission or "not allowed" message → CSV path (step 2b). Tell the user plainly that their API access doesn't include Auction insights; it isn't a fault in their account.

## Step 2a: Pull Auction insights from the API

Run once per window, per account:

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  segments.auction_insight_domain,
  metrics.auction_insight_search_impression_share,
  metrics.auction_insight_search_overlap_rate,
  metrics.auction_insight_search_position_above_rate,
  metrics.auction_insight_search_top_impression_percentage,
  metrics.auction_insight_search_absolute_top_impression_percentage,
  metrics.auction_insight_search_outranking_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<window_start>' AND '<window_end>'
```

Confirm each metric name with `get_resource_metadata` before the first run; drop any that aren't selectable and say which ones are missing. The same segment is available on `ad_group` when a campaign mixes very different themes.

Then the account's own side, same windows:

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.search_impression_share,
  metrics.search_top_impression_share,
  metrics.search_absolute_top_impression_share,
  metrics.search_rank_lost_impression_share,
  metrics.search_budget_lost_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<window_start>' AND '<window_end>'
```

With `segments.date` only in the conditions, each campaign returns one row aggregated over the window, which is what the ratio metrics need. Add a `window` column (W1–W4) as you save each file.

## Step 2b: CSV fallback

Ask the user for an export from the Google Ads interface:

> *In Google Ads, open Campaigns, select the Search campaigns to include (or one campaign), then Insights and reports → Auction insights. Set the date range to the last 112 days, choose Segment → Time → Month (or Week), and download as .csv. For a per-campaign view, open each campaign and export from there, or export at account level with the campaign column if your view offers it.*

Use Python to load it:

1. The file starts with one or two title lines (report name, date range) before the header. Find the header row as the first line containing "Display URL domain" (the interface may localise column names; match on the domain column in the user's language and confirm with them).
2. Expected columns: `Display URL domain`, `Impression share`, `Overlap rate`, `Position above rate`, `Top of page rate`, `Abs. Top of page rate`, `Outranking share`, plus the time segment column (`Month` or `Week`) and `Campaign` when present. Map them to the API names used below.
3. Percentages arrive as strings (`"34.56%"`). Convert to fractions. `"< 10%"` means the value is below 10% and was censored: store `0.05`, set a `censored = True` flag, and never treat a censored value as a precise change. `"--"` means not applicable (the account's own row has no overlap or position-above rate): store `NaN`.
4. The row whose domain is `You` (localised) is the account itself: its impression share, top of page rate and absolute top rate are the account's own figures for that window. Keep it in a separate table.
5. Map months or weeks to windows. Monthly is fine: W1–W4 become the four months.

The CSV has no cost or CPC. Pull the account-side query from step 2a for the same windows (that part works without allowlisting) and join on campaign name and window.

## Step 3: Competitor tables

Use Python. One row per `(customer_id, campaign, window, domain)` with: `is` (competitor impression share), `overlap`, `pos_above`, `top_rate`, `abs_top_rate`, `outranking` (the account's outranking share against that domain).

1. **Gate.** Keep campaigns with at least 1,000 impressions in every window used. Keep domains with `overlap >= 0.10` in at least one window, or `is >= 0.10`. Count the rest as "minor competitors".
2. **Pressure.** `pressure = overlap * pos_above`: the share of the account's impressions in which that competitor appeared and ranked above it. It is the single most useful number for "who is hurting us".
3. **Latest vs baseline** per domain: `base = mean of W1–W3` (or W1 in a two-window read), computed on each metric separately; `delta = latest - base` in percentage points. Treat a censored value on either side as unknown for that metric.
4. **Classify** each domain:

| Class | Rule |
|---|---|
| **New entrant** | absent or below 0.05 overlap in every baseline window, `overlap >= 0.10` in the latest |
| **Rising pressure** | `delta is >= +0.05` or `delta pressure >= +0.05`, and present in at least 2 baseline windows |
| **Losing to them** | `delta outranking <= -0.10` (the account outranks them less often) |
| **Leaving** | `overlap >= 0.10` in the baseline mean, below 0.05 or absent in the latest |
| **Stable** | everything else |

A domain can be both Rising pressure and Losing to them; keep both labels.

5. **Trend consistency.** With four windows, a rise that is monotonic across W1→W4 is stronger evidence than a single jump in W4; record `monotonic = True/False` per metric.
6. **Aggregate to account.** For a domain that appears in several campaigns, sum the campaign rows with impressions as weights: `weighted_overlap = sum(overlap * own_impressions) / sum(own_impressions)` across that domain's campaigns, per window. Do the same for `pressure`.

## Step 4: Own trend and what it means

Use Python on the account-side rows, per campaign and window: `cpc = cost / clicks`, and the impression share fields as fractions. Compute latest vs baseline deltas the same way as step 3, plus `cpc_change = (cpc_latest - cpc_base) / cpc_base`.

Read the combination per campaign:

| Own trend | Competitor moves | Reading |
|---|---|---|
| Rank-lost IS up, CPC up | New entrant or Rising pressure with `delta pressure >= +0.05` | Auction pressure: a competitor is bidding harder or has better Ad Rank on the same terms. |
| Rank-lost IS up, CPC flat or down | No material competitor change | Own Ad Rank fell: check Quality Score (`kw-quality-score-low`), asset coverage, or a lowered target. Not competition. |
| Budget-lost IS up | any | Budget, not competition. Point at `impression-share-losses` and `google-ads-budget-allocation`. |
| IS flat, CPC up, top-of-page share up | Rising pressure | The account held its position by paying more. Decide whether the position is worth the price. |
| IS up, CPC down | Leaving | A competitor pulled back; there may be cheap headroom now (`google-ads-find-scale-candidates`). |

With four or more windows per campaign, also print the Spearman correlation between the summed `pressure` of the top three competitors and the account's CPC across windows (`scipy.stats.spearmanr`). With four points it is descriptive only; never call it significant.

Apply the minimum-data rule from `references/priority-tiers.md` to campaigns below 1,000 impressions per window: report them as directional.

## Interpretation rules

- **Severity:**
  - `high`: a New entrant or Rising pressure competitor with `pressure >= 0.20` in the latest window on a campaign carrying 20% or more of Search spend, together with the account's own rank-lost IS up 5 points or more or CPC up 15% or more. A third party appearing on brand campaigns with `overlap >= 0.20` is also high: brand protection is the account's call, and it needs to know.
  - `medium`: New entrant or Rising pressure without a matching own-trend change yet; Losing to them on a top-spend campaign.
  - `low`: Leaving, Stable shifts, minor competitors, censored-value movements.
- **Don't over-read.** Auction insights move with the account's own changes too: a new keyword set, a match type change or a raised budget brings new domains into view. Check `change_event` (via `recent-changes` in the health-check catalog) for the latest window before attributing a new entrant to the market.
- **Aggregators and marketplaces** (comparison sites, marketplaces, the account's own resellers) behave differently from direct competitors. Label them when the user or memory identifies them.
- **No CPC for competitors.** Never state what a competitor pays. "Their impression share rose from 22% to 41%" is evidence; "they doubled their budget" is a guess.
- **Recommendations stay on the account's side**: bids or targets on the affected campaign, Quality Score and asset work, brand campaign defence, budget, or doing nothing because the position isn't worth the price. Point bid-strategy questions at `google-ads-choose-bid-strategy`.

## Output

One finding: `category: bids`, `kind: audit`.

**Wrap-up example:** *"A new entrant, example-rival.com, appeared in Non-Brand Generic FR four weeks ago and now ranks above Acme in 27% of its impressions; over the same window Acme's rank-lost impression share rose from 18% to 29% and CPC rose 21%. Auction pressure explains most of the CPC rise there; the other five campaigns are stable."*

**General improvements**, for example:
- "Auction insights are not enabled for this API connection; this read uses the 4-month CSV export. Saving a snapshot each month gives the next run a baseline without a new export."
- "Two of the five main competitors are comparison sites. They take top-of-page positions without competing on price; outranking them is rarely worth the CPC."

**Recommendations:**

| account | campaign | competitor | change | own_impact | proposed_action | severity |
|---|---|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | example-rival.com | new entrant, pressure 0.27 | rank-lost IS +11 pts, CPC +21% | Decide whether top positions are worth +21% CPC; if yes raise the target CPA 10% and review QS on the top 10 keywords; if no hold and accept lower IS | high |
| Acme FR | Brand FR | reseller-example.fr | overlap 0.24, rising | abs top share -6 pts | Confirm whether the reseller may bid on the brand; if not, raise it with them | high |

**Details**

*Competitors per campaign, latest window vs baseline*

| account | campaign | competitor | is | overlap | pos_above | top_rate | abs_top_rate | outranking | pressure | delta_is | delta_pressure | class | monotonic | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

*Own trend per campaign*

| account | campaign | window | impressions | is | top_is | abs_top_is | rank_lost_is | budget_lost_is | cpc |
|---|---|---|---|---|---|---|---|---|---|

Mark censored (`< 10%`) values with an asterisk.

**Pending example**
- title: *New entrant example-rival.com ranks above Acme in 27% of Non-Brand Generic FR impressions*
- summary: *Absent three months ago, overlap 0.41 in the last 28 days. Acme's rank-lost IS rose 18% → 29% and CPC €1.62 → €1.96 on the campaign (31% of Search spend). Five other campaigns show no material competitor change.*

**OK example**
- title: *Competitor landscape stable across 6 Search campaigns over 16 weeks*
- summary: *Checked 9 competitors above 10% overlap in four 28-day windows. No new entrants; no impression share or pressure change above 5 points. Acme's own impression share moved within 3 points and CPC within 6%.*
- The body states the data source (API or CSV), the windows, the gates and the competitors checked.

## Workspace writes (when the user confirms)

- **Snapshot** → `ads/google/analyses/YYYY-MM-DD-auction-insights.md`: per campaign and competitor, the latest-window metrics and the class, with the window dates and source. The next run reads it as a baseline.
- The user names a domain as a reseller, affiliate or partner that may appear → a memory file under `ads/google/memory/` and a line in `MEMORY.md`, so it isn't flagged as a threat again.

## Evidence rule

Every claim names the campaign, the competitor domain, the window dates, the metric values in both windows, and the own-trend numbers it is paired with:

> *"Non-Brand Generic FR, example-rival.com: overlap 0.03 (Jul 1–28) → 0.41 (Sep 23–Oct 20), position above rate 0.66, pressure 0.27. Over the same windows Acme's rank-lost IS rose 18% → 29% and CPC €1.62 → €1.96. New entrant (rule: below 0.05 overlap in all baseline windows, above 0.10 now)."*
