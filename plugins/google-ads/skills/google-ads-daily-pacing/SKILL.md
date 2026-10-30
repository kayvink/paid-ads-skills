---
name: google-ads-daily-pacing
description: Quick daily Google Ads budget delivery check. Flags campaigns that have already spent more than 1.5x their daily budget today, forecasts each account's month-end spend against its monthly target, and warns when an account budget nears its approved spending limit. Use when the user asks whether campaigns are overspending today, whether the account will hit its monthly budget, about budget caps, or for a daily pacing check. For the full spend-vs-plan and performance-vs-target audit per budget line use google-ads-check-pacing.
---

# Daily Pacing

> Check if campaigns are on track to spend their daily and monthly budgets evenly.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

A fast, mechanical check that budgets are delivering the way they should, run daily or several times a day. Three questions:

1. **Today:** is any campaign running away from its daily budget?
2. **This month:** is each account on track to land between 80% and 110% of its monthly target?
3. **The hard stop:** is any account budget (the billing-level spending limit) close to exhausted, which would stop every campaign in the account at once?

## How this differs from google-ads-check-pacing

This skill is the quick daily budget-delivery check: mechanical, account and campaign level, no performance judgement, no media plan allocation lines. `google-ads-check-pacing` is the deeper audit: spend against each budget line in `ads/media-plan.md`, paired with performance against the targets in `ads/google/rules/`, with the four-quadrant scale and throttle actions. When this skill finds an account over- or under-pacing, the follow-up is `google-ads-check-pacing` to see which budget lines drive it and whether the performance justifies it.

## Inputs you need

1. **Monthly target per account.** In order of preference: the Google Ads amount for the current period in `ads/media-plan.md` (`total_monthly_ceiling` when the plan covers Google Ads only, or the Google Ads channel line otherwise); the sum of the `Monthly cap` lines across `ads/google/rules/*.md`; a figure the user gives. With none of these, skip the monthly pass for that account and say so; don't invent a target from the daily budgets.
2. **Cycle start day.** The day of the month the budget cycle starts: 1 (calendar month) by default, or what the media plan or the user states (for example 15 for a mid-month cycle). Values are clamped to 1–28.
3. **Memory:** `ads/google/memory/MEMORY.md`. Intentional bursts ("launch day, overspend is fine") are not re-flagged.
4. **Recent findings:** `ads/google/findings/` from the last 14 days, so a repeat run on the same day updates the existing finding.
5. **Live data:** the queries below, for each account in scope.

## Step 0: The account's date

Pacing depends on "today" in the account's own time zone, not yours.

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  customer.time_zone
FROM customer
```

Use Python with `zoneinfo.ZoneInfo(customer.time_zone)` to get `today` per account. Every date below is relative to it.

## Step 1: Today's over-delivery

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign_budget.id,
  campaign_budget.amount_micros,
  campaign_budget.explicitly_shared,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date = '<today>'
```

Google may spend up to 2x a campaign's daily budget on any one day and reconciles the excess over the month, so a heavy day is followed by throttled serving while it catches up. Below 1.5x, normal pacing absorbs the variance; above it, a clawback day is queued.

Use Python:

- `daily_budget = amount_micros / 1e6`, `spend_today = cost_micros / 1e6`.
- For campaigns on a **shared budget** (`explicitly_shared` true), sum `spend_today` across all campaigns with the same `(customer_id, campaign_budget.id)` and compare the sum to the budget once; one shared budget is one pacing unit. Otherwise compare per campaign.
- `ratio = spend_today / daily_budget`, only where `daily_budget > 0`.
- Flag when `ratio > 1.5`. Sort by `ratio` descending and print the worst ratio.

Early in the day the ratio is naturally low, so this pass only finds runaways. Say what local time the data was pulled.

**Is it recurring?** For the flagged campaigns only, pull the last 7 complete days:

```sql
SELECT
  campaign.id, campaign.name,
  segments.date,
  campaign_budget.amount_micros,
  metrics.cost_micros
FROM campaign
WHERE campaign.id IN (<flagged_campaign_ids>)
  AND segments.date BETWEEN '<today minus 7 days>' AND '<yesterday>'
```

Use Python to compute the same ratio per day and count the days above 1.5. Two or more such days in the week means the over-delivery is a pattern: the budget is too low for sustained performance, not a one-off burst.

## Step 2: Month-end forecast per account

Use Python to work out the cycle for each account:

- `cycle_start` = this month's `cycle_start_day` if `today.day >= cycle_start_day`, otherwise the same day of last month.
- `cycle_end` = `cycle_start` plus one month, minus one day.
- `days_in_cycle = (cycle_end - cycle_start).days + 1`.
- `days_elapsed = (today - cycle_start).days + 1` (today counts as elapsed).

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  segments.date,
  metrics.cost_micros
FROM customer
WHERE segments.date BETWEEN '<cycle_start>' AND '<today>'
```

Then:

- `mtd_spend` = sum of `cost` over the rows (today's partial spend included).
- `forecast = mtd_spend / days_elapsed * days_in_cycle`.
- `pace_pct = forecast / target_monthly * 100`, rounded to a whole percent.
- Flag **over-pacing** when `pace_pct > 110`, **under-pacing** when `pace_pct < 80`. Skip accounts with no target.

Because today's spend is partial but counts as a full elapsed day, the forecast reads slightly low early in the day and in the first days of a cycle. In the first 3 days of a cycle, say the forecast is low-confidence.

What each means:
- **Over-pacing:** left alone, the account hits its budget before the cycle ends and stops serving in the last week.
- **Under-pacing:** either demand dropped, the bidder is too conservative, or impression share is leaking to rank. Check Lost IS Budget and Lost IS Rank (`google-ads-campaigns-not-spending` step 6, or `google-ads-budget-allocation`): high budget loss means raise budgets; high rank loss means work on Quality Score or bids; neither means demand has fallen and the target needs adjusting.

## Step 3: Account budget against its spending limit

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  account_budget.id,
  account_budget.name,
  account_budget.status,
  account_budget.approved_spending_limit_micros,
  account_budget.adjusted_spending_limit_micros,
  account_budget.amount_served_micros
FROM account_budget
WHERE account_budget.status = 'APPROVED'
```

