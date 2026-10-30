---
name: google-ads-choose-bid-strategy
description: Assess every Google Ads campaign's bid strategy (Manual or Enhanced CPC, Maximize Clicks, Maximize Conversions, Target CPA, Maximize Conversion Value, Target ROAS, portfolio strategies and shared budgets) against conversion volume, value variance, target-versus-achieved gaps and learning-phase state, then recommend the right strategy, its starting target and a stepped migration path with wait windows. Use when the user asks which bid strategy a campaign should use, whether a CPA or ROAS target is set right, why a Smart Bidding campaign is throttled or volatile, whether to move to value-based bidding, how to manage the learning phase, or whether to use portfolio strategies or shared budgets. For budget increases on efficient campaigns use google-ads-find-scale-candidates; for consolidating campaigns too thin to learn use google-ads-audit-spend-fragmentation.
---

# Choose bid strategy

> For each campaign, pick the bid strategy its data can support, set a target the bidder can actually hit, and lay out a migration path that respects the learning phase.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The volume floors and learning-phase pathway come from `references/learning-phase-thresholds.md`, the target levers, step sizes and test windows from `references/smart-bidding-mechanics.md`, the budget-versus-bid lever and SIS caps from `references/sis-headroom.md`, window selection and eligibility gates from `references/stability-windowing.md`, and the value model per business type from `references/value-elicitation.md`.

## Goal

Produce one recommendation per campaign: keep, re-target, or migrate the bid strategy, with the exact target and the sequence of steps to get there. Most bidding problems are one of four things: a campaign on Smart Bidding without the volume to learn, a target set so tight the bidder throttles spend, a strategy that keeps changing so it never leaves learning, or a campaign asked to optimise several motions with one target. Find which one applies, and only then talk about strategy choice.

## Scope

- **Campaign types:** Search, Shopping, Performance Max, Demand Gen and Video campaigns with a conversion goal. Display campaigns follow the same logic. Campaigns on Target Impression Share (usually brand) are assessed on whether that choice still fits, not on CPA.
- **Portfolio strategies and shared budgets:** assessed as units. A portfolio target is one target for every campaign in it; a shared budget moves money between its campaigns.
- **Read-only:** the user applies every change. Bid and target changes always need a human decision, so this skill never frames any of them as safe to automate.
- **Not covered here:** budget sizing on efficient, budget-limited campaigns (`google-ads-find-scale-candidates`), merging campaigns (`google-ads-audit-spend-fragmentation`), and fixing conversion tracking or values (`google-ads-conversion-tracking`, `google-ads-configure-conversion-action`).

## Inputs you need

1. **Business context:** `wiki/company.md`: business type (ecommerce, B2B sales-led, B2B self-serve, B2C growth), what a customer is worth, margins. It decides whether value-based bidding is even the goal.
2. **Rules:** `ads/google/rules/*.md`: the business target CPA or ROAS per campaign group. This is the destination of every migration path. Without rules, fall back to the account's achieved numbers and say so; `google-ads-create-channel-rules` sets proper targets.
3. **Taxonomy:** `ads/taxonomy.md`: campaign groups and the motion each campaign serves. One campaign serves one motion and is graded on one metric; a campaign that bids for signups and demo requests with one target is a structural problem, not a target problem.
4. **Media plan:** `ads/media-plan.md`: flights, promotions and seasonal windows. ROAS and CPA targets for peak windows are set per window, not carried over from the annual average.
5. **Memory:** `ads/google/memory/MEMORY.md`: acknowledged choices ("brand stays on Target Impression Share"), known tracking outages, deliberate test periods.
6. **Recent findings:** `ads/google/findings/` from the last 14 days, especially earlier runs of this skill: a target changed on the last run is still inside its wait window.
7. **Primary conversion action:** `ads/google/index.md`. Bidding optimises to the conversion actions marked primary (biddable), which is what `metrics.conversions` counts. Report the primary action alongside when it differs.
8. **Live data:** the queries below, for each account in scope. Windows: 90 days ending yesterday for daily rows, 30 days ending yesterday for impression share, the last 29 days for change history.

