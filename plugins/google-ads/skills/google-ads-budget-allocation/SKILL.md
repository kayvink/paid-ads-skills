---
name: google-ads-budget-allocation
description: Audit how Google Ads budget is split across campaign groups against the media plan and the per-group rules, and against marginal performance (CPA or ROAS versus target, impression share lost to budget, scale headroom, fragmentation), then propose budget moves from inefficient to budget-limited efficient campaigns with the projected impact. Use when the user asks whether budget is in the right place, where to move budget, which campaigns deserve more budget, how spend is split across brand, non-brand, PMax and other groups, or for a reallocation plan. For month-to-date pacing against the plan use google-ads-check-pacing.
---

# Budget Allocation Audit

> Evaluate whether budget is allocated optimally across campaign groups based on performance and targets.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Budget increases follow `references/sis-headroom.md`, performance tiers follow `references/smart-bidding-mechanics.md`, volume floors follow `references/learning-phase-thresholds.md`, and priorities follow `references/priority-tiers.md`.

## Goal

Answer three questions, in this order:

1. **Is spend where the plan says it should be?** Actual share of spend per campaign group against `ads/media-plan.md`, and actual spend against each group's monthly cap in `ads/google/rules/`.
2. **Is spend where it performs?** Each group's and campaign's CPA or ROAS against its target, and where the marginal euro would do more: campaigns that are efficient and losing impressions to budget, against campaigns that are inefficient and have budget to spare.
3. **Is spend structured so bidding can work?** Too many tiny campaigns starve Smart Bidding; one account taking most of the spend sizes the blast radius of any change.

Then propose a reallocation the user can apply: which budgets to raise, which to lower, by how much, and what it should buy.

## Scope

All enabled campaigns in the accounts in scope, over the 30 days ending yesterday. Impression share signals exist only for Search and Shopping; for PMax, Display, Video and Demand Gen the allocation is judged on performance against target and the plan alone, and the finding says so.

## How this differs from neighbouring skills

- `google-ads-check-pacing`: month-to-date spend against the plan's budget lines and whether the period will land on plan. This skill looks at the last 30 days of allocation and marginal performance, not the calendar.
- `google-ads-daily-pacing`: today's over-delivery, month-end forecast, account spending limits.
- `google-ads-check-spend-fragmentation`: the full consolidation audit when this skill's fragmentation pass is material.
- `google-ads-find-scale-candidates`: a scale-only shortlist without the donor side.

## Inputs you need

1. **Media plan:** `ads/media-plan.md`. Read `period`, `strategy` (`allocation`, `efficiency`, `hybrid`, `ceiling`), `total_monthly_ceiling`, and the allocation tables by channel, group or tier. Missing: skip the plan comparison, say so, and suggest `google-ads-create-media-plan`.
2. **Rules:** `ads/google/rules/*.md`, one per group: KPI (CPA or ROAS), target, monthly cap, and the scale, reduce and pause signals. Missing: benchmark against the group's peer median (see step 4) and suggest `google-ads-create-channel-rules`.
3. **Taxonomy:** `ads/taxonomy.md`, for the campaign-to-group mapping.
4. **Business context:** `wiki/company.md`, for scale and whether the account is CPA- or ROAS-driven.
5. **Memory:** `ads/google/memory/MEMORY.md`. Deliberate allocations ("brand stays funded regardless of ROAS") are not re-flagged.
6. **Primary conversion action and brand terms:** `ads/google/index.md`.
7. **Recent findings:** `ads/google/findings/` from the last 14 days, especially from `google-ads-check-pacing`, so recommendations don't contradict a recent pacing decision without saying why.
8. **Live data:** the queries below, for each account in scope. Window: the 30 days ending yesterday, written as `BETWEEN '<start>' AND '<end>'`.

## Step 1: Pull spend, performance and state

**Query A: daily spend and performance per campaign**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.conversions,
  metrics.conversions_value,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Query B: primary-action conversions** (skip when no primary action is configured and use `metrics.conversions` from query A)

```sql
SELECT
  campaign.id,
  segments.date,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

**Query C: budgets, bidding and serving state** (current state, no date range)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  campaign.bidding_strategy_type,
  campaign.target_cpa.target_cpa_micros,
  campaign.target_roas.target_roas,
  campaign.maximize_conversions.target_cpa_micros,
  campaign.maximize_conversion_value.target_roas,
  campaign.primary_status_reasons,
  campaign_budget.id,
  campaign_budget.amount_micros,
  campaign_budget.explicitly_shared
FROM campaign
WHERE campaign.status = 'ENABLED'
```

