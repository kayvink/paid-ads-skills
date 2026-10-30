---
name: google-ads-read-test-results
description: Read out a running or finished Google Ads test - a campaign experiment (treatment and control arms as separate campaigns), an ad variation or ad-level copy test, or a sequential before and after test with a control - by pulling both arms with GAQL and computing in Python the lift with confidence intervals (two-proportion z-test for CVR and CTR, day-level bootstrap or delta method for CPA and ROAS), validity checks (sample ratio, mid-test edits, tracking, novelty and day-of-week balance) and whether the test reached its planned power, then calling it winner, loser, inconclusive or keep running and updating the test's entry in ads/google/strategy/test-plan.md on confirmation. Use when the user asks whether a Google Ads experiment or A/B test won, is significant, can be stopped or should be applied. To design tests use google-ads-plan-tests; for geo holdout analysis use google-ads-measure-incrementality.
---

# Read test results

> Read a Google Ads test against its pre-registration and make an honest call: winner, loser, inconclusive, keep running, or invalid.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Burn-in and learning-phase reasoning use `references/learning-phase-thresholds.md` and `references/smart-bidding-mechanics.md`.

## Goal

For one test (or every `running` test in the plan, when the user asks for a sweep), compute the effect on the pre-registered primary metric with a 95% interval, check that the test was valid and reached the sample it planned for, check every guardrail, and make one call with the evidence behind it. The call is a recommendation; the user applies or ends the experiment in Google Ads.

## Scope

| Test type | Data source | Unit of analysis |
|---|---|---|
| Campaign experiment (custom, bid strategy, match type, audience, landing page) | The control and trial campaigns of the experiment's arms | arm-day |
| Ad variation | The experiment's arms when the API exposes them; otherwise the ad variation report the user exports | arm-day |
| Ad-level copy test (two ads in a Rotate indefinitely ad group) | `ad_group_ad` rows for the two ad IDs | ad-day |
| Sequential with a control | Treatment and control campaign groups, pre and post windows | week |
| Geo holdout or scale-up | Not here: `google-ads-measure-incrementality` analyses it | geo-week |

## Inputs you need

1. **The test card** in `ads/google/strategy/test-plan.md`: primary metric, MDE, α, power, planned sample, split, guardrails with tolerances, burn-in, analysis window, read date, decision rule, stop rules, and the Amendments log. If there's no card, reconstruct what you can from the experiment resources (query A), ask the user for the primary metric before looking at results, and label the read `not pre-registered: exploratory`.
2. **Rules:** `ads/google/rules/<group>.md` for the target the guardrails reference.
3. **Primary conversion action:** `ads/google/index.md`.
4. **Memory:** `ads/google/memory/MEMORY.md` (known outages, promotions).
5. **Media plan:** `ads/media-plan.md` for flights that overlapped the window.
6. **Live data:** the queries below. The analysis window starts the day after burn-in ends and ends on the planned end date or yesterday, whichever is earlier. Always state the window.

## Step 1: Find the arms

**Query A: the experiment and its arms**

```sql
SELECT
  customer.descriptive_name,
  experiment.resource_name,
  experiment.experiment_id,
  experiment.name,
  experiment.type,
  experiment.status,
  experiment.start_date,
  experiment.end_date
FROM experiment
WHERE experiment.status != 'REMOVED'
```

```sql
SELECT
  experiment_arm.experiment,
  experiment_arm.name,
  experiment_arm.control,
  experiment_arm.traffic_split,
  experiment_arm.campaigns
FROM experiment_arm
```

Match the experiment to the card by name or suffix (for example `[EXP T-004]`). `experiment_arm.campaigns` lists campaign resource names (`customers/<id>/campaigns/<campaign_id>`); parse the IDs in Python. The arm with `control = TRUE` is the base campaign; the other holds the trial campaign. Confirm with `campaign.experiment_type` (`BASE` for control, `EXPERIMENT` for the trial) in query B. If the connected MCP rejects these resources, check the fields with `get_resource_metadata`; failing that, ask the user for the trial campaign name.

For an ad-level test, the card names the two ad IDs. For a sequential test, it names the treatment and control campaigns.

## Step 2: Pull both arms

