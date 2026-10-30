---
name: google-ads-campaigns-not-spending
description: Find enabled Google Ads campaigns that served zero impressions in the last 7 days, Video campaigns that are barely spending, and Search or Shopping campaigns held back by rank, then attach the probable cause (no live ad groups, no enabled ads, disapprovals, recently stopped, never launched) and the fix. Use when the user asks why a campaign isn't spending, why impressions dropped to zero, about campaigns not delivering, or budget sitting unused. For individual ad disapprovals use google-ads-ad-disapprovals; for spend running ahead or behind budget use google-ads-daily-pacing.
---

# Campaigns Not Spending

> Identify enabled campaigns that aren't spending and diagnose why (budget, bids, targeting, approvals).

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Bidding diagnosis leans on `references/smart-bidding-mechanics.md` and `references/learning-phase-thresholds.md`.

## Goal

Every active campaign should serve impressions every week: zero usually means a budget, bid, targeting or disapproval blocker. Find the enabled campaigns that served nothing in the last 7 days and attach the probable cause when the data can confirm one, so the obvious cases get fixed directly and only the rest need investigation. Then catch the quieter versions of the same problem: Video campaigns with a budget that barely deliver, and Search or Shopping campaigns whose delivery is held back by Ad Rank.

## Scope

Three passes, in order of severity:

1. **Zero-impression campaigns** (all channel types): ENABLED campaigns with 0 impressions over the last 7 days, with a probable cause and a confidence.
2. **Video campaigns not spending:** ENABLED Video campaigns with a budget above 0 that spent nothing or got fewer than 100 impressions in the last 7 days. Video has more silent-failure modes than Search (asset disapproval, targeting too narrow, content suitability filtering everything).
3. **Delivery held back on Search and Shopping:** impression share lost to rank and budget, so the user knows whether low delivery is a bid and Quality Score problem or a budget cap.

This skill recommends only. The user makes the changes.

## Inputs you need

1. **Business context:** `wiki/company.md`, for seasonal or intentionally dormant campaigns (a campaign kept enabled for a yearly event).
2. **Media plan:** `ads/media-plan.md`, for declared flights. A campaign whose flight hasn't started yet is not broken.
3. **Memory:** `ads/google/memory/MEMORY.md`. Skip campaigns the user has acknowledged as intentionally idle.
4. **Recent findings:** `ads/google/findings/` from the last 14 days, and `ads/google/health/campaigns-not-spending.md` if `google-ads-health-check` has written it.
5. **Live data:** the queries below, for each account in scope. Let `today` be today's date in the account's time zone.

## Step 1: Pull campaign state and 90 days of delivery

**Query 1: campaign metadata** (one row per active campaign; the source of truth for the output)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  campaign.bidding_strategy_type,
  campaign_budget.amount_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
```

**Query 2: daily delivery, last 90 days.** The window is deliberately wide: it separates "never launched" from "stopped recently", and those need different fixes.

```sql
SELECT
  campaign.id,
  segments.date,
  metrics.impressions,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<today minus 90 days>' AND '<today>'
```

**Query 3: ad status per campaign** (drives the "no enabled ads" and "disapproved" causes)

```sql
SELECT
  campaign.id,
  ad_group_ad.status,
  ad_group_ad.policy_summary.approval_status
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
```

**Query 4: ad group status per campaign** (drives the "no enabled ad groups" cause)

```sql
SELECT
  campaign.id,
  ad_group.status
