---
name: google-ads-plan-tests
description: Build and maintain the Google Ads testing plan in ads/google/strategy/test-plan.md - a hypothesis backlog scored with ICE in Python across ad copy and RSA asset, landing page, bid strategy and target, match type and structure, audience and budget tests, and for each test the method (campaign experiment with a traffic split, ad variations, sequential before and after with a control, or a geo holdout), primary metric, guardrails, minimum detectable effect, sample size and duration computed from the account's own baseline volume and variance, and stop rules. Use when the user asks what to test in Google Ads, how long a test needs to run, whether a test is worth running, to set up an A/B test or experiment, or to plan or reprioritise the test backlog. To read out a running or finished test use google-ads-read-test-results; for geo holdout design use google-ads-measure-incrementality; for the wider 30-day plan use google-ads-approve-growth-plan.
---

# Plan tests

> Turn ideas and findings into a ranked, pre-registered Google Ads test plan where every test has a method, one primary metric, guardrails, and a duration the account's own volume can support.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Feasibility gates use `references/learning-phase-thresholds.md` and `references/smart-bidding-mechanics.md`; eligibility and budget step sizes use `references/stability-windowing.md`.

## Goal

Produce (or update) `ads/google/strategy/test-plan.md`: a backlog of hypotheses ranked by ICE, and for every test that is ready to run, a test card that fixes the design before the test starts. The plan answers four questions per idea: is it worth testing, how do we test it, can this account detect the effect we care about, and how long does it take. A test the account can't power is parked with what would make it feasible, never scheduled anyway.

## Scope

**Test families covered:**

| Family | Typical hypotheses | Default method |
|---|---|---|
| Ad copy and RSA assets | New headline angle, pinned vs unpinned, offer in headline 1, a new RSA replacing the weakest | Ad variations (Search) or a campaign experiment |
| Landing page | New page vs current, shorter form, category page vs product page | Campaign experiment with a different final URL, or ad variations with a final URL change |
| Bid strategy and targets | Maximize Conversions to Target CPA, Target CPA to Target ROAS, target tightened or loosened 10% | Campaign experiment |
| Match type and structure | Broad match with Smart Bidding vs phrase and exact, ad group consolidation, campaign merge | Campaign experiment for match type; sequential with a control for merges and splits |
| Audience | Observation to targeting, Customer Match exclusion on prospecting, adding audience segments | Campaign experiment |
| Budget | Budget raised on a budget-limited campaign, budget moved between campaign groups | Sequential with a control, or a geo holdout or scale-up for incremental return |
| Channel incrementality | Is brand Search, PMax or YouTube incremental at all | Geo holdout via `google-ads-measure-incrementality` |

This skill plans. It does not create experiments: the user sets them up in Google Ads (Experiments page or Ad variations), and `google-ads-read-test-results` reads them out.

## Inputs you need

1. **Business context:** `wiki/company.md` (what a conversion is worth, seasonality, sales cycle length for conversion lag).
2. **Media plan:** `ads/media-plan.md` for flights and promotions a test window must avoid.
3. **Rules:** `ads/google/rules/*.md` for each group's KPI and target; they set guardrail tolerances.
4. **Primary conversion action and brand terms:** `ads/google/index.md`.
5. **Memory:** `ads/google/memory/MEMORY.md`; ideas the user has ruled out stay out.
6. **Idea sources:**
   - `ads/google/growth-plan.md`, its test backlog (from `google-ads-approve-growth-plan`).
   - Pending findings in `ads/google/findings/` from the last 30 days, especially from `google-ads-audit-ad-relevance`, `google-ads-audit-match-type-strategy`, `google-ads-audit-audience-strategy`, `google-ads-check-spend-fragmentation`, `google-ads-budget-allocation`, `google-ads-find-scale-candidates` and `google-ads-find-new-opportunities` (its "suggested first test").
   - Health-check results in `ads/google/health/` for `ad-strength-rsa`, `ad-rotation-mode`, `lp-conv-rate-outlier`, `smart-bidding-readiness`, `smart-bidding-cold-start`, `match-type-strategy`, `audience-targeting-mode` and `scale-headroom`.
   - Ideas the user brings.
