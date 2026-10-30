---
name: google-ads-fluctuation-detection
description: Fast Google Ads alert for sudden day-over-day and week-over-week shifts. Flags campaigns whose spend yesterday swung more than 50% from their recent median, accounts whose conversion rate dropped more than 40% versus the prior week, and accounts or channels whose CPA, conversion rate or conversion volume moved past fixed thresholds week over week. Use when the user asks what changed yesterday, for a daily anomaly check, about a sudden spend spike or drop, or a conversion drop. For the three-phase WoW, MoM and YoY investigation of a shift use google-ads-check-variance.
---

# Fluctuation Detection

> Detect significant day-over-day and week-over-week shifts in spend, conversions, CPA and conversion rate.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Learning-phase noise after a bid change is explained in `references/learning-phase-thresholds.md`.

## Goal

A cheap, deterministic alarm that runs every day and answers one question: did something move sharply enough yesterday or this week that a person should look today? It flags; it does not explain at depth. Each flag carries the numbers, the threshold, and a first thing to check.

## How this differs from google-ads-check-variance

This skill is the fast alert: fixed thresholds on day-over-day and week-over-week deltas, three small queries, no drill-down beyond a change-history lookup. `google-ads-check-variance` is the investigation: aggregate rollups across WoW, MoM and YoY, then a drill into the dimensions and campaigns that caused a shift, then daily diagnosis of specific hypotheses. When this skill raises a high-severity flag, or several medium ones in the same channel, the next step is `google-ads-check-variance`. For a slow slide over four weeks rather than a sudden move, use `google-ads-diagnose-trend-drift`.

## Inputs you need

1. **Business context:** `wiki/company.md`, for day-of-week patterns and seasonality (a B2B account always drops at the weekend).
2. **Media plan:** `ads/media-plan.md`, for declared flights, launches and sale periods that explain a planned swing.
3. **Rules:** `ads/google/rules/*.md`, for the KPI per group (CPA or ROAS), which tells you which drift matters most.
4. **Memory:** `ads/google/memory/MEMORY.md`. Acknowledged events (site migration, tracking change, launch) demote or suppress flags.
5. **Recent findings:** `ads/google/findings/` from the last 14 days.
6. **Primary conversion action:** `ads/google/index.md`.
7. **Live data:** the queries below, for each account in scope. `yesterday` is yesterday in the account's time zone (select `customer.time_zone` once if unsure).

## Pass 1: Day-over-day spend per campaign

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  segments.date,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 13 days>' AND '<yesterday>'
```

Use Python:

- Pivot to one row per `(customer_id, campaign.id)` and one column per date, reindexed to the full 14-day calendar with missing days filled as 0 (GAQL omits days with no activity, and a missing day is a zero-spend day).
- `y` = spend on `yesterday`.
- `prior_median` = the median of the 13 days before yesterday.
- Skip campaigns with `prior_median < 5` (in the account currency): too small and noisy to flag.
- `delta_pct = abs(y - prior_median) / prior_median * 100`. Flag when `delta_pct > 50`.
- Keep the sign for the output (spike or drop) and sort by `delta_pct` descending.

Swings this large usually mean a budget or bid change, a targeting tweak, or a technical issue, not an organic demand shift.

## Pass 2: Day-over-day conversion rate per account

When a primary conversion action is configured, run both queries and join on `(customer_id, segments.date)`; otherwise use `metrics.conversions` from query A.

**Query A: clicks and conversions per day**

```sql
SELECT
  customer.descriptive_name,
  segments.date,
  metrics.clicks,
  metrics.conversions
FROM customer
WHERE segments.date BETWEEN '<yesterday minus 13 days>' AND '<yesterday>'
```

**Query B: primary-action conversions per day**

```sql
SELECT
  customer.descriptive_name,
  segments.date,
  segments.conversion_action_name,
  metrics.conversions
FROM customer
WHERE segments.date BETWEEN '<yesterday minus 13 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

Use Python, per account:

- `yesterday` = the latest date in that account's rows. Skip the account when yesterday has fewer than 50 clicks (too noisy).
- `prior` = the 7 dates before yesterday. Sum clicks and conversions over them; skip the account when the prior clicks total is below 50.
- `y_cvr = y_conversions / y_clicks`, `prior_cvr = prior_conversions / prior_clicks`.
- `drop_pct = (prior_cvr - y_cvr) / prior_cvr * 100` (0 when `prior_cvr` is 0). Flag when `drop_pct > 40`.
- Sort by `drop_pct` descending.