**Query B: daily arm metrics** (campaign experiments, sequential tests)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.experiment_type,
  campaign.bidding_strategy_type,
  segments.date,
  segments.day_of_week,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.id IN (<control_id>, <trial_id>)
  AND segments.date BETWEEN '<test start>' AND '<analysis end>'
```

For a sequential test, use the treatment and control campaign IDs and a date range covering the pre period through the analysis end.

**Query C: primary-action conversions** (skip when no primary action is configured)

```sql
SELECT
  campaign.id,
  segments.date,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.id IN (<control_id>, <trial_id>)
  AND segments.date BETWEEN '<test start>' AND '<analysis end>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

**Query D: ad-level arms** (ad tests)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, ad_group.id, ad_group.name,
  ad_group.ad_rotation_mode,
  ad_group_ad.ad.id,
  segments.date,
  segments.day_of_week,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM ad_group_ad
WHERE ad_group_ad.ad.id IN (<ad_id_a>, <ad_id_b>)
  AND segments.date BETWEEN '<test start>' AND '<analysis end>'
```

Add a primary-action version with `segments.conversion_action_name` as in query C.

**Query E: edits to the arms during the test**

```sql
SELECT
  customer.descriptive_name,
  change_event.change_date_time,
  change_event.change_resource_type,
  change_event.changed_fields,
  change_event.client_type,
  change_event.user_email,
  campaign.id
FROM change_event
WHERE change_event.change_date_time >= '<max(test start, today minus 29 days)> 00:00:00'
  AND change_event.change_date_time <= '<today> 23:59:59'
  AND change_event.change_resource_type IN ('CAMPAIGN', 'CAMPAIGN_BUDGET', 'CAMPAIGN_CRITERION', 'AD_GROUP', 'AD_GROUP_AD', 'AD_GROUP_CRITERION', 'AD_GROUP_BID_MODIFIER')
