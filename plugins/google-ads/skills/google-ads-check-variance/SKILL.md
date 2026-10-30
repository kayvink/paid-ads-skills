---
name: google-ads-check-variance
description: Detect meaningful week-over-week, month-over-month and year-over-year shifts in Google Ads spend, conversions, ROAS, CPA, CTR and impressions, starting from account, channel and country rollups and drilling into campaigns only where the rollups point, then map each shift to a likely cause. Use when the user asks why performance changed, what moved this week, about sudden drops or spikes in conversions or spend, or for an anomaly check.
---

# Check variance

> Spot performance fluctuations via aggregate rollups first, drill into flagged dimensions only when the aggregates point there. Diagnose likely causes and prioritise by impact. Token-efficient: three phases of analysis, from wide-angle to fine-grained.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Trend windows and the exclude-today rule are background in `references/stability-windowing.md`.

## Goal

Detect meaningful WoW / MoM / YoY shifts in spend, conversions, ROAS, CPA, CTR, impressions without exhaustively auditing every campaign. Use account, channel and country rollups as the primary signal, drill only when a rollup row looks off, and pull daily campaign-level data only to confirm specific hypotheses. Output guides what to investigate, not what to fix: most anomalies need human verification before action is safe.

## Scope

Google Ads. Variance is campaign-level at most; ad-group or ad-level drill-in is a follow-up investigation.

## Periods

Define the comparison windows once, in Python, from yesterday's date (today is excluded everywhere):

- **Week:** `segments.week` is the Monday a week starts on. The **current week** is the last complete Monday–Sunday week ending on or before yesterday; **WoW** compares it with the week before.
- **Month:** the **current month** is the last complete calendar month; **MoM** compares it with the month before.
- **YoY:** the current week against the same `segments.week` 52 weeks earlier, and the current month against the same month a year earlier.
- **Percent change** = `(current - baseline) / baseline`, NaN when the baseline is 0 (conventions section 2).

## Three phases of analysis

Run the phases in order and only continue to the next if the prior one surfaced signal worth drilling.

### Phase 1: Aggregate rollups (always)

Build three rollups from cheap GAQL queries plus one delivery-status check. Keep the printed output to roughly 20–40 summary rows.

**1a. Account rollup: 53 weeks weekly and 13 months monthly.** Run against `customer` for each account in scope.

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  segments.week,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM customer
WHERE segments.date BETWEEN '<Monday 53 weeks before the current week>' AND '<Sunday ending the current week>'
```

Run the same query with `segments.month` in place of `segments.week` and the range `'<first day of the month 13 months before the current month>'` to `'<last day of the current month>'`.

**1b. Channel rollup: last 2 complete weeks per campaign**, rolled up to channel type in Python.

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  segments.week,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE segments.date BETWEEN '<Monday of the previous week>' AND '<Sunday ending the current week>'
```

Search splits into **Search Branded** and **Search Non-Branded**: a Search campaign is branded when `ads/taxonomy.md` puts it in a brand group, else when its name contains "brand" or any brand term from `ads/google/index.md` (case-insensitive). Without brand terms, keep Search as one row and say so. Display, Video, Performance Max, Shopping and Demand Gen are their own rows.

**1c. Country rollup: last 2 complete weeks.**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  geographic_view.country_criterion_id,
  segments.week,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM geographic_view
WHERE segments.date BETWEEN '<Monday of the previous week>' AND '<Sunday ending the current week>'
```

Resolve country IDs to names with `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.id IN (<ids>)`.

**Primary conversions for each rollup.** When a primary conversion action is configured, run each of 1a–1c a second time selecting `segments.conversion_action_name`, `metrics.conversions` and `metrics.conversions_value` (instead of the other metrics) with `AND segments.conversion_action_name = '<primary_conversion_action>'`. Join on the rollup keys plus `customer_id`; a missing period means zero primary conversions. Conversions, ROAS and CPA in Phase 1 use these primary counts; `all_conversions` stays alongside for the funnel view.

**1d. Delivery-status check:** one light pass for approval and policy issues that don't show up in spend totals (silent delivery loss). Last 14 complete days, so the last 7 can be compared with the 7 before.

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  campaign.status,
  ad_group_ad.ad.id,
  ad_group_ad.policy_summary.approval_status,
  ad_group_ad.policy_summary.review_status,
  ad_group_ad.status,
  segments.date,
  metrics.impressions
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 13 days>' AND '<yesterday>'
```

