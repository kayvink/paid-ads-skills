---
name: google-ads-diagnose-trend-drift
description: Find the confirmed root cause behind a Google Ads account, channel or campaign trending the wrong way (CPA rising, conversion volume or CVR falling over weeks) by localising the drift to a channel, campaigns, market or a measurement artefact, then testing channel-specific causes against the change history with a hypothesis ledger. Use when the user asks why performance is drifting or getting worse, what is behind a CPA rise or conversion drop, or after the google-ads-health-check trend-drift check flags a drift. For sudden day-level spikes use google-ads-check-variance.
---

# Diagnose trend drift

> Why is this account, channel, or campaign trending the wrong way? Confirm where the drift is coming from before guessing why.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. This skill reuses the outputs of the `google-ads-health-check` skill in `ads/google/health/` when they exist and computes what it needs directly when they don't.

## Goal

Turn a trend drift (a `trend-drift` result in `ads/google/health/trend-drift.md`, a finding that reports one, or the user's own question) into a confirmed root cause with evidence. By the time this skill finishes, the finding's `Investigation` table names a single confirmed hypothesis (or a compound one) and the evidence trail that proves it, re-runnable by the next agent or the user.

The method is the hypothesis ledger described below. The hypotheses are supplied by this skill, instantiated for the specific drift under review.

## Scope

Triggered by a trend-drift result from the health check. Re-runnable when the same trend reappears, when a probe was previously deferred, or when the user asks "what's behind this drift?" out of band.

Two entry points to handle:

- **Account-level entry** — the drift came from the account-rollup comparison (CPA up X%, volume down Y% at account level). Localisation is unconfirmed; Stage 1 runs in full.
- **Channel-level entry** — the drift came from the channel-level comparison (e.g. "PMax CPA up 383%"). Localisation is *suggested* by the health check but not confirmed at finer granularity (single campaign? single market? measurement artefact?). Stage 1 still runs, but its hypothesis list is narrower.

## Inputs you need

1. **The trigger:** the finding in `ads/google/findings/` or the user's description, for the symptom, the window, and which comparison fired (account vs channel).
2. **Recent-vs-prior numbers:** `ads/google/health/trend-drift.md` if it is from the last 7 days; otherwise compute them (see "Computing the trend drift" below).
3. **Change history:** `ads/google/health/recent-changes.md` if it is from the last 24 hours and covers the comparison window; otherwise query it (see Setup).
4. **Conversion setup:** `ads/google/health/conversion-action-health.md` if it is from the last 7 days, to feed the measurement-artefact hypothesis; otherwise query `conversion_action` directly (L4).
5. **Campaigns that just stopped serving:** `ads/google/health/campaigns-not-spending.md` if recent.
6. **Adjacent health-check results** cited per hypothesis below, when present: `asset-coverage.md`, `ad-strength-pmax.md`, `bid-strategy-churn.md`, `active-bidding-overrides.md`, `account-negatives.md`, `disapproved-ads.md`, `n-gram-analysis.md`. They cover change types the change history can't filter on directly. When one is missing, use the direct probe given for that hypothesis, or run `google-ads-health-check` for that check.
7. **Brand terms and primary conversion action:** `ads/google/index.md`. Memory: `ads/google/memory/MEMORY.md`.
8. **GAQL probes** for the Stage 1 and Stage 2 hypotheses, listed inline in Method. Run them for each account in scope.

If the change history or the trend numbers can't be obtained at all (query errors on every account), say so before starting; don't proceed on a thin foundation.

## Modes

- **Cold** — no previous diagnosis for this drift. Run both stages start-to-finish.
- **Refresh** — a previous run left hypotheses `deferred`. Re-probe just the deferred ones; keep the rest of the ledger, and append a dated `## Update YYYY-MM-DD` section to the earlier finding.

## The hypothesis ledger

A discipline against jumping to conclusions: enumerate competing causes, design probes that can confirm OR reject each, run them all, write down what you found. The survivor is the cause; the rejected ones are the trail.

1. **Enumerate.** Use the hypotheses listed for each stage. Mark any that can't apply in this run `N/A` with the reason; don't drop it. Don't add hypotheses the stage didn't list, unless a probe surfaces a new cause mid-investigation (for example a change row that fits no listed hypothesis); then add it and probe it.
2. **Probe all of them.** Each probe is falsifiable: it names a result that would prove the hypothesis wrong. Issue independent probes in one batch. Don't walk the list in order and stop at the first match.
3. **Temporal evidence rule — current state is not evidence about past state.** For any hypothesis bounded by a date or window, the probe must show the state at that time. When no dated evidence is available, the probe did not run: mark it `deferred` and name what would unblock it. Before confirming, ask: would this probe still confirm if the state had been different at the time of the symptom? If yes, downgrade to `inconclusive` or `deferred`.
4. **Classify** each hypothesis as exactly one of:
   - **`confirmed`** — the probe supports it and no other probe contradicts it. Two corroborating signals strengthen it; one strong probe with a clean evidence trail is enough.
   - **`rejected`** — the probe directly disconfirms it ("metric stayed flat", "no change recorded").
   - **`inconclusive`** — the probe ran but the result is mixed or can't be separated from a related cause.
   - **`deferred`** — the probe couldn't run (data not available, retention exceeded, external system). Name what would unblock it.
   - **`N/A`** — logically impossible given another probe's result; name which.
5. **Land on the cause.** One confirmed hypothesis is the cause; several confirmed is a compound cause. Zero confirmed with all rejected means the list didn't cover the cause: say so and recommend a deeper manual investigation. Some inconclusive means "narrowed to A or B, here's what would disambiguate".

Every evidence cell cites the numbers from the Python output (with the window) or the workspace file it came from. A claim that can't be cited means the probe didn't really run: mark it `deferred`.

## Computing the trend drift (when no fresh health result exists)

Reproduce the `trend-drift` check. Windows: **recent** = the last 28 days ending yesterday; **prior** = the 28 days before that. Query both windows in one 56-day range.

```sql
-- Account rollup
SELECT
  customer.descriptive_name,
  customer.currency_code,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM customer
WHERE segments.date BETWEEN '<prior_start>' AND '<recent_end>'
```

```sql
-- Per campaign, for the channel pass and Stage 1 L2
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<prior_start>' AND '<recent_end>'
```

When a primary conversion action is configured, also pull `metrics.conversions` filtered to `segments.conversion_action_name = '<primary_conversion_action>'` for the same range and use it in place of `metrics.conversions` (conventions section 3).

Use Python to:

- Derive a `channel_group` per campaign: `advertising_channel_type`, except SEARCH splits into `SEARCH_BRANDED` when the campaign name contains any brand term (case-insensitive) and `SEARCH_NONBRANDED` otherwise.
- Tag each row `recent` or `prior` by `segments.date`, then sum cost, clicks and conversions per `(customer_id, window)` for the account pass and per `(customer_id, channel_group, window)` for the channel pass.
- Compute per window CPA = cost / conversions and CVR = conversions / clicks, then `cpa_drift_pct = (recent_cpa - prior_cpa) / prior_cpa × 100`, `cvr_delta_pct = (recent_cvr - prior_cvr) / prior_cvr × 100`, `conv_delta_pct = (recent_conv - prior_conv) / prior_conv × 100` (undefined when the prior value is 0).
- Apply the check's thresholds. Skip any account or channel with fewer than 30 prior-window conversions. Account level: CPA drift up when `cpa_drift_pct > 30` (severe above 50); CVR drop when `cvr_delta_pct < -25` (severe below -40) and the prior window had at least 500 clicks; volume drop when `conv_delta_pct < -25` (severe below -40). Channel level: CPA drift up and volume drop only, same thresholds (per-channel CVR is too noisy).
- Print the account table and the channel table: prior and recent cost, conversions, CPA, CVR, and the three deltas, sorted by `cpa_drift_pct` descending.

Save these tables; Stage 1 reads them.

## Setup — read the change history first

**Every Google Ads investigation starts here.** Most "why did X drift on date Y" answers live in the change log.

1. Read `ads/google/health/recent-changes.md`. It covers the last 14 days by default (up to 29).
2. If it is missing, stale, or doesn't cover the comparison window, query `change_event` yourself with the same constraints the check uses, widened to 29 days (the maximum):

```sql
SELECT
  customer.descriptive_name,
  change_event.change_date_time,
  change_event.change_resource_type,
  change_event.resource_change_operation,
  change_event.user_email,
  change_event.client_type,
  change_event.changed_fields,
  campaign.id,
  campaign.name
FROM change_event
WHERE change_event.change_date_time >= '<today minus 29 days>'
  AND change_event.change_date_time <= '<today>'
  AND change_event.change_resource_type IN ('CAMPAIGN', 'CAMPAIGN_BUDGET', 'CAMPAIGN_CRITERION', 'AD_GROUP', 'AD_GROUP_CRITERION', 'AD_GROUP_BID_MODIFIER')
ORDER BY change_event.change_date_time DESC
LIMIT 1000
```

   If an account returns exactly 1000 rows, split the window in two and query each half so nothing is cut off.
3. Use Python to group the rows by `change_resource_type` and date, stamp each with its `campaign.name` so Stage 1 localisation results can filter into the relevant slice, and print the counts per day and type next to the drift inflection.

**API constraints on `change_event`:**

- **30-day retention.** Google rejects start dates 30 or more days old. The default 28-day recent + 28-day prior comparison is already too wide: only the recent half plus about a day of the prior half is queryable. Cap at 29 days.
- **Filter restrictions.** `change_event` only accepts these `change_resource_type` values in the WHERE clause: `CAMPAIGN`, `CAMPAIGN_BUDGET`, `CAMPAIGN_CRITERION`, `AD_GROUP`, `AD_GROUP_CRITERION`, `AD_GROUP_BID_MODIFIER`. Filtering on `ASSET_GROUP*`, `BIDDING_STRATEGY`, `CONVERSION_ACTION`, `CUSTOMER_NEGATIVE_CRITERION`, or `SHARED_CRITERION` fails outright.
- **Child-resource edits surface as parent rows.** A bidding-strategy or conversion-action edit shows up as a `CAMPAIGN` (or `CAMPAIGN_BUDGET`) row whose `changed_fields` names the affected field. Look at `changed_fields`, not the resource type.

**For change types the change history doesn't surface directly:**

- **Asset-group edits (PMax):** there are no ASSET_GROUP rows because the resource type can't be filtered. Look at the `CAMPAIGN` rows whose `changed_fields` reference asset-group properties, OR cross-reference `asset-coverage.md` and `ad-strength-pmax.md` for downstream signal of an asset-group change.
- **Bidding-strategy switches / target tightens:** look for `CAMPAIGN` rows with `changed_fields` referencing `bidding_strategy_type`, `target_cpa_micros`, or `target_roas`, OR cross-reference `bid-strategy-churn.md` and `active-bidding-overrides.md`, which probe these directly.
- **Conversion-action edits:** look at `conversion-action-health.md` for per-action `last_modified` context (when available), OR look for `CAMPAIGN` rows where `changed_fields` references `selective_optimization`.
- **Negative-list edits (account-level / shared):** these don't come through the `change_event` filter at all. Cross-reference `account-negatives.md`, comparing a result dated before the window with the current one.

**Treat the change log as evidence for AND against hypotheses:**

- A matching change row near the drift inflection supports the corresponding hypothesis.
- The **absence** of any matching change in the window is a falsifiable rejection — "nothing was changed at this layer, this isn't the cause."
- A change row that doesn't fit any listed hypothesis (e.g. a geo-targeting expansion when no hypothesis mentions geo) is grounds to add a hypothesis to the ledger mid-investigation. Don't ignore unexpected changes.

**Auto-apply edges — flag these as suspect:**

- `client_type = 'GOOGLE_ADS_AUTO_APPLY'`: Google made the edit on its own. Common cause, frequently invisible to the account owner. The `recent-changes` check calls these out when they exceed 10 in the window; count them in Python the same way.
- `client_type = 'GOOGLE_ADS_AUTOMATED_RULE'`: user-created rules. Worth reviewing if a rule fired on the inflection date.

## Method

Follow the hypothesis ledger. The hypotheses for each stage are below. **All date-bounded probes read from the change history fetched in Setup** — don't re-query `change_event` per hypothesis.

### Stage 1 — Localise

Question: **where is the drift coming from?** Run this stage every time, even when the trigger is channel-level — channel-level observations are suggestive, not deterministic.

**Hypotheses:**

| H | Hypothesis | Probe | Falsifiable result |
|---|---|---|---|
| **L1** | One channel drives ≥50% of the cost-weighted CPA delta | From the trend-drift channel table: for each `channel_group`, compute `Δcost-weighted-CPA = recent_cost × (recent_cpa − prior_cpa)`. Rank by share of total Δ. | Confirmed if a single channel contributes ≥50%. Rejected if no channel exceeds 30% — drift is distributed across channels. |
| **L2** | A small number of campaigns (≤5) drive ≥50% of the delta inside the worst-performing channel from L1 | The per-campaign query above, over both windows. Compute per-campaign Δcost-weighted-CPA contribution. Filter to the L1-confirmed channel only. | Confirmed if ≤5 campaigns hold ≥50% of the within-channel delta. Rejected if the drift is distributed across >10 campaigns. |
| **L3** | One market / geo drives the delta | The geo query below. Recompute Δ per geo. | Confirmed if a single geo holds ≥50%. N/A if the account targets one geo. |
| **L4** | Apparent CPA rise is a measurement artefact — conversion-signal density shifted, not auction efficiency | **Historical evidence only — current config is not evidence about past config.** Acceptable probes: (a) date-stamped row in the change history referencing a conversion-action edit inside the window, (b) a `last_modified` timestamp on a conversion action that falls inside the window, (c) a `change_event` row showing `selective_optimization` or `include_in_conversions_metric` flipping inside the window. `conversion-action-health.md` (or a direct `conversion_action` query) shows *today's* config — useful for "the current setup is clean" but **not** for "the setup was different at the inflection." | Confirmed only with a dated change inside the window. **Deferred** if no historical evidence is available (current state alone is not enough). Rejected only if dated evidence shows the config was unchanged through the window. |
| **L5** | Distributed / account-wide — no concentration anywhere | This is the default when L1–L4 all reject. Don't probe directly; classify as confirmed only when the others land on `rejected`. | — |

Use Python for L1–L3. For each slice (channel, campaign, geo), sum cost and conversions per window, compute CPA per window, then `delta = recent_cost × (recent_cpa − prior_cpa)` (undefined when either window has zero conversions; list those slices separately with their cost and conversions). Share = slice delta / sum of deltas across the slices. Print the slices sorted by share descending with prior and recent cost, conversions, CPA, delta and share, and the count of slices needed to reach 50% of the total.

**L3 geo query** (country level; for single-country accounts with regional targeting, use `segments.geo_target_region` instead):

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  geographic_view.country_criterion_id,
  geographic_view.location_type,
  segments.date,
  metrics.cost_micros,
  metrics.conversions
FROM geographic_view
WHERE segments.date BETWEEN '<prior_start>' AND '<recent_end>'
```

Resolve country IDs to names with a `geo_target_constant` query (`geo_target_constant.id`, `geo_target_constant.name`) and group by country.

**For L4 without a fresh health result**, query the current setup and read it with the temporal rule in mind:

```sql
SELECT
  customer.descriptive_name,
  conversion_action.name,
  conversion_action.status,
  conversion_action.primary_for_goal,
  conversion_action.include_in_conversions_metric,
  conversion_action.counting_type
FROM conversion_action
WHERE conversion_action.status != 'REMOVED'
```

A second useful dated probe: daily conversions per `segments.conversion_action_name` over both windows (the per-campaign query with that segment added). An action that starts or stops recording conversions on a specific date inside the window is dated evidence; compute in Python the first and last date each action recorded conversions.

**Classification rules:**

- One confirmed → that's the localisation. Proceed to Stage 2 with that slice.
- Multiple confirmed → compound localisation ("PMax in France specifically", "one campaign carrying a misconfigured conversion action"). State the compound; Stage 2 takes the most specific slice.
- L4 confirmed → there's no Stage 2 in the channel sense. The diagnosis IS the measurement artefact; the fix is in the conversion setup. Write the finding with that as the cause and point to the `conversion-action-health` result (or the `google-ads-conversion-tracking` skill for the fix).
- L5 confirmed (all others rejected) → likely tracking, billing, or external. Surface it as needing manual investigation of those causes. Don't fabricate a Stage 2.

### Stage 2 — Root-cause the localised slice

Question: **why did the confirmed slice from Stage 1 break?**

The hypothesis list is determined by what L1 (or L1+L2) confirmed. Lists are inlined for the three highest-volume channels; other channels fall through to a note for the user.

Probes that compare recent against prior use the same two 28-day windows as Stage 1. "Inside the window" means inside the recent window, and for change-history probes, inside the part of it `change_event` retention covers.

#### If Stage 1 confirmed **PMax**

| H | Hypothesis | Probe | Falsifiable result |
|---|---|---|---|
| **P1** | Asset group edit landed inside the window (creative, signals, listing group, audience) | Asset-group rows can't be queried from the change history. Look at `CAMPAIGN` rows on the affected PMax campaign(s) whose `changed_fields` references asset-group properties. Cross-reference `asset-coverage.md` and `ad-strength-pmax.md` — a sharp drop in asset coverage between consecutive dated results is a strong downstream signal of an asset-group edit. | Confirmed if a material edit lands within 1–7 days of the inflection. Rejected if no parent CAMPAIGN rows reference asset-group fields and asset-coverage results are stable. |
| **P2** | Brand exclusion or account-level negative criterion added | Look at `CAMPAIGN_CRITERION` rows on the affected campaign(s) inside the window. For account-level negatives (`CUSTOMER_NEGATIVE_CRITERION`, not filterable), cross-reference `account-negatives.md`. | Confirmed if a relevant exclusion was added. Rejected otherwise. |
| **P3** | Bid strategy or target change (tCPA tightened, tROAS raised, switched from Max Conv → tCPA) | Look at `CAMPAIGN` rows on the affected campaign(s) whose `changed_fields` references `bidding_strategy_type`, `target_cpa_micros`, or `target_roas`. Cross-reference `bid-strategy-churn.md` and `active-bidding-overrides.md`, which probe bidding-strategy edits directly. | Confirmed if a target was tightened by ≥10% or the strategy switched inside the window. |
| **P4** | Merchant Center feed degradation (Shopping-inventory PMax only) | If the campaign has a `shopping_setting`, compare disapproved-product counts recent vs prior. The Google Ads API only exposes current product status, so this needs dated counts: a previous feed-related health result dated before the window, or Merchant Center diagnostics history from the user. | Confirmed if disapproved-product count rose ≥20% inside the window. N/A if non-Shopping PMax. Deferred without dated counts. |
| **P5** | Audience signal weakened — primary 1P list shrank below activation threshold or dropped from the asset group | GAQL `user_list.size_for_search` and `user_list.size_for_display` on the campaign's signal lists; compare to the size 90 days ago if available (the API returns only today's size, so this needs an earlier dated record). | Confirmed if a primary 1P list dropped below 1k members or was removed. |
| **P6** | Seasonality / external — competitor entry, holiday, Google update | Auction insights for the campaign over the window. The API exposes these only to some accounts (`segments.auction_insight_domain` with `metrics.auction_insight_search_overlap_rate`); if the query fails, ask the user for an Auction insights export for both windows. Rule-out probe: this is rarely confirmed, but rejecting it lets you state the other hypotheses with more confidence. | Confirmed if auction-insights overlap from a new competitor jumped ≥20%. Rarely confirmed; reject when probes don't show it. |

#### If Stage 1 confirmed **Search**

| H | Hypothesis | Probe | Falsifiable result |
|---|---|---|---|
| **S1** | Ad disapprovals on the affected campaign(s) — coverage dropped | GAQL `ad_group_ad.policy_summary.approval_status` per campaign, count disapproved. That is today's status: compare it with a `disapproved-ads.md` result dated before the window, or treat it as current state only. | Confirmed if disapproved share rose ≥20% in the recent window. Deferred without a dated prior count. |
| **S2** | Negative-keyword list change (campaign or shared) | Look at `CAMPAIGN_CRITERION` rows with negative status inside the window. For shared negatives (`SHARED_CRITERION`, not filterable), cross-reference dated `account-negatives.md` results. | Confirmed if a broad-match negative was added that overlaps with top converters. |
| **S3** | Match-type drift / close-variant expansion — search terms widened to lower-intent queries | Compare `search_term_view` spend distribution across `segments.search_term_match_type` recent vs prior (query below). Cross-reference with `n-gram-analysis.md` if recent. | Confirmed if the BROAD share (including close variants) rose ≥15 points. |
| **S4** | Bid strategy / target change | Same probe as P3. | Same as P3. |
| **S5** | Brand-traffic isolation broke (brand campaign starved, non-brand absorbing brand queries) | Compare `channel_group` SEARCH_BRANDED vs SEARCH_NONBRANDED conversions recent vs prior, from the channel table. | Confirmed if branded conversions dropped ≥30% while non-branded held flat. |

**S3 query:**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  segments.search_term_match_type,
  segments.date,
  metrics.cost_micros,
  metrics.conversions
FROM search_term_view
WHERE campaign.id IN (<affected campaign ids>)
  AND segments.date BETWEEN '<prior_start>' AND '<recent_end>'
```

Use Python to sum cost per `(window, search_term_match_type)`, convert to shares of each window's total, and print the share change in percentage points. Count `BROAD` plus the close-variant types (`NEAR_EXACT`, `NEAR_PHRASE`) as the broad side, and also show `BROAD` alone.

#### If Stage 1 confirmed **Shopping** (standard Shopping, not PMax-shopping)

| H | Hypothesis | Probe | Falsifiable result |
|---|---|---|---|
| **SH1** | Feed disapprovals — product count eligible to serve dropped | Merchant Center product status counts (dated, as in P4); GAQL `shopping_performance_view` over both windows, counting distinct `segments.product_item_id` with impressions per window as the serving-product count. | Confirmed if eligible-product count dropped ≥10%. |
| **SH2** | Bid strategy / target change | Same as P3. | Same as P3. |
| **SH3** | Campaign priority misalignment (low/medium/high) — competing Shopping campaigns shifted | Look at `CAMPAIGN` rows whose `changed_fields` references `shopping_setting.campaign_priority`. | Confirmed if priority on a high-spend campaign was lowered. |
| **SH4** | Inventory shift — product mix changed, top performers ran out | `metrics.cost_micros` segmented by `segments.product_item_id` from `shopping_performance_view`. Compare top-N products recent vs prior. | Confirmed if ≥30% of prior-window top-10 spenders dropped out of the recent top-30. |

Use Python for SH1 and SH4: sum cost and impressions per `(window, product_item_id)`; for SH1 count items with impressions > 0 per window; for SH4 rank items by cost per window, take the prior top 10 and the recent top 30, and compute the share of the prior top 10 missing from the recent top 30.

#### If Stage 1 confirmed **Display / Video / Demand Gen / other**

There is no inline hypothesis list for these channels. Surface that explicitly:

> "Stage 1 localised to {channel}. This skill doesn't carry a hypothesis list for this channel — the deeper diagnosis has to be done manually. Likely directions: recent asset/creative edits, audience-signal changes, placement-exclusion shifts. Recording the localisation as confirmed and the channel-specific deep dive as deferred."

### Probing efficiency

All Stage 1 probes are independent — run them in one batch. Stage 2 probes are also mutually independent within each channel list. Don't serialise unless one probe's result is genuinely needed to formulate the next.

## Output

One finding per conventions section 4: `kind: anomaly`, `category` set by the cause (`tracking` for L4, `bids` for a bidding cause, `creative` for asset or disapproval causes, `keywords` for match-type or negative causes, `structure` otherwise). The `Investigation` section is mandatory and carries both stages of the ledger, placed in the Details:

```md
## Investigation

### Stage 1 — Localisation

| Hypothesis | Status | Evidence |
|---|---|---|
| L1 — Channel concentration | **confirmed** | PMax holds 76% of the cost-weighted CPA delta (€{X} of €{Y} total, 28 days vs prior 28). Source: trend-drift channel table. |
| L2 — Campaign concentration inside L1 | rejected | 9 PMax campaigns each hold 8–15% of the within-channel delta — distributed, not single-campaign. |
| L3 — Market concentration | N/A | Single-market account (France only). |
| L4 — Measurement artefact | rejected | No conversion-action edits in the change history for the window; every primary action recorded conversions on every day of both windows. |
| L5 — Distributed / account-wide | N/A | L1 confirmed. |

### Stage 2 — Root cause (PMax)

| Hypothesis | Status | Evidence |
|---|---|---|
| P1 — Asset group edit | **confirmed** | CAMPAIGN change row on PMax France Generic at 2026-04-28 with asset-group signal fields changed (4 days before the drift inflection). Three audience signals removed. |
| P2 — Brand exclusion added | rejected | No CAMPAIGN_CRITERION changes in window; account-negatives results unchanged. |
| P3 — Bid strategy change | rejected | bidding_strategy_type unchanged; target_roas stable at 4.0. |
| P4 — Merchant Center degradation | N/A | Non-Shopping PMax. |
| P5 — Audience signal weakened | rejected (subsumed by P1) | The signal removal IS the audience change — same root cause. |
| P6 — Seasonality / external | rejected | Auction insights overlap held flat through the window. |
```

The wrap-up leads with the confirmed cause, not the symptom:

> "Three audience signals were removed from PMax campaign 'PMax France Generic' on 2026-04-28. The CPA inflection followed within four days. The campaign is now relying on Google's signal-less optimisation, which explains the volume drop (-76%) and CPA rise (+383%)."

Cite the probe results so the next agent can re-run the evidence path: the change-history row, the trend-drift channel table, the conversion setup check. Recommendations are the fix as a table (account, campaign, change, reason) for the user to apply; the Google Ads MCP is read-only.

## Confidence — be honest

- Two strong probes corroborating the cause (P1 + L1 both pointing at the same campaign) → high confidence. State it.
- One probe supporting but another inconclusive → medium. State what's missing.
- Stage 2 hypothesis list didn't cover the actual cause (none confirmed) → low confidence in the diagnosis. Recommend manual deep-dive or escalation.

## Confirm with the user

This skill writes a high-leverage finding. With the user present, stage the confirmation:

1. After Stage 1, show the localisation result:

   > "Drift localised to {slice} — {evidence in one line}. Should I proceed with the Stage 2 root-cause for {channel}?"

2. After Stage 2, show the confirmed cause + recommendation:

   > "Confirmed cause: {one sentence}. Evidence: {citation}. Recommended fix: {specific action}. Should I write this as a finding?"

Don't write the file until the user confirms the framing — a diagnosis is the input to the next piece of work, so the framing has to be right. In an unattended run, run both stages, write the finding with `status: pending`, and say in the wrap-up that the localisation hasn't been reviewed.

## Workspace writes

- `ads/google/findings/YYYY-MM-DD-google-ads-diagnose-trend-drift.md` — the finding with the Investigation table per stage and the confirmed cause leading the wrap-up.
- If the user explains the drift as intended (a planned budget cut, a seasonal pause), offer to save that as a memory file in `ads/google/memory/` and add a line to `MEMORY.md`.

## Don't

- **Don't retrofit current state as past state.** The conversion setup shows config *now*. The fact that an action is `MANY_PER_CLICK` today does not mean it was `MANY_PER_CLICK` on the inflection date — the config could have flipped at any point. The same goes for asset coverage, audience signals, bidding strategy, every other "current state" probe. Causal claims require evidence dated *inside* the comparison window. If no dated evidence is available, mark the hypothesis `deferred` and name what would unblock it (tag manager audit, GA4 admin change history, screenshot, change_event when retention permits) — do NOT escalate to `confirmed` on pattern-match alone.
- **Don't skip the Setup change-history step.** It's the universal probe for any Google Ads "why did X happen" investigation — most answers live in the change log.
- **Don't query `change_event` outside its constraints.** Keep the window at 29 days or less and the resource-type filter to the six allowed values; a wider query fails or silently drops data. Prefer the `recent-changes` health result when it is fresh.
- **Don't trust an over-narrow resource-type filter.** Asset-group, bidding-strategy, and conversion-action edits surface as parent `CAMPAIGN` rows whose `changed_fields` names the affected field — not as their own resource type. Look at `changed_fields`.
- Don't skip Stage 1 even when the trigger is a channel-level observation. A "PMax drift" can still be a single-campaign issue, a market-specific issue, or a measurement artefact. The health check observation is suggestive, not deterministic.
- Don't add a hypothesis the trigger's slice didn't motivate. The ledger is closed at the supplied set unless a probe surfaces a new cause mid-investigation — change-history rows that don't match any listed hypothesis ARE that trigger; act on them.
- Don't proceed to Stage 2 when Stage 1 lands all-rejected. That's L5 — distributed/account-wide. Hand off, don't fabricate a channel root cause.
- Don't run Stage 2's channel-specific list when L4 (measurement artefact) is confirmed. The diagnosis is already complete; the fix is in the conversion setup, not in the channel.
- Don't overstate confidence when the Stage 2 list is incomplete (Display / Video / Demand Gen / other). Say what you couldn't probe.
- Don't write the finding before the user confirms the Stage 1 localisation (when a user is present). Stage 1 frames Stage 2 — wrong framing wastes the next run.