A conversion-rate drop of that size in one day usually means something broke (tracking, a landing page, a pricing or copy change) rather than audience fatigue. Conversions also arrive late: yesterday's count is often still filling in, especially for offline or long-lag conversion actions. If the account has a known conversion lag, say the flag may soften on a re-run tomorrow, but don't suppress it.

## Pass 3: Week over week, account and channel

Compare the last 7 complete days (`recent`: yesterday minus 6 days to yesterday) with the 7 days before (`prior`).

**Account level**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM customer
WHERE segments.date BETWEEN '<yesterday minus 13 days>' AND '<yesterday>'
```

**Channel level** (so a healthy channel can't mask a failing one inside the account total)

```sql
SELECT
  customer.descriptive_name,
  campaign.advertising_channel_type,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 13 days>' AND '<yesterday>'
```

With a primary conversion action configured, add the matching query B (segmented by `segments.conversion_action_name`, filtered to the action) for each, and use its conversions.

Use Python. Label each row `recent` or `prior` by date, then group by `(customer_id, window)` for the account pass and `(customer_id, advertising_channel_type, window)` for the channel pass, summing cost, clicks and conversions. From the sums:

- `cpa = cost / conversions`, `cvr = conversions / clicks`.
- `cpa_drift_pct = (recent_cpa - prior_cpa) / prior_cpa * 100` (0 when prior CPA is 0).
- `cvr_delta_pct = (recent_cvr - prior_cvr) / prior_cvr * 100` (0 when prior CVR is 0).
- `conv_delta_pct = (recent_conv - prior_conv) / prior_conv * 100` (0 when prior conversions are 0).

Apply the thresholds:

| Metric | Floor (prior window) | Flag | Severe |
|---|---|---|---|
| CPA drift up (account and channel) | prior conversions >= 30 and prior CPA > 0 | `cpa_drift_pct > 30` | `> 50` |
| CVR drop (account only) | prior clicks >= 500 and prior CVR > 0 | `cvr_delta_pct < -25` | `< -40` |
| Conversion volume drop (account and channel) | prior conversions >= 30 | `conv_delta_pct < -25` | `< -40` |

CVR is checked at account level only: per channel it is too noisy at low click counts. Accounts and channels below the floors are listed as "not enough volume for a weekly comparison", not as clean. On small accounts the 30-conversion floor in 7 days excludes most rows; that is intended.

How to read each:
- **CPA up, severe:** efficiency has broken, not eroded; treat it as a live incident. Otherwise each day looks normal but the week has eroded efficiency materially.
- **CVR down, severe:** a drop this size usually means tracking is broken, not a soft demand shift. Otherwise the traffic mix shifted to lower intent, landing page experience degraded, or tracking is partially broken. Check tracking first: a partial tracking break looks identical to a CVR drift.
- **Volume down, severe:** rarely demand alone; suspect a broken channel, a paused campaign, or a tracking outage. Otherwise demand dropped, competition tightened, impression share is leaking, or one channel is failing while another holds up the total.
- **Channel rows:** a large drop in one channel can net out small at account level when another channel is rising; the channel itself is still the problem. For PMax check recent asset group changes and asset disapprovals; for Search, the search term report; for Shopping, Merchant Center product status.

For a gradual slide rather than a weekly move, the same pass with 28-day windows (recent 28 vs prior 28, same thresholds and floors) is what `google-ads-diagnose-trend-drift` investigates.

## Step 4: What changed

For every flagged campaign, and for the campaigns in a flagged account or channel, look up the change history once (last 14 days; `change_event` rejects start dates 30 or more days old and only accepts these resource types in the filter):

```sql
SELECT
  customer.descriptive_name,
  change_event.change_date_time,
  change_event.change_resource_type,
  change_event.resource_change_operation,
  change_event.client_type,
  change_event.changed_fields,
  campaign.name
FROM change_event
WHERE change_event.change_date_time >= '<yesterday minus 13 days>'
  AND change_event.change_date_time <= '<today>'
  AND change_event.change_resource_type IN ('CAMPAIGN', 'CAMPAIGN_BUDGET', 'CAMPAIGN_CRITERION', 'AD_GROUP', 'AD_GROUP_CRITERION', 'AD_GROUP_BID_MODIFIER')
