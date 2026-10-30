---
name: google-ads-check-pacing
description: Audit Google Ads spend pacing against the media plan for the current period and pair it with performance against per-group ROAS or CPA targets, then recommend scale, throttle or reallocate actions with an end-of-period forecast where it matters. Use when the user asks whether spend is on track, if they will over- or underspend this month or quarter, about budget pacing, or which campaigns to scale or throttle. Needs ads/media-plan.md (google-ads-create-media-plan) and ads/google/rules/ (google-ads-create-channel-rules).
---

# Check pacing

> Audit daily pacing against the media plan and pair it with performance. Report where spend is ahead / behind and where that combines with over/under-performance against targets. Recommend scale / throttle / reallocate actions.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The exclude-today rule and the daily spend rate used for forecasting are described in `references/stability-windowing.md`.

## Goal

For the current period (defined by `ads/media-plan.md`), report whether spend is tracking to plan and whether performance is tracking to targets. Surface the four-quadrant combinations (spend ↔ performance) with prioritised actions. Forecast only when under-delivery risk or scaling opportunity warrants it.

## Scope

Google Ads. Other channels follow the same framework when their data is available.

This skill recommends only. The user changes budgets and bids.

## Preconditions

This skill needs a declared media plan and per-group rules to do its job. If either is missing, stop and direct the user:

- `ads/media-plan.md` missing → run the `google-ads-create-media-plan` skill first; pacing needs a target to pace against.
- `ads/google/rules/*.md` missing or covering no relevant groups → run the `google-ads-create-channel-rules` skill first; pacing pairs with target ROAS / CPA from rules.

Still write a finding in that case (`status: pending`), stating what is missing and which skill to run.

If the media plan is declared with `strategy: efficiency` (no allocation targets), skip the spend-vs-plan analysis and run the efficiency variant (see "Strategy adaptation" below).

## Inputs you need

1. **Media plan:** read `ads/media-plan.md`. Source of truth for period bounds, total budget, pacing strategy, and allocations per budget line. Read:
   - `period` (frontmatter), e.g. `2026-Q2`
   - `strategy`: `allocation` / `efficiency` / `hybrid` / `ceiling`
   - `pacing`: `linear` / `front-loaded` / `back-loaded` / `custom` (default `linear`)
   - `pacing_tolerance`: % drift before flagging (default 10)
   - `total_monthly_ceiling` (or per-month breakdown if quarterly)
   - Allocation tables by country / channel / group
2. **Rules:** list `ads/google/rules/` and read each file for per-group ROAS / CPA targets and health thresholds.
3. **Taxonomy:** read `ads/taxonomy.md` for campaign → group mapping, tier definitions.
4. **Business context:** read `wiki/company.md` for scale and business-type calibration.
5. **Memory:** read `ads/google/memory/MEMORY.md`. Scan for relevant entries (acknowledged exceptions like "we're deliberately ahead this week for a seasonal push") and read the individual files for full context.
6. **Plan discipline preference:** check the `ads/media-plan.md` frontmatter for `plan_discipline: strict | flexible` (default `flexible`). With the user present, if unclear, ask once and offer to write the answer back. Strict = match plan exactly; flexible = deviate from plan to capture performance opportunity.
7. **Primary conversion action:** `ads/google/index.md`.
8. **Live daily spend and performance:** the queries below, for each account in scope.

### Period-to-date daily per campaign (exclude today: partial data)

The performance-side comparison (period-to-date ROAS / CPA against target) uses the **primary-action** count from query B when one is configured. Join A and B in Python on `(customer_id, campaign.id, segments.date)`; a day missing from B means zero primary conversions that day, not a null.

**Query A: spend, structure and funnel conversions**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  campaign.bidding_strategy_type,
  campaign_budget.amount_micros,
  campaign_budget.delivery_method,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<first_day_of_period>' AND '<yesterday>'
```

**Query B: primary-action conversions** (skip when no primary action is configured, and use `metrics.conversions` / `metrics.conversions_value` added to query A instead)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  segments.date,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<first_day_of_period>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

### Budget-capped detection

For efficiency-strategy accounts, or to flag capped campaigns in allocation mode. Last 7 complete days. Don't select `segments.date` here: impression-share metrics are ratios and can't be summed across days, so let the API return one row per campaign for the whole range.

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  metrics.search_budget_lost_impression_share,
  metrics.search_budget_lost_absolute_top_impression_share,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 6 days>' AND '<yesterday>'
```

Impression-share metrics come back as fractions (0.05 = 5%).

## Step 1: Map campaigns to budget lines and targets

Use Python to attach a budget line and a group to every campaign:

- The **budget line** is whatever the plan allocates on (country, channel, group, or tier). Map each campaign to its line using the naming schema and groups in `ads/taxonomy.md` (for channel lines, use `campaign.advertising_channel_type`).
- The **group** is the taxonomy group whose `ads/google/rules/<group>.md` holds the target KPI (ROAS or CPA) and target value.
- Campaigns that map to no budget line are **uncovered spend**. Sum their period-to-date cost and report it as a share of total period-to-date spend (it goes into General improvements).
- Campaigns whose group has no rules file fall back to the account average for the performance pairing; say so.