7. **Existing plan:** `ads/google/strategy/test-plan.md` and any `ads/analyses/incrementality-*.md`.
8. **Live data:** the queries below, per account in scope. The baseline window is the 8 complete weeks (56 days) ending on the last Sunday before today, so every weekday appears 8 times.

## Modes

### Mode A: Bootstrap (no test plan exists)

Collect ideas from the sources above, turn each into a hypothesis, pull baselines, score, size, and propose the plan file. Ask the user for the business inputs the data can't give: the smallest lift worth acting on per test, and the maximum duration they will accept (default 8 weeks).

### Mode B: Import (the user keeps a test log elsewhere)

The user pastes or uploads a spreadsheet or doc. Load tabular input into pandas, map each row to the card fields below, and ask about gaps ("Test 4 has no primary metric: was it CVR or conversions?"). Past tests with results go into the Learnings table; live ones become `running` cards with whatever pre-registration exists, and missing fields are marked `not pre-registered`.

### Mode C: Update (plan exists)

Read the plan, then: add new hypotheses, re-pull baselines for anything not sized in the last 30 days, re-score, move finished tests (results written by `google-ads-read-test-results`) to Learnings, unblock tests whose blocker finished, and re-check that ready tests are still feasible. Never edit the design of a `running` card: changes go into the Amendments log with a date and reason.

## Step 1: Write each idea as a testable hypothesis

Every backlog item takes this shape:

> If we **<one change>** in **<scope>**, then **<primary metric>** will **<direction>** by at least **<smallest lift worth acting on>**, because **<evidence>**.

Rules:

- **One change, one primary metric.** A test that changes copy and landing page together, or that "improves CTR and CPA", is two tests. Pick the metric the change is meant to move; everything else is a guardrail or descriptive. A hypothesis that can't name one primary metric doesn't enter the backlog.
- **One motion per test.** Don't pool brand and non-brand, or prospecting and retargeting, in one test scope: they answer to different metrics.
- **Evidence is cited.** Name the finding file, health check ID or user statement, with its numbers. An idea with no evidence still enters the backlog, with low confidence.
- **Primary metric by family** (defaults; the user can override):

| Family | Primary metric | Unit of analysis |
|---|---|---|
| Ad copy, RSA assets | CTR (when the goal is traffic) or conversions per impression (when the goal is conversions) | impressions |
| Landing page | CVR (primary conversions / clicks) | clicks |
| Bid strategy and targets | Primary conversions per arm (CPA-led groups) or conversion value per arm (ROAS-led groups), with cost as a guardrail | arm-days |
| Match type, audience | Primary conversions or value per arm, CPA or ROAS as guardrail | arm-days |
| Structure, budget (sequential) | Primary conversions or value, treatment vs control ratio | weeks |
| Channel incrementality | Incremental conversions from the business's source of truth | geo-weeks |

Conversions per impression (not CVR) is the right primary for copy tests aimed at conversions: copy changes who clicks, so CVR compares two different click populations.

## Step 2: Choose the method

Use this decision order:

1. **Is the question whether a channel or campaign group drives conversions at all, or what a budget level returns incrementally?** → geo holdout or geo scale-up. Hand the design to `google-ads-measure-incrementality` and record the result here as a card that links to `ads/analyses/incrementality-<slug>.md`.
2. **Can the change be applied to a copy of the campaign while traffic is split?** (bid strategy, target, match type, audience, landing page, ad copy, assets) → **campaign experiment** (Google Ads Experiments, custom experiment). Default split 50/50: it's the fastest to power. Use a smaller treatment share (20–30%) only for risky bid tests, and show the extra duration it costs (Step 5). Prefer a cookie-based split for copy and landing page tests so a returning user sees one version; a search-based split reaches significance faster where repeat exposure doesn't matter (bidding tests). Turn experiment sync off only if both arms must stay frozen; with sync on, edits to the base campaign carry into the trial.
3. **Is it a text or final URL change across many Search campaigns at once?** → **ad variations** (Search only; it splits traffic between original and varied ads).
4. **Can it not be traffic-split?** (budget levels, campaign merges and splits, account restructures, pausing a campaign) → **sequential before and after with a control**: pick control campaigns that don't receive the change and share the treatment's seasonality (same market and channel type, different theme), and compare the treatment-to-control ratio before and after (difference in differences). A before and after comparison without a control is not a test: it measures seasonality as much as the change.