**Query D: impression share, Search and Shopping**

```sql
SELECT
  campaign.id, campaign.name,
  segments.date,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share,
  metrics.cost_micros,
  metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Query E: spend per account** (only when more than one account is in scope)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  metrics.cost_micros
FROM customer
WHERE segments.date BETWEEN '<start>' AND '<end>'
```

Join everything in Python on `(customer_id, campaign.id)`, and B to A additionally on `segments.date`. Missing days in B are zero conversions, not nulls.

## Step 2: Map campaigns to groups

Use Python to assign every campaign one group:

1. The mapping in `ads/taxonomy.md` when it lists the campaign or a naming pattern that matches it.
2. Otherwise by channel: `PERFORMANCE_MAX` → pmax, `SHOPPING` → shopping, `DISPLAY` → display, `VIDEO` → video, `DEMAND_GEN` → demand-gen; `SEARCH` → brand when the campaign name contains "brand" or any brand term (case-insensitive), else non-brand.

Print the mapping and the count per group. When the taxonomy is missing, say the groups were inferred, and that the user should confirm them before acting on group-level drift.

## Step 3: Actual allocation against the plan and the rules

Use Python to sum `cost`, conversions and conversion value per `(customer_id, group)` over the 30 days, then:

- `share_pct = group_cost / account_cost * 100`.
- **Against the plan** (only when `strategy` is `allocation` or `hybrid`, and only for the dimensions the plan allocates): map each plan row (for example "Search 60%", "PMax 30%") to the groups it covers, sum the actual shares of those groups, and compute `drift_pp = actual_share - plan_share`. When the plan's channel table includes non-Google channels, rescale its Google Ads rows to sum to 100% before comparing, and say so. Drift severity: more than 10pp high, 5–10pp medium, under 5pp low. Country allocation is out of scope here (`google-ads-check-geo-targeting` covers it).
- **Against the ceiling** (any strategy with `total_monthly_ceiling`): 30-day spend against the ceiling.
- **Against each rule's monthly cap:** treat 30-day spend as the monthly run rate and compute `overspend_pct = (group_cost - monthly_cap) / monthly_cap * 100`. Over 20% is critical, 10–20% moderate, under 10% low (`references/priority-tiers.md`, budget allocation).

With `strategy: efficiency` there are no shares to drift from: skip the share comparison and go straight to performance.

## Step 4: Performance against target, per group and per campaign

Use Python with primary-action conversions (or `metrics.conversions` when none is configured):