FROM ad_group
WHERE campaign.status = 'ENABLED'
```

Performance Max campaigns have no `ad_group_ad` or `ad_group` rows, so causes from queries 3 and 4 never fire for them; they fall through to the timeline causes. For a PMax campaign that shows up here, check its assets with the `google-ads-ad-disapprovals` skill.

## Step 2: Delivery features per campaign

Use Python, keyed on `(customer_id, campaign.id)` (campaign IDs repeat across accounts):

- From query 2, convert `cost = cost_micros / 1e6` and compute each row's age as `age_days = (today - segments.date).days`.
- Per campaign:
  - `last_impression_date` = latest date with `impressions > 0`, else none.
  - `last_spend_date` = latest date with `cost > 0`, else none.
  - `last7d_impressions` = sum of impressions where `0 <= age_days < 7` (today and the six days before it).
  - `prior28d_spend` = sum of cost where `7 <= age_days < 35`: the window *before* the zero-impression week, to detect "was spending, recently stopped".
  - `days_since_last_impression` = `(today - last_impression_date).days`, or "90+" when there is none.
- From query 3 per campaign: `total_ads` (rows), `enabled_ads` (rows with `ad_group_ad.status == 'ENABLED'`), `disapproved_ads` (rows whose upper-cased `approval_status` is in `{'DISAPPROVED', 'SITE_SUSPENDED'}`).
- From query 4 per campaign: `total_ad_groups` and `enabled_ad_groups` (status `ENABLED`).
- `daily_budget = campaign_budget.amount_micros / 1e6` from query 1.

Flag every campaign in query 1 whose `last7d_impressions == 0`. A campaign with no rows in query 2 at all also counts as zero.

## Step 3: Probable cause

Use Python to assign exactly one cause per flagged campaign, testing in this order (structural blockers first because they are deterministic, then policy, then timeline-based hypotheses):

| # | Condition | Cause | Confidence | Explanation template |
|---|---|---|---|---|
| 1 | `total_ad_groups > 0` and `enabled_ad_groups == 0` | No enabled ad groups | high | All N ad groups are paused or removed; the campaign has no live targeting surface. |
| 2 | `total_ads > 0` and `enabled_ads == 0` | No enabled ads | high | The campaign has N ads but none are ENABLED; nothing to serve. |
| 3 | `total_ads > 0` and `disapproved_ads == total_ads` | All ads disapproved | high | All N ads are disapproved or site-suspended; Google is refusing to serve them. |
| 4 | `total_ads >= 2` and `disapproved_ads > total_ads / 2` | Majority of ads disapproved | medium | X of N ads are disapproved; eligible inventory may be too thin to clear auctions. |
| 5 | `prior28d_spend > 0` | Recently stopped (was spending) | medium | Spent until `last_spend_date`, then stopped: likely a bid or target change, an audience shrink, or an external auction shift. |
| 6 | `last_impression_date` is none | Never launched | medium | No impressions in 90 days; the campaign appears never to have delivered. Check bid floor against auction price, geo and audience size, and conversion goal eligibility. |
| 7 | none of the above | Needs investigation | low | Active campaign with zero impressions in the last 7 days and no deterministic blocker found. |

Confidence means: `high`, the cause is conclusive from the data; `medium`, the data narrows it but doesn't confirm it; `low`, the probes were inconclusive. Sort the flagged list by confidence (high first), then by `daily_budget` descending, so actionable and costly rows rise to the top. Sum `daily_budget` per currency across the flagged campaigns: that is the daily budget at risk.

## Step 4: Investigate the medium and low rows

High-confidence rows have their fix in the cause. For the rest, run two cheap probes.

**Change history** (last 14 days; `change_event` rejects start dates 30 or more days old and only accepts these resource types in the filter):

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
WHERE change_event.change_date_time >= '<today minus 14 days>'
  AND change_event.change_date_time <= '<today>'
  AND change_event.change_resource_type IN ('CAMPAIGN', 'CAMPAIGN_BUDGET', 'CAMPAIGN_CRITERION', 'AD_GROUP', 'AD_GROUP_CRITERION', 'AD_GROUP_BID_MODIFIER')
ORDER BY change_event.change_date_time DESC
LIMIT 1000
```