Methods to refuse, with the reason in the plan:

- **Two RSAs in one ad group on Optimize rotation as an A/B test.** The bidder serves the predicted winner, so impressions and query mix differ by design; the comparison is biased. `ad-rotation-mode` keeps Rotate indefinitely for deliberate tests, but Experiments or ad variations are the better vehicle.
- **Reading asset performance labels (Best, Good, Low) as test results.** They describe serving, with no control and no interval. Use them to pick which assets to test, not to call a winner.
- **Testing "more budget" inside a campaign experiment.** Arms split the base campaign's budget by the traffic share, so the experiment can't give one arm more money. Use sequential with a control or a geo scale-up.

## Step 3: Pull baselines

Run per account in scope over the baseline window. Select `segments.date` so day-level variance can be computed.

**Query A: daily campaign metrics**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  campaign.bidding_strategy_type,
  campaign.experiment_type,
  campaign_budget.amount_micros,
  segments.date,
  segments.day_of_week,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<baseline start>' AND '<baseline end>'
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
  AND segments.date BETWEEN '<baseline start>' AND '<baseline end>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

**Query C: ad-level baseline** (copy, asset and landing page tests only)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  ad_group.ad_rotation_mode,
  ad_group_ad.ad.id,
  ad_group_ad.ad.type,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad_strength,
  segments.date,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<baseline start>' AND '<baseline end>'
```

**Query D: experiments already set up or running** (to avoid overlapping tests)

```sql
SELECT
  customer.descriptive_name,
  experiment.resource_name,
  experiment.name,
  experiment.type,
  experiment.status,
  experiment.start_date,
  experiment.end_date
FROM experiment
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

Drop experiments with `status = 'REMOVED'` in Python. If the `experiment` resources return an error on the connected MCP, confirm the field names with `get_resource_metadata` and, failing that, ask the user which experiments are live.

**Query E: recent bid strategy changes** (learning-phase check, the same query as health check `bid-strategy-churn`; `change_event` needs a range within the last 30 days and `LIMIT` of 10000 or less)

~~~sql
SELECT
  customer.descriptive_name,
  change_event.change_date_time,
  change_event.changed_fields,
  campaign.id,
  campaign.name
FROM change_event
WHERE change_event.change_date_time >= '<today minus 29 days> 00:00:00'
  AND change_event.change_date_time <= '<today> 23:59:59'
  AND change_event.change_resource_type = 'CAMPAIGN'
ORDER BY change_event.change_date_time DESC
LIMIT 1000
~~~

Use Python to keep rows whose lower-cased `changed_fields` contains `bidding_strategy`, `target_cpa`, `target_roas`, `maximize_conversions` or `maximize_conversion_value`, and take the latest change per `(customer_id, campaign.id)`.

**Conversion lag.** For the read date (Step 5), pull the primary action's lag distribution over the last 90 days:

```sql
SELECT
  campaign.id,
  segments.conversion_lag_bucket,
  segments.conversion_action_name,
  metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

Confirm `segments.conversion_lag_bucket` with `get_resource_metadata` before running. If it isn't available, use the sales cycle from `wiki/company.md` or ask the user.

## Step 4: Feasibility gates

Use Python to evaluate every hypothesis against these gates before sizing. A failed gate parks the test with its reason.

1. **Tracking first.** Any pending `category: tracking` finding, or a failing `conversions-flowing`, `primary-event-quality` or `conv-rate-fluctuation` check on the test scope, blocks every test in that scope. A test measured on a broken conversion action measures the break.
2. **Eligibility.** Apply the four gates in `references/stability-windowing.md` (at least 7 active days of the last 30, spend in the last 7 days, no relaunch cooldown, CV14 below 0.20) to each campaign in scope.
3. **Learning floor for bid, match type and audience tests.** The treatment arm must clear the floor in `references/learning-phase-thresholds.md` on its own share of traffic: `baseline_conversions_30d × treatment_share ≥ 30` for Search, `≥ 50` for PMax and Video. Below it, the trial arm won't leave learning inside the test. Fix volume first (consolidate, via `google-ads-check-spend-fragmentation`), raise the treatment share, or pick a higher-volume proxy metric and say so.
4. **No recent strategy churn.** A campaign with a bid strategy change in the last 14 days (query E) isn't at steady state; schedule its test after the change settles (`references/smart-bidding-mechanics.md`, test window 7–14 days).
5. **No overlap.** One live test per campaign. A hypothesis whose scope shares a campaign with a live experiment (query D) or a `running` card is `blocked by <id>`.
6. **Calendar.** The planned window (burn-in through read date) must not cross a flight or promotion in `ads/media-plan.md` or a seasonal peak in `wiki/company.md`, unless the hypothesis is about that period.
7. **Bid target size.** Target changes follow the 5–10% step in `references/smart-bidding-mechanics.md` (10–15% for low-volume inefficient campaigns). A Target CPA test starts from the observed 30-day CPA, not an aspirational target.

## Step 5: Size each test in Python

Use Python for every number below; set `alpha = 0.05` (two-sided) and `power = 0.8` unless the plan's frontmatter says otherwise, and `z = scipy.stats.norm.ppf(1 - alpha/2) + scipy.stats.norm.ppf(power)`. Let `s` be the treatment traffic share and `k = s / (1 - s)`.

**Baseline per scope.** From queries A and B (joined on `customer_id`, `campaign.id`, `segments.date`), sum per `(customer_id, date)` over the campaigns in scope: impressions, clicks, cost (`cost_micros / 1e6`), primary conversions and value. Print mean daily impressions, clicks, conversions and value, and the baseline rates computed from the 56-day sums (CTR = clicks / impressions, CVR = conversions / clicks, CPA = cost / conversions, ROAS = value / cost).

**Overdispersion.** Daily data is noisier than a coin-flip model assumes; measure it rather than ignore it.

- For proportion metrics: Pearson dispersion `phi = sum((x_d - n_d * p)**2 / (n_d * p * (1 - p))) / (D - 1)` over the D baseline days, where `x_d` is successes (clicks or conversions), `n_d` trials (impressions or clicks) and `p` the pooled rate.
- For count metrics: remove day-of-week means (`resid = conv_d - conv.groupby(day_of_week).transform('mean')`), then `phi = resid.var(ddof=1) / conv.mean()`.
- Use `phi = max(1, phi)` and print it.

**A. Proportion primary (CTR, CVR, conversions per impression).** With `p_c` the baseline rate and `p_t = p_c * (1 + mde)`:

```python
from statsmodels.stats.proportion import proportion_effectsize
from statsmodels.stats.power import NormalIndPower
h = proportion_effectsize(p_t, p_c)
n_t = NormalIndPower().solve_power(effect_size=h, alpha=alpha, power=power,
                                   ratio=(1 - s) / s, alternative="two-sided")