## Phase 1: Pull the data

**Query A: campaign settings, current strategy and targets** (no metrics, no date)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  campaign.bidding_strategy_type,
  campaign.bidding_strategy,
  campaign.bidding_strategy_system_status,
  campaign.target_cpa.target_cpa_micros,
  campaign.maximize_conversions.target_cpa_micros,
  campaign.target_roas.target_roas,
  campaign.maximize_conversion_value.target_roas,
  campaign.target_spend.cpc_bid_ceiling_micros,
  campaign.target_impression_share.location,
  campaign.target_impression_share.location_fraction_micros,
  campaign.campaign_budget,
  campaign_budget.amount_micros,
  campaign_budget.explicitly_shared,
  campaign_budget.reference_count
FROM campaign
WHERE campaign.status = 'ENABLED'
```

`campaign.bidding_strategy` is the resource name of a portfolio strategy and is empty for a standard (campaign-level) strategy. Maximize Clicks comes back as `TARGET_SPEND`. Target ROAS values are ratios (4.0 = 400%). `campaign.bidding_strategy_system_status` reports learning and limited states (`LEARNING_NEW`, `LEARNING_SETTING_CHANGE`, `LEARNING_BUDGET_CHANGE`, `LEARNING_COMPOSITION_CHANGE`, `LEARNING_CONVERSION_TYPE_CHANGE`, `LEARNING_CONVERSION_SETTING_CHANGE`, `LIMITED_BY_BUDGET`, `LIMITED_BY_DATA`, `LIMITED_BY_CPC_BID_CEILING` and others). If the field is rejected on the user's API version, drop it, confirm with `get_resource_metadata` on `campaign`, and rely on the change history instead.

**Query B: portfolio strategies**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  bidding_strategy.resource_name,
  bidding_strategy.id,
  bidding_strategy.name,
  bidding_strategy.type,
  bidding_strategy.status,
  bidding_strategy.campaign_count,
  bidding_strategy.target_cpa.target_cpa_micros,
  bidding_strategy.target_roas.target_roas,
  bidding_strategy.maximize_conversions.target_cpa_micros,
  bidding_strategy.maximize_conversion_value.target_roas
FROM bidding_strategy
WHERE bidding_strategy.status = 'ENABLED'
```

A portfolio owned by a manager account doesn't appear here; it appears in `accessible_bidding_strategy` (same idea, fewer fields). Query that resource when a campaign's `campaign.bidding_strategy` points at a `customers/<manager_id>/...` resource.

**Query C: daily performance, 90 days**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  segments.date,
  metrics.cost_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
```

**Query D: impression share, 30 days** (one row per campaign; Search and Shopping only)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query E: conversions by action per campaign, 90 days** (what the bidder is optimising to, and the values it sees)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  segments.date,
  segments.conversion_action,
  segments.conversion_action_name,
  segments.conversion_action_category,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
  AND metrics.conversions > 0
```

**Query F: conversion action value settings**

```sql
SELECT
  customer.descriptive_name,
  conversion_action.resource_name,
  conversion_action.name,
  conversion_action.category,
  conversion_action.primary_for_goal,
  conversion_action.counting_type,
  conversion_action.value_settings.default_value,
  conversion_action.value_settings.always_use_default_value
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
```

**Query G: bidding and budget changes, last 29 days** (`change_event` rejects ranges that start 30 or more days ago and needs `LIMIT` ≤ 10000)

```sql
SELECT
  customer.descriptive_name,
  change_event.change_date_time,
  change_event.change_resource_type,
  change_event.changed_fields,
  change_event.client_type,
  campaign.id,
  campaign.name
FROM change_event
WHERE change_event.change_date_time >= '<today minus 29 days> 00:00:00'
  AND change_event.change_date_time <= '<today> 23:59:59'
  AND change_event.change_resource_type IN ('CAMPAIGN', 'CAMPAIGN_BUDGET', 'CAMPAIGN_CRITERION')
ORDER BY change_event.change_date_time DESC
LIMIT 5000
```