Use Python to keep the rows whose `campaign.name` matches a flagged campaign, and list, per campaign, the changes dated within 3 days before `last_spend_date` and after it. A bid-strategy switch or target change shows up as a `CAMPAIGN` row whose `changed_fields` names `bidding_strategy_type`, `target_cpa_micros` or `target_roas`; geo or audience narrowing shows up as `CAMPAIGN_CRITERION`. Treat `client_type = 'GOOGLE_ADS_AUTO_APPLY'` (Google applied a recommendation) and `'GOOGLE_ADS_AUTOMATED_RULE'` (a user rule fired) as suspects. The absence of any change near the stop date is evidence too: it points away from an account edit and towards the auction or the conversion goal.

**Serving status and bidding targets:**

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  campaign.primary_status,
  campaign.primary_status_reasons,
  campaign.bidding_strategy_type,
  campaign.target_cpa.target_cpa_micros,
  campaign.target_roas.target_roas,
  campaign.maximize_conversions.target_cpa_micros,
  campaign.maximize_conversion_value.target_roas,
  campaign.start_date,
  campaign.end_date
FROM campaign
WHERE campaign.id IN (<flagged_campaign_ids>)
```

`primary_status_reasons` names Google's own reason when there is one (for example a budget, bidding, policy or "not started yet" reason). Use it to firm up a medium or low row. A `start_date` in the future is an intentional idle campaign, not a fault. A target CPA far below the campaign's historical CPA, or a target ROAS far above it, prices the campaign out of auctions; see `references/smart-bidding-mechanics.md` for why tightening a struggling campaign shrinks auction participation. A campaign that recently switched strategy may still be in learning (`references/learning-phase-thresholds.md`).

If the probes still don't explain a row, keep it at "Needs investigation" and list what to check by hand: bid floor against auction price, geo and audience size, conversion goal eligibility, ad schedule.

## Step 5: Video campaigns not spending

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  campaign_budget.amount_micros,
  metrics.cost_micros,
  metrics.impressions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<yesterday minus 6 days>' AND '<yesterday>'
```

Use Python to sum `cost` and `impressions` per `(customer_id, campaign.id)` over the 7 days, and flag a campaign when `budget > 0` AND (`spend == 0` OR `impressions < 100`). Skip campaigns whose budget is also zero (paused intent). Sort by budget descending. Video campaigns already flagged in step 2 stay there; list the rest here.

For each flagged Video campaign the checks are: the Status column for "Limited" reasons; that all video assets are approved (one disapproved asset can pause an entire ad group); that the targeting isn't so narrow no audience matches; that content suitability isn't set to a level that filters out all available inventory.

## Step 6: Delivery held back on Search and Shopping

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share,
  metrics.search_top_impression_share,
  metrics.search_absolute_top_impression_share,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

Use Python, per `(customer_id, campaign.id)`:

- `spend` = sum of `cost` over the 30 days. Drop campaigns with `spend < 100` (account currency): the impression share averages are too noisy to trust.
- `days` = number of rows. The impression share metrics arrive as daily fractions (0 to 1); take the simple mean across days of each one and multiply by 100. Treat missing values as 0, as the source data does.
- Flag three lists:
  - **Losing on rank:** mean rank-lost IS > 20%. Sort descending.
  - **Throttled by budget:** mean budget-lost IS > 10%. Sort descending.
  - **Showing, but rarely on top:** mean absolute-top IS < 30%. Sort ascending.
- Print each list capped at 20, with the total spend affected.

Read them as a delivery diagnosis:

- **Rank loss** is the under-delivery this skill cares about: the campaign has budget to spend but its Ad Rank isn't high enough to win the auctions. The levers are bids, Quality Score (expected CTR, ad relevance, landing page experience) and asset coverage, not budget. Check Quality Score on the top-spend keywords and verify sitelinks, callouts, structured snippets and responsive search ad strength. If Quality Score is the bottleneck, fix that first: raising bids on low-QS keywords is the most expensive way to win the auction.
- **Budget loss** means the campaign is spending all it is allowed to: it isn't a "not spending" problem but a cap. The usual move is a budget increase of about 20%, then a week of pacing; if that isn't an option, narrow the targeting (geo, ad schedule, audience) to spend the same money on higher-intent traffic. Hand the sizing to `google-ads-budget-allocation`, which applies the impression share headroom caps.
- **Low absolute top** is an opportunity, not a fault: decide which campaigns benefit from premium placement (usually brand, competitor and high-intent commercial terms) and raise bids for those, or move them to Target Impression Share with a top-of-page goal.