ORDER BY change_event.change_date_time DESC
LIMIT 10000
```

`change_event` only reaches back 30 days. For tests longer than that, say the earlier part of the window couldn't be checked here, and rely on the Amendments log and the user. Filter to the arm campaigns in Python.

Save every result to disk and load into pandas per conventions section 2. Join query B with query C on `(customer_id, campaign.id, segments.date)`; tag each row with `arm` (`control` or `treatment`) and, for sequential tests, `period` (`pre` or `post`). Drop burn-in days from the analysis frame but keep them for the validity checks.

## Step 3: Validity checks (before looking at the lift)

Run these in Python first and print a pass or fail line for each. A failure makes the call `invalid` or caps it, as noted.

1. **Both arms served every day.** Count days per arm with impressions > 0 in the analysis window. Two or more zero days in either arm → validity stop (card stop rule).
2. **Sample ratio.** For tests whose treatment doesn't change bids or targeting (copy, landing page, ad variations), compare impressions with the planned split: `scipy.stats.chisquare([imp_t, imp_c], f_exp=[total * s, total * (1 - s)])`. p < 0.001 → sample ratio mismatch, call `invalid` (traffic wasn't split as designed, so the arms aren't comparable). For bid, match type and audience tests, impressions and spend legitimately differ: report the observed spend share and impression share per arm instead, without a test.
3. **No mid-test edits.** From query E, any change to either arm inside the analysis window that isn't in the card's Amendments log is a contamination flag. With experiment sync on, base campaign edits reach both arms equally and are a note, not a failure, unless they touch the variable under test. A change by `GOOGLE_ADS_AUTO_APPLY` counts.
4. **Tracking stable.** Flag a run of 3 or more consecutive days with zero primary conversions in either arm when the card's baseline averaged more than 3 a day, and any day where both arms' conversions fall more than 40% below their 7-day median together (`google-ads-fluctuation-detection` uses the same signal). Ask the user whether the primary conversion action's settings changed during the window: query E can't filter on conversion actions.
5. **Whole weeks and day-of-week balance.** Count each weekday in the analysis window. Arms of a campaign experiment run on the same days, so they're balanced by construction; still trim the window to whole weeks (drop the oldest partial week) so the read isn't weighted toward some weekdays. For sequential tests, the pre and post periods must contain the same number of each weekday; trim until they do.
6. **Conversion lag.** If today is before the card's read date, the latest days are missing late conversions. The call can be `keep running` or a harm stop, never `winner`.
7. **Burn-in respected.** For bid strategy and target tests, check that burn-in days were excluded and that the trial arm's 30-day-equivalent conversions (`conversions_in_window / days * 30`) clear the floor in `references/learning-phase-thresholds.md` (30 Search, 50 PMax and Video). Below it, cap the call at `inconclusive` and say the trial arm may still have been learning.

## Step 4: Compute the effect in Python

Sum the additive metrics per arm over the analysis window first; derive ratios from the sums. Let `s` be the planned treatment share. Report every effect as relative lift `treatment / control − 1` with a 95% interval, plus the absolute difference where it reads more naturally.

**Proportion metrics (CTR, CVR, conversions per impression).**

```python
from statsmodels.stats.proportion import proportions_ztest, confint_proportions_2indep
stat, p = proportions_ztest([x_t, x_c], [n_t, n_c])
lo, hi = confint_proportions_2indep(x_t, n_t, x_c, n_c, method="newcomb", compare="diff")
rlo, rhi = confint_proportions_2indep(x_t, n_t, x_c, n_c, method="log", compare="ratio")
```

`x` is clicks (CTR) or conversions (CVR, conversions per impression); `n` is impressions (CTR, conversions per impression) or clicks (CVR). The z-test assumes independent trials; daily data is usually overdispersed. Compute Pearson dispersion `phi` per arm over the analysis days (`sum((x_d - n_d * p)**2 / (n_d * p * (1 - p))) / (D - 1)`). When `phi > 1.5`, also report the day-level bootstrap interval below and use whichever interval is wider for the call.

**Ratio metrics (CPA, ROAS) and volume metrics (conversions, value per arm).** Two methods; report both and use the wider interval.

- **Day-level paired bootstrap.** Arms of a campaign experiment run on the same days, so resample days, not rows: draw `D` day indices with replacement, sum each arm's cost, conversions and value over the drawn days, and compute the lift. 10,000 resamples with `np.random.default_rng(<seed>)`; the 2.5th and 97.5th percentiles are the interval. For CPA, `lift = (cost_t / conv_t) / (cost_c / conv_c) - 1`; for ROAS, `(value_t / cost_t) / (value_c / cost_c) - 1`; for conversions per arm, normalise by traffic share first: `(conv_t / s) / (conv_c / (1 - s)) - 1`.
- **Delta method on the log scale.** For CPA per arm, with day-level sums `X` (cost) and `Y` (conversions) over `D` days: `var_log_cpa = D * (var(X)/sum(X)**2 + var(Y)/sum(Y)**2 - 2*cov(X, Y)/(sum(X)*sum(Y)))`, using `ddof=1` variances of the daily values. Then `se = sqrt(var_t + var_c)` and the interval is `exp(log(cpa_t / cpa_c) ± 1.96 * se) - 1`. ROAS is the same with value over cost. For a conversion count ratio, `se = sqrt(phi_t / conv_t + phi_c / conv_c)` with `phi` from the day-of-week-adjusted residuals (as in `google-ads-plan-tests`).

Guard every ratio: an arm with zero conversions has no CPA; report "no conversions in treatment" and don't compute a lift.

**Sequential with a control.** Per week, `r_w = log(treatment_w / control_w)` on the primary metric. Effect = `mean(r_post) - mean(r_pre)`; `se = sqrt(var(r_pre)/n_pre + var(r_post)/n_post)` (Welch, `scipy.stats.ttest_ind(r_post, r_pre, equal_var=False)` for the p-value); lift = `exp(effect) - 1` with interval `exp(effect ± t_crit * se) - 1`. Inflate `se` by `sqrt((1 + rho) / (1 - rho))` when the lag-1 autocorrelation `rho` of `r_w` in the pre period is above 0.

**More than two arms.** Compare each treatment with control and adjust the p-values with `statsmodels.stats.multitest.multipletests(pvals, method="holm")`. Only Holm-adjusted p-values below α can produce a `winner`.

## Step 5: Daily-level checks

Use Python on the day-level frame:

1. **Novelty or learning drift.** Compute the daily lift on the primary metric (ratio of daily sums, using a 7-day rolling sum to smooth sparse days). Compare the lift in the first half of the analysis window with the second half, and fit `scipy.stats.linregress(day_index, daily_log_lift)`. Flag novelty when the first-half lift is more than twice the second-half lift in the favourable direction, or the slope is significant (p < 0.05) and runs against the overall effect. A novelty-flagged winner becomes `keep running` (if the extension in the stop rules is unused) or is called on the second half only, stated as such.
2. **Day-of-week concentration.** Compute the lift per weekday. Flag when one weekday contributes more than 50% of the total incremental primary metric: the result may be a scheduling artefact (an ad schedule or a promotion day) rather than the change.
3. **Single-day dominance.** Flag when one day contributes more than 25% of the treatment's total primary metric; re-run the effect without that day and report both.

## Step 6: Power and progress

Compare what the test collected with what the card planned:

- `progress = realised_units / planned_units` on the card's unit (control-arm conversions, clicks or impressions, or weeks).
- **Realised MDE** at the realised sample, with the card's α and power and `z = norm.ppf(1 - alpha/2) + norm.ppf(power)`. Print it next to the planned MDE.
  - Proportions: `h = NormalIndPower().solve_power(effect_size=None, nobs1=n_t / phi, alpha=alpha, power=power, ratio=n_c / n_t)`, then `p_t = np.sin((h + 2 * np.arcsin(np.sqrt(p_c))) / 2)**2` and `mde = p_t / p_c - 1`.
  - Counts, CPA, ROAS: `mde = np.exp(z * np.sqrt(phi_c / C_c + phi_t / C_t)) - 1` from the realised arm conversions (times `1 + cv_value**2` inside the root for value and ROAS, as on the card).
  - Sequential: `mde = np.exp(t_crit * se) - 1` with the `se` from Step 4.
- **Days remaining** at the realised daily rate: `(planned_units - realised_units) / realised_units_per_day`, rounded up to whole weeks.

Don't compute power from the observed effect ("observed power"): it's a restatement of the p-value. The questions are whether the planned sample was reached and what effect sizes the interval rules out.

## Step 7: Guardrails

For each guardrail on the card, compute the metric's lift and interval the same way as the primary metric (bootstrap for CPA and ROAS, z-test for rates). A guardrail is **breached** when its point estimate is past the tolerance, and **clearly breached** when its whole 95% interval is past the tolerance. Before the planned end, only a clear breach (with at least 30% of the planned sample in) triggers the harm stop.

## Step 8: Make the call

Apply in this order; the first matching row wins.

| Condition | Call | Recommendation |
|---|---|---|
| A validity check failed (serving gap, sample ratio mismatch, uncommitted mid-test edit to the tested variable, tracking break) | **invalid** | End the experiment, fix the cause, rerun with a fresh card |
| A guardrail is clearly breached with at least 30% of the planned sample in, or treatment CPA above 1.5× control for 7 consecutive days | **loser** (harm stop) | End the experiment; don't apply |
| Before the read date and below 100% of the planned sample | **keep running** | Days remaining; next read date; whether the one allowed extension is still available |
| Primary interval excludes zero in the favourable direction, no guardrail breached, no novelty flag | **winner** | Apply the trial to the base campaign (Experiments → Apply), or roll out the variation |
| Primary interval excludes zero in the unfavourable direction, or a guardrail breached at the point estimate | **loser** | End the experiment; keep the control |
| Planned sample reached (after any extension), interval includes zero | **inconclusive** | State the range ruled out ("lifts above +9% and below −6% are unlikely"); keep the control unless the treatment is cheaper or simpler to run |

Additional rules:

- **Not pre-registered** reads (no card) can be `winner` only if the interval excludes zero by a wide margin (Holm-adjusted across every metric looked at); otherwise call them exploratory and propose a pre-registered rerun.
- **A winner below the planned MDE** (interval excludes zero but the point estimate is under the MDE) is still a winner; say the effect is smaller than the one the test was designed around.
- **Bid strategy winners**: applying the trial converts the base campaign to the new strategy, which triggers a short learning period of its own; say to expect it and to judge the applied campaign after 7–14 days (`references/smart-bidding-mechanics.md`).
- Never call `winner` before the read date, even when the interval excludes zero early. Peeking and stopping on significance inflates false winners.

## Interpretation and severity

- `high`: a harm stop, an invalid test still running and spending, or a winner ready to apply on a high-spend campaign.
- `medium`: a winner or loser on a smaller scope; an inconclusive test at its end date.
- `low`: keep running with no flags.

## Output

One finding: `category` by test family (`creative` for copy, assets and landing pages, `bids` for bid strategy and targets, `keywords` for match type, `structure` for structure and audience, `budget` for budget), `kind: recommendation`.

**Wrap-up example:** *"T-004 is a winner: Target CPA lifted primary conversions by +18% (95% interval +7% to +30%) over 42 days at CPA −11% (−19% to −2%), against a planned MDE of +20% with 102% of its planned sample in. Recommend applying the trial to Non-Brand Generic FR and BE."*

**Recommendations:**

| account | test | call | action | where_in_google_ads | evidence |
|---|---|---|---|---|---|
| Acme FR | T-004 Target CPA vs Maximize Conversions | winner | Apply trial to base campaign | Experiments → T-004 → Apply | +18% conversions (+7% to +30%), CPA −11% |

**Details:**

*Primary and guardrail metrics*

| account | test | metric | role | control | treatment | lift | ci_low | ci_high | p_value | method | breached |
|---|---|---|---|---|---|---|---|---|---|---|---|

*Validity and power*

| test | check | result | detail |
|---|---|---|---|

Rows: serving days, sample ratio, mid-test edits, tracking, whole weeks, conversion lag, burn-in and floor, novelty, weekday concentration, progress vs plan, realised MDE vs planned.

**Pending example**
- title: *T-004 Target CPA beats Maximize Conversions; apply the trial*
- summary: *+18% primary conversions (95% interval +7% to +30%) at CPA −11% over 42 days on Non-Brand Generic FR and BE; planned sample reached, no guardrail breached, no novelty drift.*

**Keep running example**
- title: *T-006 landing page test at 55% of planned sample; next read 2026-06-12*
- summary: *CVR +6% so far (−8% to +22%) on 9,800 of 17,900 planned clicks; no validity or guardrail flags. 3 more weeks at the current click rate.*

**OK example** (sweep with nothing to act on)
- title: *Two live Google Ads tests on track; no stop rule triggered*
- summary: *T-006 and T-007 checked for serving, sample ratio, edits, tracking and guardrails; both below their read dates, so no effect call yet.*

## Workspace writes (when the user confirms)

- **Update the test card** in `ads/google/strategy/test-plan.md`: set `Status` to the call (`winner`, `loser`, `inconclusive`, `invalid`, or leave `running`), and replace the `Result` line with a dated block:

~~~markdown
- **Result (2026-07-03, google-ads-read-test-results):** winner. Analysis window 2026-05-18 to 2026-06-28 (6 whole weeks). Primary conversions: control 627, treatment 740; lift +18% (95% interval +7% to +30%, bootstrap; delta method +8% to +29%). CPA −11% (−19% to −2%). Progress 102% of planned sample (627 of 614 control-arm conversions); realised MDE +19.8% vs planned +20%. Validity: all checks pass; sync on, no edits to the tested variable. Novelty: none (first half +20%, second half +16%). Decision: apply the trial. Finding: findings/2026-07-03-google-ads-read-test-results.md
~~~

- Add a row to the plan's **Learnings** table (date, id, call, lift and interval, one-sentence learning, where else it might apply), move the test out of **Live**, and note in the backlog any test it unblocks.
- A `keep running` read writes only a dated progress line under the card's Result, never a call.
- The user declines to apply a winner for a reason ("brand team won't accept that headline") → offer a memory file under `ads/google/memory/` and a line in `MEMORY.md`.
- On an unattended run, don't edit `test-plan.md`; put the proposed card update in the finding.

## Evidence rule

Every call names the test, window, both arms' sums, the lift with its interval and method, progress against plan, and the rule that produced the call:

> *"T-006, Acme NL, landing page /pricing-v2 vs /pricing: 2026-05-04 to 2026-05-31 (4 whole weeks). CVR 3.12% (412 / 13,205 clicks) vs 2.98% (395 / 13,260); lift +4.7% (95% interval −8.6% to +19.9%, Newcomb log ratio; phi 1.1). Planned sample 26,400 clicks reached; realised MDE +16%. Inconclusive: the interval includes zero at full sample. Lifts above +20% are unlikely; keep /pricing unless /pricing-v2 is preferred for other reasons."*