Edits made on a portfolio strategy itself (its target) don't surface as `CAMPAIGN` rows. Ask the user when the portfolio target last changed, or read it from the bid strategy report in the Google Ads UI.

**Query H: active seasonality adjustments and data exclusions:** run queries A and B of the health-check entry `active-bidding-overrides`. A campaign inside an active adjustment or exclusion window is read with that window in mind, not judged on it.

## Phase 2: Analyse each campaign

Use Python for every step. Load each result with a `customer_id` column; set `cost = cost_micros / 1e6`, CPA targets `= target_cpa_micros / 1e6`, CPC ceiling `= cpc_bid_ceiling_micros / 1e6`. Key every campaign on `(customer_id, campaign.id)`.

### Step 1: Resolve the effective strategy and target

1. `strategy` = `bidding_strategy_type` upper-cased. Family: `manual` (`MANUAL_CPC`, `ENHANCED_CPC`, `MANUAL_CPM`, `MANUAL_CPV`), `traffic` (`TARGET_SPEND`, `TARGET_IMPRESSION_SHARE`), `volume` (`MAXIMIZE_CONVERSIONS` without a target), `cpa` (`TARGET_CPA`, or `MAXIMIZE_CONVERSIONS` with `target_cpa_micros > 0`), `value` (`MAXIMIZE_CONVERSION_VALUE` without a target), `roas` (`TARGET_ROAS`, or `MAXIMIZE_CONVERSION_VALUE` with `target_roas > 0`).
2. `portfolio` = `campaign.bidding_strategy` is non-empty. For portfolio campaigns, join Query B on `bidding_strategy.resource_name = campaign.bidding_strategy` and take the type and target from the portfolio row.
3. `target_cpa` = the first non-zero of `target_cpa.target_cpa_micros`, `maximize_conversions.target_cpa_micros` (campaign, then portfolio). `target_roas` likewise from `target_roas.target_roas`, `maximize_conversion_value.target_roas`.
4. Treat `ENHANCED_CPC` on Search and Display as manual: Google has been retiring Enhanced CPC there, so every such campaign gets a migration recommendation.

### Step 2: Learning-phase state and the last significant change

From Query G, keep rows whose lower-cased `changed_fields` contains any of these tokens, and label each change:

| Token in `changed_fields` | Change |
|---|---|
| `bidding_strategy_type`, `bidding_strategy` (alone) | strategy switch or portfolio move |
| `target_cpa`, `target_roas` (inside `target_cpa.`, `maximize_conversions.`, `target_roas.`, `maximize_conversion_value.`) | target change |
| `amount_micros` on a `CAMPAIGN_BUDGET` row | budget change |
| `selective_optimization`, `conversion_goal` | conversion goal change |

For target and budget changes the row doesn't carry the old and new value. Estimate the size of a budget change from the spend level in Query C before and after the change date; for target changes, ask the user or the campaign's change history in the UI when the size matters.

Per campaign compute `last_significant_change` (the latest date of a strategy switch, a conversion goal change, a target change, or a budget change the user confirms was above 20%), `changes_29d` (count), and `days_since_change`. A campaign is **in learning** when `bidding_strategy_system_status` starts with `LEARNING_`, or `days_since_change < 14`. A campaign is **churning** when it had more than 2 strategy or target changes in 29 days (health-check `bid-strategy-churn`).

### Step 3: Volume, stability and the evaluation window

