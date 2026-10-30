---
name: google-ads-measure-incrementality
description: Design, monitor and analyse geo holdout and geo scale-up incrementality tests for Google Ads and other ad channels - candidate regions from geographic_view and the business's own regional outcomes, matched treatment and control selection with pre-period fit, power analysis by simulation in Python, duration and the exact spend change to make, then spend separation, contamination and guardrail monitoring while live, and a synthetic control or difference-in-differences read with intervals, incremental conversions, iCPA and iROAS, honest about power - written to ads/analyses/incrementality-slug.md. Use when the user asks whether Google Ads, brand search, Performance Max, YouTube or any paid channel is incremental, wants a holdout or lift test, or needs causal numbers to calibrate a media mix model. For in-account A/B tests use google-ads-plan-tests and google-ads-read-test-results.
---

# Measure incrementality

> Measure what a channel causes, not what it gets credited with, by switching it off (or up) in matched regions and comparing against the regions left alone.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The outcome data comes from the business's own records, checked with `references/source-of-truth-cross-check.md`; burn-in for scale-up campaigns uses `references/learning-phase-thresholds.md`.

## Goal

Attribution observes which tracked touches preceded a conversion; it can't say which conversions would have happened anyway. A geo experiment can: withhold or raise spend in a set of regions, keep everything else the same, and measure the difference in outcome against matched control regions. This skill takes the user from question to a pre-registered design, keeps the test valid while it runs, and reads the result with an interval and a plain statement of whether the test had the power to conclude anything. An underpowered or contaminated test is labelled as such, never dressed up as a finding.

## Scope

- **Methods:** geo holdout (ads off in treatment regions, the strongest answer to "is this channel incremental") and geo scale-up (spend raised in treatment regions, the answer to "what would more budget return"). Both use the same design and analysis.
- **Channels:** any channel that can be switched off or scaled by region: Google Ads Search (brand or non-brand), Performance Max, Shopping, YouTube, Demand Gen, and other platforms with regional targeting. The analysis file is cross-channel; Google Ads data comes through the MCP, other platforms' regional spend comes from the user or their own tools.
- **Not here:** traffic-split A/B tests inside one campaign (`google-ads-plan-tests`, `google-ads-read-test-results`).
- **Read-only:** this skill produces the design and the exact changes to make; the user applies them in Google Ads and reverses them at the end.

## Inputs you need

1. **Business context:** `wiki/company.md`: markets, what a conversion is worth, seasonality, sales cycle.
2. **Regional outcomes from the source of truth.** Daily or weekly conversions (and revenue) by region from the order system, CRM or analytics tool, covering at least the pre-period below. The user supplies these as a file (`date, region, conversions, revenue`). Google Ads conversions can't be the outcome of a holdout: in regions where ads are off they are zero by construction. Run the gap check in `references/source-of-truth-cross-check.md` so you know how complete the outcome data is.
3. **Media plan:** `ads/media-plan.md` for flights and promotions to avoid, and other channels' planned activity.
4. **Google Ads settings:** `ads/google/index.md` (accounts, primary conversion action, brand terms) and `ads/google/rules/*.md` (targets).
5. **Memory:** `ads/google/memory/MEMORY.md`.
6. **Existing tests:** `ads/analyses/incrementality-*.md` and `ads/google/strategy/test-plan.md` (regions or campaigns already under test).
7. **Live data:** the queries below, per account in scope.

## Modes

- **Design:** no test exists yet. Steps 1–7.
- **Monitor:** the test is live. Step 8.
- **Analyse:** the test window (and cooldown) has ended. Steps 9–11.
- **Record:** the user has a lift result from a platform's own lift study. Record it in the same file format with `method: platform-native lift (<platform>)`, the platform's point estimate, interval and window, and the platform's stated method. Treat it like any other result in Step 11.

## Design

### Step 1: Frame the question

Agree with the user, in plain language, and write down:

- **What is tested:** the channel or campaigns in scope (for example "all Non-Brand Search in Acme FR", "Brand Search", "PMax + YouTube"), and the platforms involved.
- **Holdout or scale-up.** Holdout for "is it incremental"; scale-up (for example +50% spend) for "what does the next euro return".
- **Outcome KPI:** the business event from the source of truth (orders, qualified leads, revenue), one primary.
- **Hypothesis and expected effect.** Express the expected effect as a share of the treatment regions' outcome. For a holdout: `expected_lift = -(weekly_spend_in_treatment_regions / hypothesised_iCPA) / weekly_outcome_in_treatment_regions`. Bracket `hypothesised_iCPA` between the platform-reported CPA (every attributed conversion incremental, the optimistic end) and a pessimistic value the user accepts (for example twice the reported CPA). Compute both ends in Python; the design must detect the pessimistic end or say that it can't.
- **Constraints:** maximum duration (default 8 weeks of test, plus cooldown), the share of the business the user will hold out (default at most 30% of outcome volume), and dates that are off limits.

### Step 2: Candidate regions

**Query A: spend and attributed conversions by region** (pre-period, at least 8 weeks and ideally 52 so seasonality is visible; select `segments.date` and aggregate to weeks in Python)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  geographic_view.country_criterion_id,
  geographic_view.location_type,
  segments.geo_target_region,
  segments.date,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<pre-period start>' AND '<yesterday>'
```

For US markets, designated market areas are often the better unit: use `segments.geo_target_metro` instead. For small countries, cities or postal areas may be needed (`segments.geo_target_city`, `segments.geo_target_postal_code`). Confirm the segment name with `get_resource_metadata` on `geographic_view` before running; these segments return `geoTargetConstants/<id>` resource names, resolved with:

```sql
SELECT
  geo_target_constant.resource_name,
  geo_target_constant.id,
  geo_target_constant.name,
  geo_target_constant.canonical_name,
  geo_target_constant.country_code,
  geo_target_constant.target_type
FROM geo_target_constant
WHERE geo_target_constant.resource_name IN ('<geoTargetConstants/...>', ...)
```

`geographic_view` returns rows per location type (`LOCATION_OF_PRESENCE`, `AREA_OF_INTEREST`); sum them per region. Rows with no region are traffic Google couldn't place; report their share of spend.

**Query B: how the campaigns in scope target locations** (needed to implement the split)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  campaign.geo_target_type_setting.positive_geo_target_type,
  campaign_criterion.location.geo_target_constant,
  campaign_criterion.negative
FROM campaign_criterion
WHERE campaign_criterion.type = 'LOCATION'
  AND campaign.status = 'ENABLED'
```

Use Python to build the candidate table: map the user's outcome regions to Google Ads geo target constants (by name and country code; list any that don't map and ask the user), then per region compute weekly outcome, weekly Google Ads spend in scope, attributed conversions, the region's share of total outcome and spend, the coefficient of variation of weekly outcome, and the number of zero-outcome weeks.

**Feasibility gates** (defaults the user can change; print each with pass or fail):

- At least 10 usable regions with outcome data. Fewer → geo testing isn't feasible at this grain: try a finer grain, or go to the alternatives in Step 6.
- Pre-period at least 8 weeks and at least 4× the planned test length.
- No region has more than 3 zero-outcome weeks in the pre-period (sparse regions are merged with neighbours or dropped).
- No single region holds more than 25% of outcome: a dominant region (often the capital) stays in control or forms its own stratum, because whichever group gets it is defined by it.
- The channels in scope can be targeted or excluded at this grain on every platform involved.
- Campaigns in scope use Presence targeting, not Presence or Interest (`geo-targeting-type` in the health-check catalog). With Presence or Interest, users outside a holdout region still see ads about it, and users inside it can be reached through interest; plan the switch to Presence, and its start date, before the test.

### Step 3: Matched treatment and control selection

Use Python with a fixed seed (`np.random.default_rng(<seed>)`), and record the seed in the analysis file.

1. **Training and validation split of the pre-period.** The last L weeks of the pre-period (L = planned test length) are validation; everything before is training.
2. **Stratify.** Sort usable regions by mean weekly outcome in training and cut them into blocks of size `b = round(1 / treatment_share)` (default share 0.3, so blocks of 3). Excluded or dominant regions are fixed to control.
3. **Rerandomise.** Draw 2,000 assignments, each picking one region per block for treatment at random. For each, fit the counterfactual model on training weeks and predict validation weeks:
   - **Scaled control (primary):** `beta = sum(y_T_train) / sum(y_C_train)`; `y_T_hat = beta * y_C`, where `y_T` and `y_C` are the summed weekly outcomes of the treatment and control groups.
   - **Synthetic control (cross-check):** non-negative weights per control region from `scipy.optimize.nnls(Y_C_train, y_T_train)`, where `Y_C_train` is the weeks × control-regions matrix. Use it only when the number of control regions is at most half the training weeks; otherwise aggregate controls into strata first, or it will overfit.
   - Score: validation MAPE `mean(abs(y_T_val - y_T_hat_val) / y_T_val)`, validation bias `sum(y_T_val - y_T_hat_val) / sum(y_T_val)`, and training correlation `pearsonr(y_T_train, y_T_hat_train)`.