## Step 2: Pacing math

Use Python to compute, per budget line and per account (summing period-to-date `cost` per `(customer_id, budget line)` from query A):

Default (linear strategy):

```
days_elapsed   = today - period_start      (complete days, today excluded)
days_total     = period_end - period_start + 1   (period_end is the last day of the period)
expected_pct   = days_elapsed / days_total * 100
actual_pct     = ptd_spend / planned_budget * 100
variance_pct   = actual_pct - expected_pct

ahead-on-spend  if variance_pct > +pacing_tolerance
behind-on-spend if variance_pct < -pacing_tolerance
on-pace         if |variance_pct| <= pacing_tolerance
```

`planned_budget` for a line = the line's allocation % × the period budget. The period budget is the sum of the plan's per-month breakdown when it has one, else `total_monthly_ceiling` × the number of months in the period.

**Non-linear strategies:**
- `front-loaded`: expected curve ~60% spend by day N/2. Apply a simple weighting: `expected_pct = min(100, days_elapsed / days_total × 1.2 × 100)`.
- `back-loaded`: mirror, heavier at the end of the period: `expected_pct = max(0, (days_elapsed / days_total × 1.2 − 0.2) × 100)`.
- `custom`: read the plan's monthly breakdown. If the plan says April €12k, May €15k, June €13k and today is May 15, expected = (April total + half of May) / total. In Python: sum the full months already completed, add the current month's budget × (complete days in the current month / days in the month), divide by the period total.

**Exclude today from data.** Today has partial spend. Yesterday is the latest complete day.

## Step 3: Performance side (paired with spend)

Use Python to compute, for each campaign and each budget line, period-to-date totals from the joined A+B rows: cost, primary conversions, primary conversion value. Then derive from the sums:

- ROAS = conversion value / cost
- CPA = cost / conversions (NaN when there are no conversions; report "no conversions")

Compare to the group's target from `rules/<group>.md`:

```
For ROAS (higher is better):
  ahead-on-perf   if ptd_roas > target * 1.10
  behind-on-perf  if ptd_roas < target * 0.90
  on-target       otherwise (within ±10% of target)

For CPA (lower is better):
  ahead-on-perf   if ptd_cpa < target * 0.90
  behind-on-perf  if ptd_cpa > target * 1.10
  on-target       otherwise

perf_variance_pct = (ptd_metric - target) / target * 100
```

(10% matches the default pacing tolerance; it can vary by preference.)

## Step 4: Four-quadrant matrix

Use Python to combine the spend axis (step 2) and performance axis (step 3) per campaign and per budget line, and look up the action:

| Spend | Performance | Action |
|---|---|---|
| Behind | Behind | **Scale within budget**: underspending AND underperforming is double underdelivery. Investigate: budget caps, quality issues, or should the budget move elsewhere. Flag strong risk of period-end underspend. |
| Behind | Ahead | **Growth opportunity**: performance strong but budget-constrained. Increase spend / reallocate from lower performers. |
| Ahead | Ahead | **Scaling opportunity**: winner running hot. Increase investment; consider raising plan allocation next period. |
| Ahead | Behind | **Throttle or investigate**: overspending without the ROAS to justify it. Drop budget, check for tracking issues, caps, stale creative. |
| On pace | Behind | Performance issue, not a pacing issue: investigate creative, targeting, tracking. Don't touch spend. |
| On pace | Ahead | No action: delivering as planned. |
| On pace | On target | No action. |

Campaign-level spend pacing uses the campaign's share of its line: when a line holds several campaigns and the plan doesn't allocate below the line, pace the line and use the campaign rows only to attribute the line's drift (which campaign carries most of the over- or underspend).

## Strategy adaptation

The skill behaves differently based on the media plan's `strategy` field:

- **`allocation`:** full pacing vs plan analysis. Default behaviour (above).
- **`efficiency`:** no spend targets to pace against. Instead report:
  - Total period-to-date spend vs monthly ceiling (if declared)
  - Per-campaign performance vs target (from rules)
  - Budget-capped campaigns via `search_budget_lost_impression_share > 0.05` (5%). These are the growth-constrained ones that matter most under efficiency strategy.
- **`hybrid`:** full pacing analysis for dimensions explicitly allocated; efficiency logic for dimensions that aren't.
- **`ceiling`:** total-only view. Check the period-to-date spend rate vs the monthly ceiling, flag if the forecast exceeds the cap. No allocation-level breakdown.

## Step 5: Forecasting

Only forecast end-of-period spend when there's a specific reason:
- **Under-delivery risk:** significant behind-on-spend at mid-period or later → project shortfall
- **Over-delivery risk:** significant ahead-on-spend → project overrun; flag ceiling breach
- **Scaling opportunity:** ahead + performance strong → project room to invest

Use Python for the forecast (simple): `projected_end = ptd_spend / days_elapsed × days_total`. Compare `projected_end` with `planned_budget` (and with the ceiling: `total_monthly_ceiling` × months, or the per-month sum), and print the projected over- or underspend as an amount and a percentage. Note the linearity assumption in the output.