1. Apply the eligibility gates in `references/stability-windowing.md` to the daily spend in Query C. Campaigns that fail a gate get "not assessable" with the gate as the reason.
2. `conv_30d`, `value_30d`, `cost_30d` = sums over the last 30 days. When the campaign is in learning, also compute the same sums over the days since `last_significant_change` and use those for the target-gap step: performance before a strategy switch says little about the new strategy.
3. Floor by type, from `references/learning-phase-thresholds.md`: Search 30, PMax 50, Video 50. Use 30 for Shopping (single inventory) and 50 for Demand Gen (multi-inventory). `below_floor = conv_30d < floor`.
4. Weekly stability: sum conversions per ISO week over the last 12 complete weeks; `weekly_cv = std(ddof=0) / mean` (undefined when the mean is 0). Weekly CV above 0.5 means targets set off a single month are unreliable; widen the evaluation window to 90 days and say so.
5. Conversion lag: conversions keep arriving for days after the click. When the business has a long cycle (B2B sales-led, offline imports), recompute the 30-day numbers ending `<yesterday minus 7 days>` and compare. If the CPA on the lagged window is more than 10% lower, use the lagged window and say the recent days are still filling in.

### Step 4: Target against achieved

For `cpa` campaigns: `achieved_cpa = cost / conversions` on the evaluation window, `gap = (achieved_cpa - target_cpa) / target_cpa`. For `roas` campaigns: `achieved_roas = value / cost`, `gap = (achieved_roas - target_roas) / target_roas`. A ratio with a zero denominator is `NaN`, reported as "no conversions".

Budget utilisation: `utilisation = cost_30d / (daily_budget × 30)`. For a shared budget, sum `cost_30d` over every campaign on that budget (join on `campaign.campaign_budget`) and compare with the one shared amount.

Classify:

| State | Rule | What it means |
|---|---|---|
| **Throttled by target** | `cpa`: `gap > 0.15` (achieved CPA more than 15% above target) AND `utilisation < 0.8`. `roas`: `gap < -0.15` AND `utilisation < 0.8`. Status `LIMITED_*` other than budget strengthens it. | The target is tighter than anything the campaign has achieved; the bidder sits out auctions and leaves budget unspent. Tightening further shrinks volume and can start a spiral. |
| **Missing target, spending** | Same gap, `utilisation ≥ 0.8` | The bidder spends the budget but can't hit the target. Diagnose the cause (tracking, landing page, query mix, competition) before touching the target: run `google-ads-diagnose-trend-drift`. |
| **Target not binding** | `cpa`: `gap < -0.15`. `roas`: `gap > 0.15` | The campaign beats its target by a wide margin. If budget-limited (`search_budget_lost_impression_share ≥ 0.10`), it is a budget question: hand it to `google-ads-find-scale-candidates`. If not, and rank-lost impression share is 10% or more, loosen the target to buy volume. |
| **On target** | `abs(gap) ≤ 0.15` | Leave the target alone, or step it toward the business target from the rules. |

### Step 5: Is value-based bidding viable?

Value bidding (Maximize Conversion Value, Target ROAS) only beats CPA bidding when conversions are worth different amounts and the values reaching Google are real. Use Python on Queries E and F, joining on `segments.conversion_action = conversion_action.resource_name` and keeping the actions that count towards `metrics.conversions` for the campaign:

1. **Value coverage:** `valued_share = conversions with value > 0 / all conversions`, over 90 days.
2. **Static values:** an action is static when `always_use_default_value` is TRUE, or its daily value per conversion (`conversions_value / conversions` per action per day) has zero spread over 90 days. `dynamic_share` = conversions from non-static actions / all conversions.
3. **Value variance:** the best measure is the coefficient of variation of individual conversion values. GAQL doesn't return individual conversions, so ask the user for an order or deal export (CSV with value per transaction) when they have one, and compute `cv = std / mean` and the share of total value from the top 20% of conversions. Without an export, use the proxy: the conversion-weighted CV of daily value per conversion across the 90 days and across actions, and say it understates the true spread.
4. **Mixed motions:** count the distinct `conversion_action_category` values among the campaign's biddable actions, and the CV of their default values (health-check `single-campaign-multi-motion-bidding` uses 3 or more categories, or value CV of 1.0 or more, as the warning line). A campaign bidding on several motions with one CPA target treats a demo request and a newsletter signup as the same thing.

Verdict, in order:

| Verdict | Rule |
|---|---|
| Not viable: fix values first | `valued_share < 0.9` or `dynamic_share < 0.5` on a business whose conversions do differ in worth (ecommerce, tiered plans, B2B with deal sizes). Point at `google-ads-conversion-tracking` and `references/value-elicitation.md`. |
| Not needed | Values are real but nearly uniform: per-conversion CV below 0.25. CPA bidding gets the same outcome with less noise. |
| Viable | Floor met, `valued_share ≥ 0.9`, `dynamic_share ≥ 0.5`, and CV of 0.5 or more (or the top 20% of conversions carry 40% or more of value). |
| Borderline | Everything else. Recommend value bidding only after a test (see Phase 4). |

These cut-offs are practitioner rules of thumb, not Google thresholds. Print the inputs next to the verdict so the user can judge the borderline cases.

### Step 6: Pick the recommended strategy

Walk this decision flow per campaign (or per portfolio, using the summed volume of its campaigns):

```
Assessable (stability gates pass)?
  No  -> No change. Re-run after the gate clears.

Motion mix: biddable actions span more than one motion?
  Yes -> Structural: split by motion, or demote the secondary actions to secondary.
         Don't set or change a target until this is fixed.

Conversion tracking healthy (conversions in each of the last 14 days, no data exclusion needed)?
  No  -> Fix tracking first; no bidding change on broken data.

conv_30d below floor?
  Yes, on Smart Bidding  -> Cold start (health-check smart-bidding-cold-start). Options in order:
                            pool volume (portfolio or merge), or move to Maximize Clicks with
                            a CPC ceiling until the floor is met. Never tighten a target here.
  Yes, on manual/clicks  -> Stay, or Maximize Clicks with a ceiling. Revisit at the floor.

conv_30d at or above floor, on manual/clicks?
  -> Ready (health-check smart-bidding-readiness). Path: Maximize Conversions (no target)
     for 2-4 weeks, then add a target from achieved performance, then step toward the goal.

On Smart Bidding, at or above floor:
  Value verdict Viable and business optimises revenue or margin -> value family:
     Maximize Conversion Value, then Target ROAS once 2-4 stable weeks exist.
  Otherwise -> cpa family: Maximize Conversions, then Target CPA.
  Already on the right family -> keep the strategy, tune the target (Step 7).

Brand campaign on Target Impression Share?
  -> Keep when the goal is coverage of own-brand queries and CPC stays within the ceiling
     the user accepts; otherwise Maximize Conversions or Target CPA with a loose target.
```

Never recommend switching a campaign that is in learning or churning: the recommendation for those is "hold until <date>" (Step 8).

### Step 7: Recommended target and the stepping rule

The starting target comes from what the campaign has achieved, not from the business goal. The business goal (from the rules) is where the steps lead.

1. **Introducing a target** (Maximize Conversions to Target CPA, Maximize Conversion Value to Target ROAS): `start_cpa = achieved_cpa_30d × 1.10`, `start_roas = achieved_roas_30d × 0.90`. The 10% headroom keeps the bidder from throttling on day one.
2. **Step size**, from `references/smart-bidding-mechanics.md`: 5-10% per move by default; 10-15% when loosening a low-volume (under 1.5 × floor) or throttled campaign. Never more than 20% in a single move: beyond that it is a new target, and the campaign relearns.
3. **Direction:** throttled or not-binding campaigns loosen (CPA target up, ROAS target down); on-target campaigns step toward the business goal; campaigns missing target while spending are diagnosed, not tightened.
4. **Path:** in Python, iterate `next = current × (1 ± step)` until it reaches the goal, clamping the last step so it doesn't overshoot. `steps = ceil(log(goal / current) / log(1 ± step))`. Each step is scheduled one wait window after the previous one (Step 8), so the path also gives a date for each step and the date the goal is reached. Print the path; if it takes more than 8 steps, say the business goal is far from what the campaign achieves and that the goal, the offer or the structure needs a conversation, not just the target.
5. **Portfolios:** one target serves every campaign in the portfolio, so compute the gap on the summed cost, conversions and value of its campaigns, and list campaigns whose own gap points the other way: those are candidates to leave the portfolio.