Any campaign with near-zero impressions in the last 7 days AND ads in `DISAPPROVED` / `UNDER_REVIEW` status or limited delivery (`approval_status` `APPROVED_LIMITED` or `AREA_OF_INTEREST_ONLY`) is a Phase 1 flag regardless of aggregate totals. Use Python: sum impressions per `(customer_id, campaign.id)` for the last 7 days and the 7 before, and treat "near zero" as fewer than 10% of the prior 7 days' impressions (or zero when the prior week also had almost none); count the campaign's enabled ads by approval status.

**Phase 1 computation.** Use Python on the rollups:

1. For each rollup row (the account, each channel row, each country), sum cost, clicks, impressions, primary conversions and conversion value per period, then derive ROAS = value / cost, CPA = cost / conversions, CTR = clicks / impressions, CPC = cost / clicks from the sums.
2. Compute WoW for every row; MoM and YoY for the account rollup (the channel and country rollups carry WoW only).
3. Compute each row's **share of account spend** in the current week.
4. Apply the flag rules in "What counts as a flag at Phase 1" and print the flagged rows with their current value, baseline, change and spend share.

**Phase 1 exits early if nothing looks off.** Write an OK finding describing what was checked across the three rollups and the delivery status, and stop. No campaign-level pulls needed.

### Phase 2: Drill into flagged dimensions (only if Phase 1 surfaced signal)

For each dimension row that flagged in Phase 1 (e.g. "PMax channel -32% WoW conversions", "country DE -45% WoW spend", "branded CPA +80% WoW"), pull weekly aggregates for the campaigns inside that dimension: last 4 complete weeks, not 12; weekly, not daily.

Join A and B in Python on `(customer_id, campaign.id, segments.week)`.

**Query A: spend and funnel**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  segments.week,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND <dimension scope>
  AND segments.date BETWEEN '<Monday 3 weeks before the current week>' AND '<Sunday ending the current week>'