- Per group and per campaign: `cpa = cost / conversions`, `roas = conversions_value / cost`.
- **Benchmark:** the group's target from its rules file. Without one, the benchmark for a campaign is the median CPA (or ROAS) of the campaigns in the same group that have conversions; for a whole group without a target, use the account's blended CPA or ROAS, and say the comparison is relative, not against a business target.
- **Tier** (`references/smart-bidding-mechanics.md`): for CPA, Efficient when `cpa <= benchmark`, Slightly-above when up to 10% over, Inefficient when more than 10% over; for ROAS the same with `roas` under the benchmark. No conversions with spend is Inefficient and is reported as "no conversions", not a CPA.
- **Rule signals:** when the rules file declares scale, reduce and pause signals, evaluate them in Python on the windows they name (recompute the KPI over the last 14 days from query A's daily rows for the 14-day signals). Defaults when a rules file lacks them: scale above 120% of target for 14 days, reduce below 70% of target for 14 days, pause below 50% of target for 30 days with spend above 500.
- **Volume:** flag campaigns below the learning floor, 30 conversions in 30 days for Search and 50 for PMax and Video (`references/learning-phase-thresholds.md`). Their CPA is unstable; tier them, but mark "low volume" and don't move budget on that tier alone. Below 20 conversions a tier is directional (`references/priority-tiers.md`).

## Step 5: Marginal signals on Search and Shopping

Use Python on query D, per `(customer_id, campaign.id)`:

- `spend` = sum of cost; `conversions` = sum (prefer the primary-action count from step 4); `days` = number of rows.
- Mean of each impression share metric across days, times 100 (the metrics arrive as daily fractions; treat missing values as 0). The API reports values below 10% as 0.0999 and above 90% as 0.9001, so treat 9.99% and 90.01% as "below 10" and "above 90".
- `budget_limited` = `'BUDGET_CONSTRAINED'` in `campaign.primary_status_reasons` from query C.

Then build three lists:

- **Throttled by budget:** mean budget-lost IS > 10% on campaigns with `spend >= 100`. These are missing eligible auctions they would otherwise win: the budget is the bottleneck, not bids or Quality Score.
- **Scale headroom:** mean search IS >= 70% AND mean budget-lost IS >= 5% AND conversions >= 5. They win most of the auctions they enter, convert, and are capped on budget: adding budget should buy more conversions at a similar CPA.
- **Losing on rank:** mean rank-lost IS > 20% on campaigns with `spend >= 100`. Never a budget recipient: adding budget to a rank-loss campaign enters more auctions at the same disadvantaged position. The lever is bids or Quality Score (`references/sis-headroom.md`).

Score the throttle severity on Efficient campaigns with the priority tiers: budget-lost IS of 20% or more is critical, 10–20% moderate, under 10% low.

## Step 6: Structure

Use Python:

- **Fragmentation:** from query A, campaigns with `0 < spend_30d < 100`. When there are more than 3, flag it and report their count, their total spend and `fragmented_share = fragmented_spend / total_spend * 100`. Campaigns this small don't give Smart Bidding enough volume to learn. Also compute the share of campaigns below the learning floor from step 4: above 50% is critical, 30–50% moderate, under 30% low. When either is material, recommend consolidating into larger adjacent campaigns (same goal, same audience, same bidding strategy) and point to `google-ads-check-spend-fragmentation`. A small campaign with a real reason (a niche launch test) can stay; keep those few.
- **Concentration** (more than one account): sum query E per account, `share = account_spend / total_spend * 100`. When the top account exceeds 50%, note it at low severity: any change to that account drives the overall numbers, so weight its recommendations with extra care and treat long-tail accounts' metrics as noisier. This is awareness, not something to fix. Only sum spend across accounts that share a currency; otherwise report shares per currency.

## Step 7: Build the reallocation

Use Python to propose moves that keep total spend flat unless the plan ceiling leaves room:

**Recipients** (budget increases). A campaign qualifies only when all three gates in `references/sis-headroom.md` pass: Efficient (step 4), `budget_limited` true, and budget-lost IS >= 10%. Also require conversions >= 5 in the window. Size the increase as `min(20%, SIS band cap)`:

| Mean search IS | Maximum increase |
|---|---|
| >= 90% | 0% (no increase) |
| 85–90% | +5% |
| 70–85% | +10% |
| < 70% | +20% |

Scale-headroom campaigns from step 5 that fail the 10% budget-loss gate go in a "watch" list, not the recommendations.

**Donors** (budget decreases). Campaigns that are Inefficient, not budget-limited (budget-lost IS under 10%, or not Search or Shopping), and above the learning floor; plus groups over their monthly cap or their plan share by more than 10pp. Size a decrease with the group's reduce signal (default -20%). A pause signal is reported as "pause pending review", never as an automatic move.

**Balance.** Sum the daily-budget increases; fund them from the donors in order of how far they are over benchmark, until the increases are covered or the donors run out. If the media plan ceiling has room, the remainder can come from it; say which.

**Projected impact**, per move and in total, stated as a linear estimate at today's efficiency: `delta_conversions_per_month = delta_daily_budget * 30 / cpa` (or `delta_value = delta_daily_budget * 30 * roas`), positive for recipients and negative for donors, then net. Marginal CPA rises as a campaign scales, so present the recipients' gain as an upper bound.

**Shared budgets:** when `explicitly_shared` is true, recommend the change on the shared budget (`campaign_budget.id`) and name every campaign on it.

**Test window:** recommend applying increases in one step of the sized amount, then reassessing after 7–14 days before the next step (`references/smart-bidding-mechanics.md`). If CPA stays flat as spend rises, keep going; if it climbs sharply, that is the demand ceiling.

## Interpretation rules

- **Severity** follows `references/priority-tiers.md` (critical → `high`, moderate → `medium`, low → `low`): plan drift by the pp bands in step 3; overspend against cap over 20% high; Efficient campaigns losing 20%+ to budget high; more than half the campaigns below the learning floor high; concentration always low.
- Sort by severity, then spend.
- Never recommend a budget increase on an Inefficient campaign, a rank-limited campaign, or one in its learning window after a bid strategy change.
- Respect memory: deliberate allocations stay out of the recommendations and are listed as "acknowledged" in the per-account summary.
- Don't move budget across currencies or accounts; reallocation is within an account.
- With inferred groups (no taxonomy) or relative benchmarks (no rules), keep the recommendations but say which ones rest on inferences.

## Output

One finding: `category: budget`, `kind: optimization`.

**Wrap-up example:** *"Non-brand Search takes 52% of spend against a 40% plan share at a CPA 34% over target, while Brand FR is Efficient and loses 24% of impressions to budget; moving €60/day from 2 non-brand campaigns to Brand FR and Shopping FR projects about +38 conversions a month at current CPA."*

**General improvements**, for example:
- "No rules file for shopping: performance tiers for 4 Shopping campaigns are relative to the group median, not a target."
- "7 campaigns spent under 100 in 30 days (3% of spend); consolidate into their adjacent group campaigns."
- "Acme FR takes 71% of spend across 3 accounts; changes there move the overall numbers."

**Recommendations:**

| account | campaign_or_shared_budget | group | current_daily_budget | proposed_daily_budget | change | reason | projected_monthly_impact |
|---|---|---|---|---|---|---|---|
| Acme FR | Brand FR | brand | €100 | €110 | +10% | Efficient (CPA €12 vs €18 target), budget-limited, 24% IS lost to budget, search IS 78% (cap +10%) | +25 conversions (upper bound) |
| Acme FR | Non-Brand Generic FR | non-brand | €150 | €120 | -20% | Inefficient (CPA €67 vs €50 target over 14 days), 2% IS lost to budget | -13 conversions |

**Details:**

*Allocation by group*

| account | group | spend_30d | share | plan_share | drift_pp | monthly_cap | overspend_pct | kpi | actual | target_or_benchmark | tier | conversions | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

*Marginal signals per campaign*

| account | campaign | group | spend_30d | conversions | kpi_vs_benchmark | tier | search_is | budget_lost_is | rank_lost_is | budget_limited | list | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

`list` is `recipient`, `donor`, `scale-headroom (watch)`, `rank-limited`, `low volume`, or empty.

*Structure*

| account | metric | value | threshold | severity |
|---|---|---|---|---|

**Pending example**
- title: *Non-brand 12pp over its plan share at 34% above target CPA; brand budget-limited*
- summary: *Brand FR Efficient and losing 24% of impressions to budget; 2 non-brand campaigns Inefficient with budget to spare. A €60/day shift projects about +38 conversions a month at current CPA. 7 campaigns under 100 in 30 days.*

**OK example**
- title: *Allocation within plan and targets across 5 groups*
- summary: *Group shares within 4pp of the Q2 plan, every group within 10% of its target CPA, no Efficient campaign losing more than 10% of impressions to budget, 2 campaigns under the 100 spend floor.*
- The body lists the groups and mapping source, the plan and rules compared against, and why each check passed.

## Workspace writes (when the user confirms)

- The user confirms a deliberate allocation ("brand stays at 20% whatever its ROAS") → write a memory file under `ads/google/memory/` with the group, the allocation and the reason, and add a line to `MEMORY.md`.
- The user agrees the plan shares or rule caps are out of date → propose the new values in the finding and point to `google-ads-create-media-plan` or `google-ads-create-channel-rules` in update mode; don't rewrite `media-plan.md` or `rules/` from this skill.
- The user confirms an inferred group mapping → propose adding it to `ads/taxonomy.md`.

## Evidence rule

Every recommendation cites the group or campaign, its spend, its KPI against target, the marginal signal and the rule that sizes the move:

> *"Brand FR (Acme FR): €3,000 spent in 30 days, 250 conversions, CPA €12 against an €18 target (Efficient). Budget-limited, 24% of impressions lost to budget, search IS 78%. Passes all three gates; SIS 70–85% caps the increase at +10%: €100 → €110/day, about +25 conversions a month at current CPA (upper bound)."*

> *"Non-brand group: 52% of 30-day spend against 40% in ads/media-plan.md (+12pp, over the 10pp high threshold)."*