### Step 8: Learning-phase management

**What counts as a significant change** (the bidder recalibrates): a strategy switch; adding or removing a target; a target move of more than 20%; a change to which conversion actions are biddable, or to their values or counting; moving campaigns into or out of a portfolio; a budget change of more than about 20% on a campaign or shared budget. Small target moves (5-15%) and minor budget moves still trigger a short recalibration, which is why each gets its own wait window.

**Batch, don't drip.** When a campaign needs several changes, make the related ones on the same day so the bidder relearns once: for example, set the new conversion goal and the starting target together, rather than one this week and the other next week. Don't batch unrelated changes you will want to read separately (a target change and a landing page change muddle the read).

**How long to wait.** `wait_days = 14` after a strategy switch, a conversion goal change or a portfolio move; `wait_days = 7` after a target step of 15% or less on a campaign above floor; `wait_days = 14` for campaigns under 1.5 × floor, whose weekly CV is above 0.5, or whose conversion lag is longer than 7 days. `next_change_date = last_significant_change + wait_days`. Judge the step on the days after the change only, never on a window that straddles it.

**Short events and broken data.** For a promotion or launch of a few days, a seasonality adjustment tells the bidder to expect a different conversion rate without relearning; for a tracking outage, a data exclusion over the broken dates keeps the bad data out. Both should be rare and scoped; list any active ones from Query H.

### Step 9: Portfolio strategies and shared budgets

- **Portfolio worth proposing:** two or more campaigns in the same motion with the same KPI and a similar target (within 20% of each other), each below floor, together at or above floor. Pooling gives the bidder enough signal without merging campaigns. Never pool across motions or across brand and non-brand.
- **Portfolio worth breaking up:** members' own gaps diverge (one is 30% over target while another is 30% under), or one campaign carries more than 80% of the portfolio's conversions so the others are steered by its data.
- **Shared budget check:** a shared budget across campaigns with different strategies, different targets or different motions lets the cheaper campaign take the money. Flag shared budgets whose campaigns don't share a strategy family and target, and recommend separate budgets (or a portfolio with a shared budget when they do share a goal).

## Severity

- `high`: throttled by target on a campaign with material spend (10% or more of account spend); Smart Bidding below floor on 10% or more of spend; mixed-motion bidding on a top-spend campaign; churning campaigns.
- `medium`: manual or Maximize Clicks campaigns above floor (ready to migrate); target not binding with rank-lost impression share of 10% or more; value bidding on not-viable values; shared budgets across mismatched strategies.
- `low`: on target with a gap to the business goal; portfolio candidates; Enhanced CPC migrations on low-spend campaigns.

Respect memory: a campaign the user deliberately keeps on a strategy is listed as `acknowledged`, not flagged.

## Output

One finding: `category: bids`, `kind: recommendation`.

**Wrap-up example:** *"3 of 11 campaigns need a bidding change. Non-Brand Generic FR is throttled by a €38 target CPA it has never hit (achieved €52 over 30 days, 61% of budget spent): loosen 15% to €44 now, then step to the €40 rules target in two 7-day moves once spend recovers. Two manual-CPC campaigns are above the 30-conversion floor and ready for Maximize Conversions."*

**General improvements**, for example:
- "Non-Brand Generic FR bids on 'demo request' and 'newsletter signup' with one target CPA: they are two motions. Make the newsletter action secondary before changing the target."
- "4 campaigns changed bid strategy or target more than twice in 29 days. Pick one strategy per campaign and hold it for at least 30 days; tune the target instead of switching."

**Recommendations:** the table the user applies, one row per step that is due now, plus the later steps of each path:

| account | campaign_or_portfolio | current_strategy | current_target | proposed_strategy | proposed_target | step | apply_on | reason |
|---|---|---|---|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | Target CPA | €38 | Target CPA | €44 | 1 of 3 | 2026-11-02 | Throttled: achieved €52 (+37% vs target), 61% of budget spent; +15% is the throttled-campaign step |
| Acme FR | Non-Brand Generic FR | Target CPA | €44 | Target CPA | €41 | 2 of 3 | 2026-11-09 | Only if utilisation is back above 80%; step toward the €40 rules target, 5-10% per move |
| Acme FR | Non-Brand Generic FR | Target CPA | €41 | Target CPA | €40 | 3 of 3 | 2026-11-16 | Last step, clamped to the rules target |
| Acme FR | Generic Paris | Manual CPC | €1.20 max CPC | Maximize Conversions | none | 1 of 3 | 2026-11-02 | 41 conversions in 30 days, above the Search floor of 30 |

**Details tables:**

*Per campaign*

| account | campaign | type | strategy | portfolio | target | achieved | gap | conv_30d | floor | utilisation | budget_lost_is | rank_lost_is | learning_state | days_since_change | value_verdict | severity | recommendation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

*Value-bidding viability* (campaigns on, or proposed for, value bidding)

| account | campaign | valued_share | dynamic_share | value_cv | cv_source (export or proxy) | top20_value_share | motions | verdict |
|---|---|---|---|---|---|---|---|---|

*Portfolios and shared budgets*

| account | portfolio_or_budget | type | campaigns | strategies_inside | summed_conv_30d | gap | issue | recommendation |
|---|---|---|---|---|---|---|---|---|

*Learning calendar*

| account | campaign | last_significant_change | change | wait_days | next_change_date |
|---|---|---|---|---|---|

**Pending example**
- title: *Non-Brand Generic FR throttled by a target CPA it has never hit; 2 manual campaigns ready for Smart Bidding*
- summary: *Target €38 vs achieved €52 over 30 days with 61% of budget spent. Loosen to €44 now and step to the €40 rules target by 2026-11-16 if spend recovers. Generic Paris (41 conversions) and Brand Lyon (33) clear the 30-conversion floor on Manual CPC.*

**OK example**
- title: *Bid strategies fit their volume; every target within 15% of achieved*
- summary: *Checked 11 campaigns and 1 portfolio over 90 days: all Smart Bidding campaigns are above their floor, no target is more than 15% from achieved, no campaign changed strategy more than twice in 29 days, and value bidding runs only where values are dynamic.*
- The body lists what was checked (floors applied, the gap rule, churn window, value verdicts) and why each passed.

## Workspace writes (when the user confirms)

- The user agrees a migration path → write `ads/google/strategy/bid-strategy-plan.md` with one section per campaign or portfolio: current state, target path with dates, wait windows, and the check to run at each step ("on 2026-11-16 confirm CPA on the days since 2026-11-02 is within 15% of €47 before stepping to €43"). On a repeat run, update the existing sections and mark completed steps.
- The rules target is out of reach (path longer than 8 steps) → propose the revised target inside the finding; never edit `ads/google/rules/` directly.
- The user keeps a strategy on purpose ("brand stays on Target Impression Share") → write a memory file under `ads/google/memory/` with the campaign and the reason, and add a line to `MEMORY.md`.
- The user wants a strategy switch tested before rolling it out → hand the hypothesis to `google-ads-plan-tests` (a campaign experiment splitting traffic between the current and proposed strategy) if it is installed.

## Evidence rule

Every recommendation names the campaign, the current strategy and target, the achieved number on the stated window, the volume against the floor, and the rule it crossed:

> *"Non-Brand Generic FR, Target CPA €38: achieved €52 on 64 conversions in the 30 days to 2026-10-29 (+37% vs target), €4,120 spent of a €6,750 budget (61%). Throttled by target (gap above 15%, utilisation below 80%). Proposed: Target CPA €44 now (+15%, the throttled-campaign step; €38 × 1.15 = €43.70, rounded up), then 5-10% steps toward the €40 rules target at 7-day intervals while budget use stays above 80%."*

Keep the step arithmetic in the Python output, and state every rounding in the recommendation. When a number is a proxy (value variance without a transaction export, budget change size estimated from spend), say so next to it.