```

**Query B: primary-action conversions** (skip when no primary action is configured)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  segments.week,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND <dimension scope>
  AND segments.date BETWEEN '<Monday 3 weeks before the current week>' AND '<Sunday ending the current week>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

`<dimension scope>`: for a channel row, `campaign.advertising_channel_type = '<TYPE>'`; for branded or non-branded Search, `campaign.advertising_channel_type = 'SEARCH'` and split by the brand rule in Python; for a country, run the same two queries `FROM geographic_view` with `geographic_view.country_criterion_id = <id>` so the rows carry only that country's traffic.

Purpose of Phase 2: **attribution, not detection.** Answer "which campaigns inside this dimension caused the aggregate shift?" Use Python:

- For each campaign, `delta = metric(current week) - metric(previous week)` on the flagged metric (summed metrics directly; for ROAS or CPA, recompute from each campaign's sums).
- `contribution_pp = delta / dimension_total(previous week) × 100` for additive metrics, so the contributions add up to the dimension's WoW percent change.
- Rank campaigns by `|contribution_pp|` and print the top ones with their 4-week series. Usually 2–5 campaigns account for most of the move; the long tail is noise.

Having `all_conversions` alongside the primary count is valuable here: if the primary action dropped but `all_conversions` didn't, the funnel is intact and the hypothesis shifts toward attribution / tracking on that specific action. If both dropped, the funnel itself shrank. Compute both WoW changes per campaign and print them side by side.

Also look for **cross-campaign redistribution** inside the dimension: one campaign up, another down, dimension net flat (net change within the 15% Phase 1 threshold while campaigns carry opposite-signed contributions). Common when bid strategies shift budget between campaigns. Flag as informational, not critical.

### Phase 3: Daily-level diagnosis (only for specific hypotheses)

When Phase 2 points at a specific campaign whose variance shape needs day-level resolution to confirm a cause, pull daily data scoped to that campaign. Typical hypotheses requiring Phase 3:

- **Tracking loss suspicion:** conversions dropped suddenly on a specific day; pinpoint the day to correlate with site, tag or attribution changes
- **Creative fatigue:** CTR decay over time; daily granularity shows the fatigue curve
- **Auction pressure:** day-by-day CPC climb; sustained vs volatile

Same two-query pattern at daily granularity, last 30 complete days.

**Query A: daily spend and funnel**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE campaign.id IN (<suspected_campaign_ids>)
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query B: daily primary-action conversions** (skip when no primary action is configured)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  segments.date,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.id IN (<suspected_campaign_ids>)
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

Join on `(customer_id, campaign.id, segments.date)`. Missing days in query B are zeros (the primary action didn't fire that day), not nulls: reindex to every date in the range and fill with 0.

Use Python to resolve the shape:

- Daily CTR = clicks / impressions and CPC = cost / clicks, from that day's sums.
- **Sudden vs gradual:** for each day d, compare the mean of the 7 days before d with the mean of d and the days after it (up to 7). The day with the largest relative drop is the candidate step day; print it with both means. A sharp step on one day reads as sudden (tracking, approval, budget); a steady slope reads as gradual (fatigue, auction).
- **Sustained 5+ / 10+ day decline:** the metric sits below the median of the preceding 14 days on each of the last 5 (or 10) consecutive days.

Phase 3 is scoped to 1–5 campaigns, not the full fleet. Use it only when the hypothesis truly needs daily data.

## Inputs you need

1. **Business context:** `wiki/company.md` for seasonality and business-type expectations.
2. **Taxonomy:** `ads/taxonomy.md` for declared groups, tiers, and any seasonal flight notes.
3. **Rules:** `ads/google/rules/*.md` for per-group target ROAS / CPA (informs what "normal" looks like).
4. **Memory:** `ads/google/memory/MEMORY.md`. Scan for acknowledged explanations and read the individual files for full context. Suppresses re-flagging.
5. **Media plan:** `ads/media-plan.md` for declared flights that explain planned variance.
6. **Primary conversion action and brand terms:** `ads/google/index.md`.
7. **Phase 1 queries:** the three rollups plus the delivery-status check above.
8. **Phase 2 / 3 queries:** scoped GAQL only when the phases trigger.

## What counts as a flag at Phase 1

Apply simple thresholds on the rollup deltas, weighted by row volume:

- **Row impact:** a dimension row counts if it contributes ≥5% of account spend. Below that, its WoW swings are typically noise.
- **Material WoW shift** on a primary metric (spend, conversions, ROAS): `|WoW%| > 15%` on a row that passes the row-impact gate → Phase 1 flag.
- **Sustained shift:** MoM in the same direction as WoW reinforces the signal; YoY confirms it's not seasonal (a YoY change in the same direction says this year differs from last; a flat YoY next to a large WoW points at a pattern that repeats every year).
- **Silent delivery loss:** from the approval check, any ENABLED campaign with impressions near zero in the last 7 days AND approval issues → high severity regardless of aggregate totals.

The 15% threshold is a starting rule of thumb; higher-variance channels (Display, Video, PMax) tolerate more before flagging. Adjust per channel type if needed (Phase 1 only; Phase 2 works on the narrower slice).

## Diagnosis heuristics

Map the observed shape to the most likely cause. These are hypotheses to investigate, not conclusions.

| Observed shape | Most likely cause | What to check first |
|---|---|---|
| Conversions drop, clicks + spend flat | Tracking / attribution | Conversion tag, site changes, analytics integration |
| Spend near zero with campaign ENABLED | Budget / pause / disapproval | Campaign budget caps, ad approval status |
| Spend spike, conversions flat | Targeting / settings | Geo changes, audience expansion, match-type drift |
| CPC / CPM up, CTR flat | Auction pressure | Competitor activity, IS lost to rank, bid strategy changes |
| CTR drops, CPC flat | Creative fatigue | Creative age, last refresh date |
| Impressions near zero, budget unchanged, ENABLED | Delivery / approval | Approval status, policy issues |
| 5+ day gradual decline | Structural shift | Auction, creative, competitor, seasonal: deeper investigation |
| One campaign up + another down, dimension flat | Redistribution | Bid strategy, budget reallocation, campaign priority shift |
| All metrics up together, ROAS steady | Scaling event | Confirm intentional; likely healthy growth |

Encode the "observed shape" in Python from the WoW changes per metric (for example "conversions < -15% while clicks and cost within ±15%") so each flag gets a candidate cause, then sanity-check it.

## External context to consider

Before flagging anything, consider whether it's explained by:
- **Seasonality** declared in `ads/media-plan.md` or known from business context
- **Acknowledged events** in `ads/google/memory/` (product launch, creative refresh, site migration, new market)
- **Platform events:** policy updates, outages if known

Items explained by declared context are demoted from flag to informational, or suppressed entirely if memory has a scoped acknowledgment.

## Interpretation rules

- **Severity** at the dimension / campaign level:
  - `high`: primary metric (conversions, spend) on a high-impact dimension or campaign, OR silent delivery loss on any ENABLED campaign, OR sustained 5+ day decline
  - `medium`: meaningful WoW on a secondary metric, OR cross-campaign redistribution with a net-zero dimension, OR a moderate sustained trend
  - `low`: within-range movement; explained by declared context; low-impact dimension
- **Do not re-flag** items with matching scoped acknowledgments in memory.
- **Account changes** (new taxonomy, restructure, new markets): for the first ~4 weeks after the change, demote severity or skip; variance is expected.
- **Phase 1 false-positive rate:** aggregates are coarse. If a Phase 1 flag doesn't resolve to a concrete attribution in Phase 2 (small campaigns each moving a little, nothing dominant), downgrade severity and flag as informational.

## Output

One finding: `kind: anomaly`; `category: tracking` when conversion / attribution anomalies dominate, `budget` when spend / delivery dominate.

**Wrap-up:** one line with the account-level signal + dimension + top attributed cause.
Example: *"Account conversions -12% WoW (€4.2k value loss); driven by Brand NL conversions -65% (tracking suspected) and PMax DE impressions -88% (probable disapproval)."*

**Per-account summary:** only if multi-account.

**General improvements:** account-level observations above individual campaign flags:
- "Branded and non-branded Search moved in opposite directions this week (brand -18%, non-brand +22%); check whether a bid-strategy or budget reallocation caused it."
- "The delivery-status check found 3 ENABLED campaigns with impressions near zero; audit ad approvals."

**Recommendations:** structural / investigation next steps beyond individual campaigns.

**Details table:** flagged attribution events, sorted by severity, then spend exposure. Cap at ~15 rows; summarise the tail.

| account | dimension | campaign | metric | window | change_pct | weekly_spend | severity | likely_cause | what_to_check_first | recommendation |
|---|---|---|---|---|---|---|---|---|---|---|

`dimension`: `account` / `channel:PMax` / `channel:Search-Branded` / `geo:DE` / `campaign:<name>`, depending on where the signal resolved.

`window`: `WoW-sudden`, `MoM-sudden`, `YoY-shift`, `sustained-5d`, `sustained-10d`, `cross-redistribution`, `silent-delivery-loss`.

`likely_cause`: `tracking`, `budget`, `approval`, `targeting`, `auction`, `creative-fatigue`, `delivery`, `structural`, `scaling`, `seasonal`, `redistribution`, `unexplained`.

`recommendation`: `urgent-investigate`, `investigate`, `monitor`, `optimise`, `acknowledge`.

**Pending example:**
- title: *Conversions -12% WoW; Brand NL tracking suspected; PMax DE impressions -88%*
- summary: *Phase 1 account rollup flagged conversions -12% WoW. Attribution: Brand NL conversions -65% with clicks flat (tracking hypothesis). PMax DE impressions -88% with budget unchanged (probable disapproval). Non-brand Search +22% compensated partially. €4.1k/week exposure.*

**OK example (aggregates clean):**
- title: *No material variance across account, channel or country rollups; delivery healthy*
- summary: *Phase 1 checked account WoW/MoM/YoY (all within ±8%), channel breakdown (Search, Display, PMax, Shopping all within ±12%), country rollup (all active countries within ±10%), delivery status (no disapprovals or limited-delivery flags). No drill-down needed.*
- The body describes each Phase 1 check and why it passed.

## Workspace writes (when the user confirms)

- The user acknowledges a flag's explanation ("that was our site migration, don't re-flag") → write a new file under `ads/google/memory/` with a scoped note (dimension, metric, window, cause), then add a one-line entry to `MEMORY.md`.
- If a diagnosis indicates an ongoing structural issue, recommend the relevant follow-up skill (e.g. `google-ads-check-pacing` for budget-capped issues). Don't try to solve structural problems inside this skill.

On an unattended run, make no memory writes; put the proposal in the finding.

## Evidence rule

Every phase's flag cites the specific delta + baseline + impact:
- Phase 1: *"Channel PMax: WoW conversions -32% (from 124 to 84), weekly spend €8,400 (16% of account): material and unexplained by declared flights."*
- Phase 2: *"Inside PMax, campaign PMax DE contributed -28pp of the -32% channel move. Impressions -88% WoW, budget unchanged, status ENABLED → delivery / approval hypothesis."*
- Phase 3: *"Daily impressions dropped from ~12k/day to under 500 starting 2026-04-17: a sudden step, not gradual. Approval issue confirmed: `ad_group_ad.policy_summary` returns DISAPPROVED for the 3 active ads."*

No "looks off" without the numbers + the specific slice + the hypothesis name from the heuristics table.