## Interpretation rules

- **Severity:**
  - `high`: an enabled campaign with zero impressions in the last 7 days; an enabled Video campaign with budget and no spend or under 100 impressions.
  - `medium`: rank-lost IS > 20% or budget-lost IS > 10% on a campaign with at least 100 spend in 30 days.
  - `low`: absolute-top IS < 30%.
- Within a severity, sort by confidence then budget (zero-impression rows) or by spend (the rest).
- A campaign whose flight in `ads/media-plan.md` hasn't started, or whose `start_date` is in the future, is listed as "scheduled", not flagged.
- Respect memory: acknowledged idle campaigns go in the per-account summary only.
- Report the daily budget at risk per currency; never add up budgets in different currencies.

## Output

One finding: `category: budget`, `kind: anomaly`.

**Wrap-up example:** *"5 enabled campaigns served no impressions in the last 7 days, €340/day of budget idle; 3 have a definite blocker (no enabled ads in 2, all ads disapproved in 1), 2 stopped after a target CPA change."*

**General improvements**, for example:
- "Two campaigns stopped the day after Google auto-applied a target CPA recommendation; consider turning off auto-apply for bidding recommendations."
- "4 Search campaigns lose more than 20% of impressions to rank with budget to spare; delivery is limited by Quality Score, not money."

**Recommendations:**

| account | campaign | probable_cause | confidence | daily_budget | fix |
|---|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | No enabled ads | high | €120 | Enable or create at least one ad per ad group |
| Acme FR | Brand FR | Recently stopped (was spending) | medium | €80 | Target CPA cut from €40 to €18 on the stop date; restore it |

**Details:**

*Zero-impression campaigns*

| account | campaign | channel | bidding | daily_budget | last_impression | days_zero | enabled_ad_groups | enabled_ads | ads_disapproved | prior_28d_spend | probable_cause | confidence | explanation | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

*Video campaigns not spending*

| account | campaign | budget | impressions_7d | spend_7d | severity |
|---|---|---|---|---|---|

*Search and Shopping delivery*

| account | campaign | spend_30d | rank_lost_is | budget_lost_is | abs_top_is | diagnosis | severity |
|---|---|---|---|---|---|---|---|

**Pending example**
- title: *5 enabled campaigns served no impressions in 7 days; €340/day idle*
- summary: *3 with a definite blocker (no enabled ads, all ads disapproved), 2 stopped after a target CPA change on 2026-04-14. 1 Video campaign got 40 impressions on a €50/day budget.*

**OK example**
- title: *Every enabled campaign served impressions in the last 7 days*
- summary: *Checked 38 enabled campaigns across 2 accounts: all had impressions in the last 7 days, all 3 Video campaigns cleared 100 impressions, and no Search or Shopping campaign above the 100 spend floor lost more than 20% of impressions to rank.*
- The body lists what was checked (campaign counts per account and channel, the windows, the floors) and why each pass came back clean.

## Workspace writes (when the user confirms)

- The user says a campaign is idle on purpose ("kept enabled for the December event") → write a memory file under `ads/google/memory/` naming the campaign and the reason (with a review date if there is one), and add a line to `MEMORY.md`.
- A flight start date belongs in the media plan: propose the edit to `ads/media-plan.md` inside the finding rather than writing it.

## Evidence rule

Every flagged campaign cites its delivery numbers, the cause rule it matched, and the evidence behind the cause:

> *"Brand FR (Acme FR): 0 impressions in the last 7 days, last impression 2026-04-14, €2,310 spent in the prior 28 days, €80/day budget. Recently stopped (medium): change history shows target CPA changed from €40 to €18 on 2026-04-14 by a Google auto-applied recommendation. Restore the target and watch a week."*