4. **Pick** the assignment with the lowest validation MAPE among those whose treatment outcome share is within 5 percentage points of the target share. Print its scores next to the median of all 2,000, so the choice is visibly a selection from a distribution.
5. **Match quality gates:** correlation ≥ 0.8 and validation MAPE ≤ 10% is good; MAPE 10–20% is usable but needs a longer test (the power step will show it); above 20% the regions don't move together enough, so try a coarser grain, a higher-volume KPI, or the alternatives in Step 6.

### Step 4: Power by simulation

Simulate the exact analysis on history, with known effects injected, to see what the design can detect.

1. **Placebo windows.** For each candidate length L in {2, 3, 4, 6, 8} weeks, take every window of L consecutive weeks in the pre-period that leaves at least 8 training weeks before it. For each window, fit the counterfactual on the weeks before the window and compute the placebo effect `sum(y_T - y_T_hat)` over the window, as a share of `sum(y_T_hat)`.
2. **Threshold.** The detection threshold for a window is `t_crit * sd` of the other windows' placebo effects (leave one out), with `t_crit = scipy.stats.t.ppf(0.975, n_windows - 2)`.
3. **Inject.** For each window and each effect m in {−30%, −20%, −15%, −10%, −5%, 0, +5%, +10%, +15%, +20%, +30%} (negative for holdouts, positive for scale-ups), multiply `y_T` inside the window by `(1 + m)`, rerun the estimate, and record whether its absolute value exceeds the threshold.
4. **Power table.** `power(m, L)` = share of windows detected. The row at m = 0 is the false positive rate: if it's above 0.10 at α 0.05, the thresholds are too tight for this data: widen them (use the 97.5th percentile of the absolute placebo effects instead of `t_crit * sd`) and rerun.
5. **Choose L:** the shortest length with power ≥ 0.8 at the pessimistic expected effect from Step 1. The design's MDE at that L is the smallest |m| with power ≥ 0.8.

Overlapping windows share weeks, so the power estimate is approximate; say so, and prefer the next longer L when power at the chosen L is between 0.8 and 0.85.

### Step 5: Duration, spend change and schedule

- **Duration:** L weeks of test, starting on a Monday, plus a cooldown (1 week for Search, 2 weeks for YouTube, Demand Gen and other upper-funnel channels) that is read separately for carryover. Add the business's sales-cycle lag to the read date when the KPI is a late-funnel event.
- **Spend change.** From query A, compute each campaign's pre-period weekly spend in treatment regions. For a holdout, `spend_withheld = sum over campaigns of weekly treatment-region spend × L`. For a scale-up, `extra_spend = uplift × weekly treatment-region spend × L`. Print per campaign and in total, in each account's currency.
- **Calendar:** the test plus cooldown avoids flights and promotions in `ads/media-plan.md` and seasonal peaks, unless the question is about that period. Check `ads/analyses/` and the test plan for other tests touching the same regions or campaigns; overlapping tests are a stop.

### Step 6: When geo testing isn't feasible

If the gates in Step 2 or 3 fail, or no L within the maximum duration reaches power at the pessimistic effect, don't produce the design. Say which gate failed and offer, in this order: a larger treatment share (up to 50%), a holdout of a broader scope (all paid search instead of one campaign group), a coarser or finer geo grain, a higher-volume KPI declared as a proxy (leads instead of closed deals), a longer maximum duration, or a platform's own lift study, recorded later with Record mode.

### Step 7: Pre-register

Write the design into the analysis file (template below) with status `design`. The pre-registration fixes: question, scope, method, primary KPI, treatment and control regions with the seed, estimator, interval method, L, cooldown, MDE, expected effect range, guardrails, start date, and the decision rule. Once the test starts, these don't change; any change goes into the Amendments log with a date and a reason, written before the next look at the outcome data.

**Changes for the user to make**, as a table: for each campaign in scope, the current location targets and budget (the pre-change state, kept for the rollback) and the change:

- **Holdout:** add the treatment regions as excluded locations, and reduce the campaign's daily budget by the treatment regions' share of its spend. Without the budget cut, the money moves into control regions and inflates them, which biases the result toward zero.
- **Scale-up:** treatment regions need their own budget: copy the campaign targeting only treatment regions, exclude them from the original, and set the copy's budget to `(1 + uplift) ×` the treatment regions' current spend. The copy starts a learning period, so start it 7–14 days before the test window (`references/learning-phase-thresholds.md`) and keep that burn-in out of the analysis.
- **Other platforms in scope:** the same exclusions or budget changes there. **Other channels not in scope:** no region-specific changes during the test; ask the user to confirm.
- **At the end:** the reverse of every change, from the pre-change state.

## Monitor

### Step 8: Weekly check while live

Run query A from the start date to yesterday for the campaigns in scope, plus where users physically were:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  user_location_view.country_criterion_id,
  user_location_view.targeting_location,
  segments.geo_target_region,
  segments.date,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros
FROM user_location_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<test start>' AND '<yesterday>'
```

Confirm the region segment on `user_location_view` with `get_resource_metadata`. Also run the experiment and `change_event` queries from `google-ads-read-test-results` (Step 1 and query E) on the campaigns in scope.

Use Python to compute and print:

- **Spend separation (holdout):** `leakage = spend in treatment regions since start / (pre-period weekly treatment-region spend × weeks elapsed)`, from both `geographic_view` and `user_location_view`. Below 5%: clean. 5–15%: contamination warning. Above 15%: validity at risk.
- **Spend separation (scale-up):** `realised_uplift = treatment-region spend / expected spend without the test − 1`. Below 80% of the planned uplift: insufficient separation, the test can't detect what it was sized for.
- **Control regions:** weekly control spend against its pre-period average. Outside ±15% means a budget or targeting change spilled into control.
- **Guardrails:** control-region outcome against its own pre-period trend (a drop of more than 20% points at an outage, a tracking break or an external shock; ask the user); new experiments or edits on campaigns in scope; other channels' regional activity (ask); promotions or news the user reports.
- **Progress:** weeks elapsed of L, and whether separation so far supports the planned MDE.

Don't estimate the effect while the test runs: interim effect reads invite stopping on noise. The only reasons to stop early are validity (contamination above 15%, an overlapping test, a confirmed external shock) and business harm the user declares.

Append a dated line to the file's Monitoring log on every check.

## Analyse

### Step 9: Estimate the effect

Load the outcome data through the end of the cooldown and the spend data from query A. Use the estimator pre-registered in Step 7.

1. **Counterfactual:** fit on all pre-period weeks (same model as the design), predict `y_T_hat` for the test weeks and the cooldown weeks.
2. **Effect:** `effect = sum(y_T - y_T_hat)` over the test weeks; `lift = effect / sum(y_T_hat)`. For a holdout, `incremental_conversions = -effect` (the conversions the channel was producing). Same for revenue.
3. **Interval (primary): placebo in time.** Run the same estimator on every L-week window of the pre-period (Step 4, item 1). `sd = std(placebo_effects, ddof=1)`; interval `effect ± scipy.stats.t.ppf(0.975, n_windows - 1) * sd`; p-value = `(1 + count(abs(placebo) >= abs(effect))) / (1 + n_windows)`.
4. **Cross-checks:**
   - **Difference in differences** on the region-week panel: `statsmodels.formula.api.ols("np.log1p(y) ~ C(region) + C(week) + treat_post", data=panel).fit(cov_type="cluster", cov_kwds={"groups": panel["region"]})`; `exp(coef) - 1` is the lift. With fewer than 20 regions per group, clustered standard errors run too narrow: report them, but the placebo interval stays primary.
   - **Synthetic control** (when the design used scaled control, or vice versa).
   - **Placebo in space**, when there are at least 10 control regions: assign treatment to 500 random control subsets of the same size, compute the effect, and report where the real effect falls in that distribution.
   - If the estimators disagree in sign, or their intervals don't overlap, the result is not robust: say so and lean on the primary.
5. **Cooldown:** report the cooldown weeks' effect separately. A holdout effect that persists after ads return points to lagged demand; one that reverses quickly points to conversions that were only delayed.

### Step 10: Incremental cost and return

- **Spend change:** for a holdout, `delta_spend` = the expected spend in treatment regions without the test (pre-period weekly spend × L, adjusted by the control regions' spend trend) minus the realised spend there; for a scale-up, the realised extra spend. Use Google Ads spend from query A plus other platforms' regional spend from the user.
- **iCPA** = `delta_spend / incremental_conversions`; **iROAS** = `incremental_revenue / delta_spend`. Transform the interval endpoints of incremental conversions and revenue (spend is treated as known). When the lower end of incremental conversions is at or below zero, iCPA has no upper bound: report "iCPA at least <value>".
- **Incrementality factor:** expected Google-attributed conversions in treatment regions over the test weeks (pre-period weekly attributed × L, adjusted by the control trend) against measured incremental conversions: `factor = incremental / expected_attributed`, with its interval. A factor of 0.6 means 60% of what Google Ads credits itself with in these campaigns is incremental, so the platform CPA understates the true cost per incremental conversion by `1 / 0.6`. A factor above 1 is possible (the channel drives conversions it isn't credited with); report it as measured.

### Step 11: Realised power and the call

Rerun the Step 4 simulation with the realised test length and, for scale-ups, the realised uplift; report the realised MDE next to the planned one. Then call it:

| Condition | Call |
|---|---|
| Contamination above 15%, insufficient separation, overlapping test, or a confirmed shock in the window | **invalid**: not usable as a measurement; propose a rerun |
| Interval excludes zero | **conclusive**: report the effect, iCPA or iROAS, and factor with intervals |
| Interval includes zero and the realised MDE is at or below the pessimistic expected effect | **no detectable effect above the MDE**: an informative null. "Turning off Brand Search in 30% of regions for 6 weeks changed orders by less than ±4%" is a finding |
| Interval includes zero and the realised MDE is above the expected effect | **inconclusive, underpowered**: the test couldn't have detected the effect it was looking for; say what would have been needed |

When the experiment disagrees with attribution, that's expected and useful: the experiment is the causal measurement, attribution is the in-platform view. Record both.

**Media mix model calibration.** A conclusive or informative-null result can calibrate any media mix model: record it as a calibration point (channel, scope, regions, window, spend change, incremental conversions with interval, iCPA or iROAS with interval, method, validity). Mark its role as `calibrate` (constrain the model's channel response) or `validate` (held back to check the model independently). Inconclusive and invalid results are not calibration points.

## Interpretation and severity

- `high`: a live test with contamination above 15% or control spend outside ±15% (the test is losing validity while it costs money), or a conclusive result showing a channel's incrementality factor below 0.5 on material spend.
- `medium`: a contamination warning (5–15%), a design ready to launch, a conclusive result with a factor between 0.5 and 0.8.
- `low`: a clean monitoring check; an informative null on low spend.

## Output

Each run writes one finding in `ads/google/findings/` (`category: budget`; `kind: recommendation` for Design and Analyse, `kind: audit` for Monitor, or `kind: anomaly` when a monitoring guardrail trips) and creates or updates the analysis file.

**Wrap-up examples:**
- Design: *"Brand Search holdout is feasible: 24 regions, 30% held out, 6 weeks detects a −6% change in orders (power 0.82); the pessimistic expected effect is −8%. €18,400 of spend withheld. Pre-registration ready in ads/analyses/incrementality-brand-search-fr.md."*
- Monitor: *"Week 3 of 6: holdout regions received 2.1% of their expected spend (clean); control spend +4% vs pre-period. No guardrail tripped."*
- Analyse: *"Brand Search in Acme FR is partly incremental: 412 incremental orders over 6 weeks (95% interval 188 to 636), iCPA €45 (€29 to €99) against a platform CPA of €12; incrementality factor 0.27 (0.12 to 0.42)."*

**Recommendations:** for Design, the changes table from Step 7; for Monitor, any fix (budget cut missing, Presence setting); for Analyse, the decision (for example "move €x of Brand Search budget to Non-Brand", "keep YouTube, use iROAS 1.8 as its planning number").

| account | campaign | current | proposed | reason |
|---|---|---|---|---|

**Details:** the candidate-region table, the match quality line (correlation, validation MAPE and bias, selected vs median of 2,000), the power table (rows L, columns m), the separation table (region group, expected spend, realised spend, leakage), and the result table:

| estimate | effect | ci_low | ci_high | method | note |
|---|---|---|---|---|---|

**Pending example**
- title: *Brand Search holdout design for Acme FR: 6 weeks, 30% of regions held out*
- summary: *Detects −6% orders at power 0.82 from 52 weeks of regional history; scaled-control fit MAPE 4.8%. Withholds €18,400. Needs Presence-only targeting on 3 campaigns before 2026-06-01.*

**OK example**
- title: *Brand Search holdout week 3 of 6: clean separation, no guardrail tripped*
- summary: *Treatment regions at 2.1% of expected spend, control spend within +4% of pre-period, no edits or overlapping experiments on the 3 campaigns in scope.*

**Infeasible example**
- title: *Geo holdout not feasible for Acme NL lead generation at current volume*
- summary: *12 provinces, 31 qualified leads a week: the best 8-week design detects only ±38% against an expected −12%. Options: hold out all paid search, use form submissions as the KPI, or record a platform lift study.*

## The analysis file

Path: `ads/analyses/incrementality-<slug>.md` (cross-channel, because lift tests can span platforms). One file per test; never overwrite a finished one, create `-2` for a rerun.

~~~markdown
---
title: Brand Search incrementality, Acme FR
type: incrementality-test
status: design        # design | running | analysed | invalid
method: geo holdout   # geo holdout | geo scale-up | platform-native lift (<platform>)
channels: [google-ads brand search]
regions_unit: region
created: 2026-05-20
updated: 2026-05-20
---

# Brand Search incrementality, Acme FR

> Holdout of Brand Search in 30% of French regions for 6 weeks to measure incremental orders.

## Question
Does Brand Search produce orders that wouldn't happen through organic search? Expected effect −2% to −8% of orders in held-out regions.

## Pre-registration
| field | value |
|---|---|
| scope | Brand FR, Brand FR Shopping (Acme FR) |
| primary KPI | orders from the order system, by shipping region |
| treatment regions | 7 regions, 29% of orders (seed 20260520) |
| control regions | 17 regions |
| estimator | scaled control; interval from placebo in time |
| test window | 2026-06-01 to 2026-07-12 (6 weeks) |
| cooldown | 2026-07-13 to 2026-07-19 |
| MDE | −6% at power 0.82 |
| guardrails | leakage < 15%, control spend within ±15%, no overlapping tests |
| decision rule | interval excludes zero → conclusive; otherwise per the realised-power rule |

## Design
Candidate regions, match quality, power table, spend withheld.

## Changes and rollback
| account | campaign | pre-change state | change at start | change at end |
|---|---|---|---|---|

## Monitoring log
- 2026-06-15 · week 2 · leakage 1.8%, control spend +3%, no edits

## Result
Effect, intervals, cross-checks, cooldown, iCPA or iROAS, incrementality factor, realised MDE, call.

## Calibration record
| channel | scope | window | spend change | incremental conversions (95%) | iCPA or iROAS (95%) | method | role | validity |
|---|---|---|---|---|---|---|---|---|

## Amendments
~~~

If the test sits in `ads/google/strategy/test-plan.md`, its card links to this file and takes its status from it.

## Workspace writes (when the user confirms)

- Design agreed → write the analysis file with status `design`; on the user's start date, set status `running` and lock the pre-registration.
- Each monitoring check → append to the Monitoring log (allowed on unattended runs too: it's a log, not a protected file).
- Analysis agreed → write the Result and Calibration record and set status `analysed` (or `invalid`).
- The user wants the result to steer planning (for example "use iROAS 1.8 for YouTube") → offer a memory file under `ads/google/memory/` and a line in `MEMORY.md`, and suggest updating `ads/google/rules/` through `google-ads-create-channel-rules`.
- On an unattended run, don't create the file or change its status; put the design or result in the finding.

## Evidence rule

Every claim names the regions, window, data source and numbers:

> *"Brand FR holdout, 7 treatment regions (29% of orders), 2026-06-01 to 2026-07-12: actual orders 5,488 vs counterfactual 5,900 from the scaled-control fit on 52 pre-period weeks; effect −412 orders (−7.0%), 95% interval −636 to −188 from 45 placebo windows (p = 0.02). Spend withheld €18,540 (geographic_view, expected minus realised). iCPA €45 (€29 to €99). Google Ads would have credited 1,520 orders in those regions over the window; incrementality factor 0.27 (0.12 to 0.42). Realised MDE ±5.6%: conclusive."*