This query often fails or returns nothing for accounts on automatic payments or without access to billing setup. Treat a per-account error as "no account budget visible" for that account, list it, and carry on; only call the pass failed when every account errors.

Use Python per row:

- `effective_limit` = `adjusted_spending_limit_micros / 1e6` when it is above 0, else `approved_spending_limit_micros / 1e6`. Skip rows where `effective_limit <= 0` (no limit, or an unlimited budget).
- `served = amount_served_micros / 1e6`, `served_pct = served / effective_limit * 100`, rounded.
- **Fail** when `served_pct >= 95`: campaigns are about to stop serving, expect an instant traffic cliff.
- **Warn** when `80 <= served_pct < 95`: plan the next adjustment before campaigns hit the cap.
- Sort each list by `served_pct` descending.

For warned rows, estimate the days left in Python: `remaining = effective_limit - served`, divided by the average daily spend over the last 7 complete days (from the account query in step 2 extended back if needed). State the date the limit would be reached at that rate.

## Interpretation rules

- **Severity:**
  - `high`: an account budget at or above 95% of its limit.
  - `medium`: a campaign above 1.5x its daily budget today; an account forecast above 110% of target; an account budget between 80% and 95% of its limit.
  - `low`: an account forecast below 80% of target.
- Raise a campaign over-delivery to the top of the medium rows when it recurs (two or more days above 1.5x in the last week).
- Respect memory and the media plan: a declared burst day or launch is reported as "intentional" and not recommended against.
- Late in a cycle (day 25 or later) an under-pacing account has little time to recover; say so.
- This skill does not judge whether the spend is performing. If the user asks "is the overspend worth it", run `google-ads-check-pacing`.

## Recommended actions

| Situation | Recommendation |
|---|---|
| Campaign over 1.5x today, intentional (launch day, sale starting) | Accept tomorrow's throttle; expect a low-impression day. |
| Campaign over 1.5x today, a runaway | Raise the daily budget or pause the campaign before more spend lands. |
| Over-delivery on 2+ days this week | The budget is too low for sustained performance; raise it or narrow targeting. |
| Account forecast above 110% | Lower daily budgets on the over-pacing campaigns, or raise the monthly target if the spend is intended. Watch Lost IS Budget once budgets tighten. |
| Account forecast below 80% | Cross-check impression share losses (see step 2). |
| Account budget at 95%+ | Raise the approved spending limit or apply an adjustment in billing; if the cap is intended, tell stakeholders before campaigns pause. |
| Account budget at 80–95% | Forecast the remaining spend and decide: raise the cap, narrow scope, or accept the throttle. |

## Output

One finding: `category: budget`, `kind: anomaly`.

**Wrap-up example:** *"Acme FR forecasts €46.2k against a €40k monthly target (116%); 2 campaigns have already spent more than 1.5x today's budget, one of them for the third day this week."*

**Per-account summary:** one line per account with MTD spend, forecast, pace %, campaigns over 1.5x today, and account budget headroom.

**Recommendations:**

| account | entity | current | proposed | reason |
|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR daily budget | €100 | €140 | 1.8x today and above 1.5x on 3 of the last 7 days |

**Details:**

*Over-delivery today*

| account | campaign_or_shared_budget | daily_budget | spend_today | ratio | days_over_1.5x_last_7 | severity |
|---|---|---|---|---|---|---|

*Monthly pacing*

| account | target_monthly | target_source | mtd_spend | days_elapsed | days_in_cycle | forecast | pace_pct | severity |
|---|---|---|---|---|---|---|---|---|

*Account budgets*

| account | budget_name | effective_limit | served | served_pct | days_left_at_current_rate | severity |
|---|---|---|---|---|---|---|

**Pending example**
- title: *Acme FR forecasts 116% of its monthly target; 2 campaigns over 1.5x today*
- summary: *€18.5k spent by day 12 of 30 against €40k. Non-Brand Generic FR is at 1.8x its daily budget and has been above 1.5x on 3 of the last 7 days.*

**OK example**
- title: *Daily budgets and monthly pace on track across 2 accounts*
- summary: *No campaign above 1.5x its daily budget at 14:00 local time; both accounts forecast 94% and 102% of target on day 12 of 30; no account budget above 80% of its limit.*
- The body states what was checked (time of pull, targets and their source, cycle days, account budgets found or not visible) and why each passed.

## Workspace writes (when the user confirms)

- The user confirms an intentional burst ("Black Friday week, overspend is planned") → write a memory file under `ads/google/memory/` scoping the campaigns and dates, and add a line to `MEMORY.md`.
- The user gives a monthly target or cycle start day that isn't in the media plan → propose adding it to `ads/media-plan.md` in the finding (or write it with consent when the user is present); `google-ads-create-media-plan` owns that file.

## Evidence rule

Every flag cites the numbers and the threshold:

> *"Acme FR: €18,480 spent from 2026-04-01 to 2026-04-12 (12 of 30 days), forecast €46,200, 116% of the €40,000 target from ads/media-plan.md. Over the 110% threshold."*

> *"Non-Brand Generic FR: €182 spent by 14:00 against a €100 daily budget (1.82x, threshold 1.5x); above 1.5x on 3 of the last 7 days."*