ORDER BY change_event.change_date_time DESC
LIMIT 1000
```

Use Python to match rows to flagged campaigns by `campaign.name` and keep the changes dated on or up to 2 days before the flagged day (pass 1 and 2) or inside the recent window (pass 3). Name the matching change in the flag: a budget edit (`CAMPAIGN_BUDGET`), a bid strategy or target change (`CAMPAIGN` with `changed_fields` naming `bidding_strategy_type`, `target_cpa_micros` or `target_roas`), targeting (`CAMPAIGN_CRITERION`, `AD_GROUP_CRITERION`). Mark `client_type = 'GOOGLE_ADS_AUTO_APPLY'` and `'GOOGLE_ADS_AUTOMATED_RULE'` changes explicitly: they are often invisible to the user. A campaign that changed bid strategy in the last 7 days is in learning, where large daily swings are expected (`references/learning-phase-thresholds.md`).

If nothing matches, say so: no account edit in the window points to the serving side, tracking, or the market.

## Interpretation rules

- **Severity:**
  - `high`: an account CVR drop above 40% day over day; any week-over-week row past its severe threshold.
  - `medium`: a campaign spend swing above 50% of its median; any week-over-week row past its flag threshold but not its severe one.
  - `low`: a flag explained by a declared flight, a memory entry, or a change the user made on purpose (kept in the details for the record).
- Sort by severity, then by spend (yesterday's spend for pass 1, recent-window spend for the others).
- Respect memory and the media plan: explained items are demoted to low or suppressed when memory has a scoped acknowledgement.
- A spend drop that lands on a campaign with zero impressions is a delivery problem: point to `google-ads-campaigns-not-spending`. A spend spike above 1.5x the daily budget is a pacing problem: point to `google-ads-daily-pacing`.
- Don't stack explanations. Name the matching change or the first thing to check; the full diagnosis belongs to `google-ads-check-variance`.

## Output

One finding: `kind: anomaly`; `category: tracking` when conversion and CVR flags dominate, `budget` when spend flags dominate.

**Wrap-up example:** *"Acme FR conversion rate fell 58% yesterday (4.1% to 1.7% on 1,240 clicks) with no account change in the window, tracking suspected; 3 campaigns had spend swings above 50%, two of them after budget edits."*

**General improvements**, for example:
- "Two of the three spend swings follow Google auto-applied budget recommendations; consider turning auto-apply off for budgets."
- "PMax conversions -46% week over week while Search is +18%; the account total (-6%) hides it."

**Recommendations:**

| account | entity | check_first | reason |
|---|---|---|---|
| Acme FR | account | Test-fire the conversion tag; scan landing page deploys in the last 24h | CVR -58% DoD, no account change |
| Acme FR | Non-Brand Generic FR | Review the budget edit on 2026-04-21 | Spend +140% vs 13-day median |

**Details:**

*Day-over-day spend*

| account | campaign | channel | yesterday_spend | prior_median | delta_pct | direction | matching_change | severity |
|---|---|---|---|---|---|---|---|---|

*Day-over-day conversion rate*

| account | yesterday | clicks | yesterday_cvr | prior_7d_cvr | drop_pct | matching_change | severity |
|---|---|---|---|---|---|---|---|

*Week over week*

| account | level | channel | metric | prior | recent | delta_pct | prior_volume | severity |
|---|---|---|---|---|---|---|---|---|

`level` is `account` or `channel`; `metric` is `cpa`, `cvr` or `conversions`.

**Pending example**
- title: *Conversion rate -58% yesterday in Acme FR; 3 campaigns with spend swings above 50%*
- summary: *CVR 1.7% on 1,240 clicks vs 4.1% over the prior 7 days, no account change in the window. Non-Brand Generic FR +140% vs its median after a budget edit; Brand FR -72% with no change found.*

**OK example**
- title: *No day-over-day or week-over-week shifts past thresholds*
- summary: *Checked 42 enabled campaigns (31 above the 5/day median floor), 2 accounts' CVR (both above 50 clicks yesterday), and week-over-week CPA, CVR and volume at account and channel level: no campaign swung more than 50%, no CVR drop above 40%, no weekly drift past 25–30%.*
- The body lists what each pass covered, which accounts or channels were below the volume floors, and the largest move seen in each pass.

## Workspace writes (when the user confirms)

- The user explains a flag ("we moved the checkout on Tuesday, conversions are catching up") → write a memory file under `ads/google/memory/` scoped to the account, metric and dates, and add a line to `MEMORY.md`, so the next runs demote it.

## Evidence rule

Every flag states the value, the baseline, the delta, the threshold and the matching change (or its absence):

> *"Non-Brand Generic FR (Acme FR): €312 spent yesterday vs a 13-day median of €130, +140% (threshold 50%). Budget raised from €130 to €320 on 2026-04-21 by a Google auto-applied recommendation."*

> *"Acme FR, PMax channel: 41 conversions in the last 7 days vs 76 in the prior 7, -46% (severe threshold -40%, prior volume 76 above the 30 floor)."*