n_t, n_c = n_t * phi, n_t * (1 - s) / s * phi   # units: impressions or clicks per arm
days = max(n_t / (s * daily_units), n_c / ((1 - s) * daily_units))
```

**B. Count or value primary (conversions, conversion value, CPA or ROAS at budget-controlled cost).** The test compares arm totals on the log scale, `Var(log ratio) ≈ phi * (1/C_t + 1/C_c)`. Required control-arm conversions:

```python
C_c = phi * (1 + 1 / k) * z**2 / np.log(1 + mde)**2
days = C_c / ((1 - s) * mean_daily_conversions)
```

For value and ROAS, multiply `phi` by `(1 + cv_value**2)`, where `cv_value` is the coefficient of variation of value per conversion. Get it from the user's order data when possible; otherwise assume 1.0, say so, and print the duration at 0.5 and 1.5 as a sensitivity. For CPA, arm cost is set by the split budget, so `Var(log CPA) ≈ Var(log conversions)` and formula B applies; if the arms can spend differently (Target ROAS vs Maximize Conversion Value), keep cost as a guardrail.

**C. Sequential with a control.** Build weekly series for treatment and control scope over at least 8 baseline weeks; `r_w = log(treatment_w / control_w)`; `sigma = r_w.std(ddof=1)`; `rho` = lag-1 autocorrelation of `r_w`. Required weeks in each of the pre and post periods:

```python
inflate = max(1, (1 + rho) / (1 - rho))
weeks = 2 * sigma**2 * z**2 / np.log(1 + mde)**2 * inflate
```

If `weeks` exceeds the available pre-period, the test is underpowered at that MDE.

**D. Geo holdout.** Sized by simulation in `google-ads-measure-incrementality`; copy its duration and MDE into the card.

**Duration rules.** Round `days` up to whole weeks (`7 * ceil(days / 7)`), minimum 14 days (two full weekly cycles). Add a burn-in that is excluded from the read for bid strategy, target, match type and audience tests: 7 days when the treatment arm clears twice the learning floor, 14 days otherwise. The read date is the end date plus the primary action's 90th-percentile conversion lag (from the lag query: the first bucket where cumulative conversions reach 90%), so late conversions land before the call.

**MDE table.** The user usually doesn't know the MDE they need, so show what the account can detect. For each hypothesis, invert the formula for 2, 4, 6 and 8 weeks of analysis window:

- A: solve `NormalIndPower().solve_power(effect_size=None, nobs1=n_t_available / phi, ...)` for `h`, then `p_t = np.sin((h + 2 * np.arcsin(np.sqrt(p_c))) / 2)**2` and `mde = p_t / p_c - 1`.
- B: `mde = np.exp(z * np.sqrt(phi * (1 + 1 / k) / C_c_available)) - 1`.
- C: `mde = np.exp(z * sigma * np.sqrt(2 * inflate / weeks)) - 1`.

Print one row per hypothesis: baseline rate or daily volume, phi, MDE at 2/4/6/8 weeks, and the weeks needed for the user's smallest-worthwhile lift. A hypothesis whose smallest-worthwhile lift isn't detectable within `max_duration_weeks` (default 8) is **underpowered**: park it and list what would fix it (widen scope to more campaigns, 50/50 instead of 30/70, a higher-volume metric such as CTR before CVR, or a larger change).

## Step 6: Score with ICE in Python

Score every hypothesis that passed or is only blocked (parked tests are scored too, so they can be revived):

- **Impact (1–10)** from the share of the account's 30-day primary conversions (or value, for ROAS-led groups) at stake: `at_stake = scope_monthly_conversions × expected_lift`, where `expected_lift` is the evidence's estimate if it gives one, otherwise the user's smallest-worthwhile lift. `share = at_stake / account_monthly_conversions`. Bands: ≥ 10% → 10, 5–10% → 8, 2–5% → 6, 1–2% → 4, 0.5–1% → 2, below 0.5% → 1.
- **Confidence (1–10)** from the evidence: 9 = repeats a test that won elsewhere in this account; 7 = a pending finding or failing health check in this scope with numbers past its threshold; 5 = a pattern in this account's data with no threshold crossed; 3 = practitioner idea or user hunch. Cap at 2 when the test is underpowered.
- **Ease (1–10):** start from the method (ad variations 9, campaign experiment 7, sequential with a control 5, geo holdout 3); subtract 2 when new creative or a new landing page must be produced, 2 when another team must act (developers, legal), and 1 for every full 2 weeks of planned duration (burn-in included) beyond 4. Floor at 1.
- **ICE = (I + C + E) / 3**, one decimal. Sort by ICE descending, then by planned duration ascending.

Then schedule in Python: walk the sorted list and assign each ready test the earliest start date at which no earlier-ranked test occupies any of its campaigns and its blockers are done. Print the ranked table with I, C, E, ICE, MDE at 4 weeks, planned duration, start date and blocker.

## Step 7: Write the test card

For each test with status `ready`, write the pre-registration. It fixes, before launch:

- **Primary metric and decision rule:** for example "ship the treatment if the 95% interval for the conversion ratio excludes 0 in the favourable direction and no guardrail is breached".
- **Guardrails with tolerances.** Defaults: CPA no worse than +15% (or ROAS no worse than −15%) of control at the point estimate, taken from the group's rules file when it declares a tolerance; arm spend share within 10 percentage points of the planned split (for tests that don't change bids); brand impression share down no more than 5 points on brand scopes; primary conversions down no more than 20% for copy and landing page tests. Name each guardrail's metric and threshold.
- **Stop rules.**
  - Fixed horizon: don't call a winner before the planned end, even if the interval already excludes zero. Interim reads only check guardrails and validity.
  - Stop early for harm: once at least 30% of the planned sample is in, stop when a guardrail breach is in the 95% interval (the whole interval is past the tolerance), or when treatment CPA exceeds 1.5× control at the point estimate for 7 consecutive days.
  - Stop for validity: tracking break (`google-ads-fluctuation-detection` fires on the scope), either arm stops serving for 2 or more days, someone edits an arm mid-test, or an external shock (outage, PR event, competitor launch) the user confirms.
  - Extend once, by up to 50% of the planned duration, when realised volume runs below plan; after that, the result is what it is.
- **Schedule:** start date, burn-in end, analysis window, planned end, read date.
- **Setup steps for the user:** where to create it (Experiments → custom experiment, or Ads → Ad variations), split, split type, sync setting, the exact change, and the naming suffix so `google-ads-read-test-results` can find the trial campaign (for example `[EXP T-004]`).

## Interpretation and severity

- **Priority of the plan's actions:** `high` when a test is blocked by a tracking problem or a live test violates a stop rule; `medium` for a ready test with ICE ≥ 6 that hasn't started; `low` for backlog grooming and parked tests.
- A plan where every idea is underpowered is a real result: say the account doesn't have the volume to A/B test those questions, and point at consolidation or larger, bolder changes.
- Don't forecast business impact beyond the arithmetic above. Impact scores rank; they aren't promises.

## Output

One finding: `category` = the category of the top-ranked ready test (`creative` for copy, assets and landing pages, `bids` for bid strategy and targets, `keywords` for match type, `structure` for structure and audience, `budget` for budget and incrementality), `kind: recommendation`.

**Wrap-up example:** *"Ten hypotheses scored; four are ready and powered within 6 weeks. Start with T-004, Target CPA at the observed €42 vs Maximize Conversions on Non-Brand Generic FR and BE (ICE 7.0, 6 weeks plus 7 days burn-in to detect +20% conversions). Three copy tests are parked: CVR on their ad groups can only detect lifts above 50% in 8 weeks."*

**Recommendations:** the tests to set up next.

| rank | id | account | test | method | scope | primary_metric | mde | duration | start | ice |
|---|---|---|---|---|---|---|---|---|---|---|

**Details:**

*Sizing per hypothesis*

| account | id | hypothesis | baseline | phi | mde_2w | mde_4w | mde_6w | mde_8w | weeks_for_target_lift | feasible | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|

*Scoring*

| id | impact | confidence | ease | ice | evidence | blocked_by |
|---|---|---|---|---|---|---|

*Parked*

| id | hypothesis | reason | what_would_make_it_feasible |
|---|---|---|---|

**Pending example**
- title: *Four Google Ads tests ready; start with Target CPA on Non-Brand Generic FR*
- summary: *10 hypotheses scored with ICE from 8 weeks of baseline. T-004 detects +20% conversions in 6 weeks plus burn-in at a 50/50 split. Three copy tests parked as underpowered; one landing page test blocked by an open tracking finding.*

**OK example**
- title: *Test plan current; two tests live and on schedule, backlog sized*
- summary: *Re-checked 7 backlog items against fresh baselines: rankings unchanged, both live tests have no overlap, no blocker cleared. Next start T-006 on 2026-06-08.*
- The body says what was re-checked (baselines, gates, overlaps, calendar) and why nothing changes.

## The test plan file

Path: `ads/google/strategy/test-plan.md`. IDs are stable (`T-001`, `T-002`, …) and never reused, so findings and `google-ads-read-test-results` can refer to them.

~~~markdown
---
title: Google Ads test plan
type: test-plan
status: current
updated: 2026-05-04
alpha: 0.05
power: 0.8
max_duration_weeks: 8
---

# Google Ads test plan

> Two tests live, four ready, three parked as underpowered. Next start: T-004 on 2026-05-11.

## Live

| id | test | method | scope | primary metric | start | planned end | read date |
|---|---|---|---|---|---|---|---|

## Backlog (ranked)

| rank | id | hypothesis | family | method | I | C | E | ICE | MDE at 4 weeks | duration | start | blocked by | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

## Parked

| id | hypothesis | why parked | what would make it feasible |
|---|---|---|---|

## Test cards

### T-004 · Target CPA vs Maximize Conversions on Non-Brand Generic FR

- **Status:** ready  <!-- backlog | ready | running | winner | loser | inconclusive | invalid | parked -->
- **Hypothesis:** If we move Non-Brand Generic FR from Maximize Conversions to Target CPA €42 (its observed 30-day CPA), primary conversions will rise by at least 20% at equal spend, because the campaign spends its full budget with CPA 20% above the group median (finding 2026-04-28-google-ads-budget-allocation).
- **Family / method:** bid strategy · campaign experiment, custom, 50/50, search-based split, sync on
- **Scope:** Acme FR · Non-Brand Generic FR
- **Primary metric:** primary conversions (purchase) per arm
- **Guardrails:** CPA no worse than +15% vs control; conversion value no worse than −15% (no spend-share guardrail: the arms bid differently by design)
- **Baseline (2026-03-09 to 2026-05-03):** Non-Brand Generic FR alone 11.2 conversions/day; with BE 30.0 conversions/day, CPA €44.80, phi 1.3
- **Design:** α 0.05 two-sided, power 0.8, MDE +20%, 614 control-arm conversions needed → 110 days for FR alone (parked), 41 days with FR + BE → 6 weeks
- **Schedule:** start 2026-05-11 · burn-in to 2026-05-17 · analysis 2026-05-18 to 2026-06-28 · read 2026-07-03 (90th-percentile lag 5 days)
- **Stop rules:** fixed horizon; harm stop after 30% of sample if CPA interval is entirely above +15%; validity stop on tracking break, arm outage ≥ 2 days, or mid-test edits; one extension of up to 50%
- **Decision rule:** apply the trial if the conversion-ratio interval excludes 0 upward and no guardrail is breached
- **Setup:** Experiments → Create → Custom experiment on Non-Brand Generic FR and BE, suffix `[EXP T-004]`, 50/50, search-based, change only the bid strategy
- **Result:** _written by google-ads-read-test-results_

## Learnings

| date | id | call | lift (95% interval) | learning | applies to |
|---|---|---|---|---|---|

## Amendments

- 2026-05-20 · T-004 · extended analysis window by 7 days after a 2-day serving outage on 2026-05-18/19 (reason recorded before any read of the primary metric)
~~~

Keep cards for finished tests in place with their result; the Learnings table is the summary.

## Workspace writes (when the user confirms)

- The user agrees the plan → write `ads/google/strategy/test-plan.md` (Mode A or B), or the edits to it (Mode C).
- The user starts a test → set its status to `running` and fill the actual start date. From then on the card's hypothesis, metric, MDE, guardrails and decision rule are locked; any change is a dated line in Amendments, written before the next read of the primary metric.
- The user rules an idea out for a reason ("we never discount in ads") → offer a memory file under `ads/google/memory/` and a line in `MEMORY.md`, and remove the idea from the backlog.
- On an unattended run, don't write `test-plan.md`; put the proposed plan or edits in the finding.

## Evidence rule

Every ranked test cites its baseline, the formula inputs and the result:

> *"T-004, Non-Brand Generic FR + BE: 30.0 primary conversions/day over the 56 days to 2026-05-03, phi 1.3. At a 50/50 split, detecting +20% conversions at α 0.05 and power 0.8 needs 614 control-arm conversions: 41 days, rounded to 6 weeks, plus 7 days burn-in (treatment arm at 450 conversions per 30 days, above twice the Search floor of 30). ICE 7.0 (I 8: 6.2% of account conversions at stake; C 7: budget-allocation finding 2026-04-28; E 6: campaign experiment, 7 weeks including burn-in)."*

Parked tests cite the MDE the account can reach: *"T-007, RSA headline test in Ad group 'Hotel Paris': 8,000 clicks in 8 weeks at 2.1% CVR, phi 1.3; detectable CVR lift in 8 weeks is +55%, above the +10% worth acting on. Parked: test at campaign level with ad variations, or test CTR first."*
