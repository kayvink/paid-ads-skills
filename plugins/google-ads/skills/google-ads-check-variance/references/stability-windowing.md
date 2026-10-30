# Stability Windowing

Every skill that evaluates campaign performance needs to decide which time window to use. A 30-day window smooths noise but masks recent shifts. A 7-day window captures recent reality but amplifies daily variance. The wrong choice leads to either stale recommendations (using L30D when spend shifted last week) or noisy ones (using L7D during a normal fluctuation).

Stability windowing uses the Coefficient of Variation (CV) over the last 14 active days to select the right window automatically, and applies eligibility gates to exclude campaigns whose data is too thin or too disrupted to assess.


## Window selection

The CV is calculated over the last 14 active days (days with non-zero spend). It measures relative dispersion — standard deviation divided by mean — which normalises across campaigns with different spend levels.

| CV (14-day) | Selected window | Rationale |
|-------------|----------------|-----------|
| <= 0.15 (15%) | L30D (30-day lookback) | Spend is stable. The 30-day window provides a larger sample with minimal distortion from variance. |
| > 0.15 | L7D (7-day lookback) | Spend is volatile. The 30-day average would be misleading because recent days diverge materially from the period mean. The 7-day window captures the current reality. |

```
Window = (CV14 <= 0.15) ? L30D : L7D
```

When CV14 is missing (fewer than 14 active days), fall back to whatever window the available data supports, and flag the campaign as low-confidence.


## Campaign eligibility gates

Before any performance assessment, a campaign must pass all four gates. If any gate fails, the campaign is ineligible for optimisation and the reason is recorded:

| Gate | Condition | Failure reason |
|------|-----------|---------------|
| Minimum data | ActiveDays30 >= 7 | "Launched too recently (Active X/30)" |
| Not paused | Spend > 0 in last 7 days | "Paused: no spend in last 7 days" |
| Not relaunched | No zero-spend streak >= 5 days ending <= 7 days ago | "Relaunched after X zero days (cooldown)" |
| Not excessively volatile | CV14 < 0.20 OR CV14 missing | "Spend pattern too volatile for reliable assessment" |

The gates are evaluated in priority order. The first failure is the recorded reason — a campaign that is both paused and recently relaunched reports "Paused" because it's the more fundamental issue.

**Relaunch detection:** A campaign that was paused for 5+ consecutive days and then resumed spending within the last 7 days is in relaunch cooldown. Its recent data reflects the re-entry learning phase, not steady-state performance. The 5-day threshold distinguishes genuine pauses from weekend gaps or minor delivery interruptions.

**Paused detection:** No spend in the last 7 days means the campaign is effectively dormant. Including it in benchmarks or recommending changes to it would be misleading.


## Stability reason chain

When a campaign passes eligibility but needs a stability classification for reporting, the following priority chain assigns the reason (first match applies):

1. ActiveDays30 < 7 -> "Launched too recently (Active X/30)"
2. Paused (no spend last 7d) -> "Paused: no spend in last 7 days"
3. Relaunched (zero streak >= 5d, cooldown) -> "Relaunched after X zero days (cooldown)"
4. CV14 >= 0.20 AND |7d vs prior 7d| >= 35% -> "Spend jumped X%" or "Spend dropped X%"
5. Step changes detected (single-day change >= 45%) -> "Step change on [dates]"
6. KPI events < 20 -> "Data sparse (< 20 events)"
7. CV14 > 0.15 -> "Volatile pattern (use L7D)"
8. Else -> "Stable pattern (use L30D)"


## Current Daily Spend (CDS) hierarchy

When a skill needs the campaign's current daily spend rate (for budget change calculations, pacing, or forecasting), use the following priority order:

| Priority | Source | Confidence | Description |
|----------|--------|-----------|-------------|
| 1 | `daily_budget_platform` | High | The platform's stated daily budget (if > 0). Most reliable because it's the actual constraint. |
| 2 | Mean of last <= 7 active days | Medium | Actual spend averaged over recent active days. Cap any single day at 3x the median to dampen outlier days (e.g., end-of-month budget flushes). |
| 3 | `spend_mtd_excl_today / active_days_mtd` | Low | Month-to-date average. Used only when the campaign has insufficient recent daily data. Less reliable because it blends potentially different spending patterns within the month. |


## Budget change step sizes

When recommending budget changes, the step size reflects confidence and risk:

| Step type | Size | When to use |
|-----------|------|-------------|
| Default | +/- 10% | Standard single-period change. Large enough to produce a measurable effect, small enough to avoid destabilising the campaign. |
| Weekly cap | +/- 30% | Maximum total change within a single week. Prevents compounding aggressive moves across multiple daily adjustments. |
| Hard cap | +/- 50% | Absolute maximum per change. Reserved for clear, strongly justified cases (e.g., seasonal launch, new product push). Rare. |
| Low-confidence / new campaigns | Half the standard step | When CDS confidence is Low or the campaign has < 14 active days, halve all step sizes (e.g., +/- 5% default, +/- 15% weekly cap). The reduced confidence in baseline data doesn't justify full-sized moves. |


## The exclude-today rule

All stability calculations, spend baselines, and window computations exclude today's data. Today is an incomplete data point — a campaign that has spent 30% of its daily budget by noon looks underspent when compared to complete days. Including it introduces a systematic downward bias in spend averages (the day isn't over) and an upward bias in variance (the incomplete day looks like an outlier).

This rule applies everywhere: CV calculations, CDS derivations, L7D/L30D averages, step-change detection, and KPI event counts.


## Trend windows for extended analysis

When skills assess sustained trends (trailing trends, drift detection), they use layered windows:

| Window | Role |
|--------|------|
| L14D | Short-term signal. A trend visible only here is a "possible anomaly, monitor." |
| L30D | Primary trend window. Data sufficiency baseline for most assessments. |
| L90D | Long-term pattern validation. A trend consistent across L30D and L90D is structural, not seasonal. |

A trend is classified as "sustained" when the direction is consistent in 2+ windows (e.g., CPA rising in both L30D and L90D). A trend visible only in L14D is classified as a possible anomaly requiring monitoring before action.