Don't forecast when on pace: no signal to add.

## Interpretation rules

Apply the four-quadrant actions plus:

- **Acknowledged exceptions** in `ads/google/memory/MEMORY.md` (e.g. "seasonal sale week, we're deliberately ahead") → do not re-flag.
- **Early-period noise:** days 1–3 of a new month have high variance even when on pace; severity drops to low unless variance is extreme (`|variance_pct| > 50`).
- **Late-period urgency:** day 25 or later of a month with significant behind-on-spend: urgency bumps up because the recovery window is short.
- **Budget-capped campaigns** (impression share lost to budget > 5%): flag separately. These are held back by budget, not performance: growth opportunities for reallocation.
- **Tracking anomaly suspicion:** if performance is wildly off (period-to-date ROAS below 30% of target with volume; for CPA, the equivalent is CPA above target ÷ 0.3, about 3.3× target), recommend investigation (tracking first, then creative, then targeting) rather than a throttle action. Throttling based on bad data compounds the issue.

Apply these in Python after the quadrant lookup: compute day-of-month from yesterday's date, and print for each line the quadrant, the adjusted severity and which rule changed it.

## Output

One finding: `category: budget`, `kind: audit`. Fill the standard body with:

**Wrap-up:** one line: projected period-end position + biggest action.
Example: *"At current pace you'll overspend by 12% while missing ROAS 3.2 vs 4.0 target; biggest drag is campaign Brand NL scaled up without conversion growth."*

**Per-account summary:** only if multi-account.

**General improvements:** structural / plan-level findings:
- "Plan doesn't declare `pacing_tolerance`, defaulting to 10%; set it explicitly if you want stricter or looser."
- "No rules file for `shopping`; the performance pairing falls back to the account average. Targets recommended."
- "Plan is `strategy: allocation` but 3 of 8 campaigns have no budget line in the allocation table; uncovered spend is 14% of period-to-date spend."

**Recommendations:** plan-level or rule-level changes that would unblock clearer pacing (e.g. *"declare a shopping budget line in the media plan"*), plus the budget actions as a table the user applies:

| account | campaign_or_line | current_daily_budget | proposed_change | reason |
|---|---|---|---|---|

**Account roll-up table** (always rendered):

| account | ptd_spend | planned_pct | actual_pct | variance | ptd_roas_or_cpa | target | perf_variance | forecast_end | severity |
|---|---|---|---|---|---|---|---|---|---|

**Per-budget-line table** (one section per group that has issues or noteworthy state):

| account | campaign | group | ptd_spend | planned_pct | actual_pct | variance | ptd_roas_or_cpa | target | perf_variance | context | severity | recommendation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

`context` captures the hypothesis for why ("budget-capped", "quality score drop", "tracking suspected", "seasonal", "creative fatigue"). `recommendation` is a concrete action (*"throttle budget 20%"*, *"increase budget €300/mo"*, *"investigate tracking"*, *"refresh creative"*, *"reallocate to Brand NL"*).

`severity` values for this skill:
- `high`: significant overspend + underperformance, OR late-period severe underspend, OR forecast breaches ceiling
- `medium`: any single-axis drift outside tolerance; growth opportunities with evidence
- `low`: within tolerance; early-period noise; acknowledged exceptions

Set `status: ok` when every line is on pace and on target.

**Pending example:**
- title: *+12% overspend projected; ROAS 3.2 vs 4.0 target across 3 groups*
- summary: *Brand NL +28% spend / -18% ROAS, throttle. Non-Brand DE -15% spend / +22% ROAS, scale within line. Shopping on pace. Period-end forecast breaches the €42k ceiling by €5k.*

**OK example (on pace, on target):**
- title: *On pace across all groups; no action required*
- summary: *Account period-to-date spend tracking to plan within ±6%; ROAS within ±8% of target across 5 active groups; no budget-capped campaigns with lost impression share above 5%.*
- The body describes what was checked (period bounds, day of period, groups inspected, variance ranges) and why it passed.

## Workspace writes (when the user confirms)

- The user acknowledges an intentional deviation ("deliberately ahead for the sale week, don't re-flag it") → write a new file under `ads/google/memory/` (e.g. `sale-week-ahead-ok.md`) with a dated note scoping the acknowledgment (which campaign / group, which period), then add a one-line entry to `MEMORY.md`.
- The user declares a discipline preference for the first time ("we want strict adherence to plan") → add `plan_discipline: strict` or `flexible` to the `ads/media-plan.md` frontmatter.
- If rules files need revising because targets look clearly wrong (observed far exceeds or falls far short consistently), recommend re-running `google-ads-create-channel-rules` in update mode. Don't rewrite rules from inside this skill.

On an unattended run, make none of these writes; put the proposals in the finding.

## Evidence rule

Every recommendation cites the numbers: *"Brand NL: period-to-date spend €4,200 (52% of the €8,000 monthly plan), expected 48% by day 14, variance +4pp, on pace. Period-to-date ROAS 2.8 vs 4.0 target (-30%). Action: investigate (tracking / creative), not throttle, because spend is on pace."* No vague "Brand NL looks off."
