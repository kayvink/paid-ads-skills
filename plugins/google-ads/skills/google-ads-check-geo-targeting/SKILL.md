---
name: google-ads-check-geo-targeting
description: Deep audit of Google Ads geo targeting, covering whether each campaign's location setting (Presence vs Presence or Interest) fits the business, whether campaign names, targeted locations and where clicks actually came from agree, per-country ROAS or CPA against the account average, media plan compliance and spend leaking to off-plan countries. Use when the user asks about geo or location targeting, country performance, spend in the wrong countries, or Presence or Interest leakage. For a quick geo performance and allocation check use google-ads-audit-geo-strategy.
---

# Check geo targeting

> Audit geo-targeting performance and setup: location setting fit for the business, per-country performance vs account average, media plan compliance, leakage from off-plan or presence-or-interest spill.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

For every live campaign, verify (a) the location setting matches the business's targeting reality, (b) the targeted geos line up with the declared taxonomy and media plan, (c) per-country performance is within range of account averages, and (d) spend isn't leaking to off-plan geos. Output is a prioritised, actionable list of adjustments.

## Scope

Google Ads. Cross-platform aggregation (same country across channels) is out of scope.

This skill recommends only. The user changes targeting.

## Business-context calibration: location setting

The right Google Ads location setting (`Presence` vs `Presence or Interest`) depends more on the business than on Google's default. Read `wiki/company.md` first. These are best-practice defaults, not absolutes. Deviations often have legitimate reasons; surface them for the user to confirm or acknowledge.

| Business type | Default best practice | Rationale |
|---|---|---|
| Local service (plumber, clinic, restaurant) | Presence | Customers typically need to be in the service area |
| Tourism / destinations (hotels, attractions, events) | Presence or Interest | Intent to travel is a valid signal: someone researching a trip is a real prospect |
| E-commerce with shipping | Presence | Ship-to is usually presence-based; cross-border-intent products can warrant an exception |
| B2B (SaaS, services, products) | Presence | Narrow ICP: impressions outside the addressable market typically burn budget without a conversion path |

When a campaign's setting differs from the default for the business type, flag it as a review item, not a guaranteed error. Respect any explicit reasoning in `ads/google/memory/`. Treat the table as a starting conversation, not a verdict.

## Inputs you need

1. **Business context:** `wiki/company.md` for business type and service-area granularity (country / regional / local).
2. **Taxonomy:** `ads/taxonomy.md` for campaign groupings (brand / semi-brand / generic / PMax), the declared market list, and tier definitions if declared (e.g. `Tier 1 = [US, UK, CA, AU]`).
3. **Media plan:** `ads/media-plan.md` for planned allocations (by country or tier), period, off-plan exclusions.
4. **Rules:** list `ads/google/rules/` and read each file for per-group ROAS / CPA targets.
5. **Memory:** `ads/google/memory/MEMORY.md`. Scan for prior acknowledgments (e.g. "Presence or Interest approved for Awareness") and read the individual files for full context.
6. **Primary conversion action:** `ads/google/index.md`.
7. **Live data, lazy-loaded.** Start with the campaign and setting inventory; only pull per-geo reports once you know which campaigns and channel types are in scope. Use the last 30 complete days throughout.

### Step 1: Campaign inventory and location settings

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  campaign.geo_target_type_setting.positive_geo_target_type,
  campaign.geo_target_type_setting.negative_geo_target_type,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

`positive_geo_target_type` values: `PRESENCE` or `PRESENCE_OR_INTEREST`. `negative_geo_target_type` values: `PRESENCE` or `PRESENCE_OR_INTEREST`. (`campaign.geo_target_type_setting` doesn't apply to every campaign type; an empty value is not an error.)

### Step 2: Targeted locations per campaign

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign_criterion.type,
  campaign_criterion.location.geo_target_constant,
  campaign_criterion.negative
FROM campaign_criterion
WHERE campaign_criterion.type = 'LOCATION'
  AND campaign.status = 'ENABLED'
```

Resolve the `geo_target_constant` resource names to places with a separate query:

```sql
SELECT
  geo_target_constant.id,
  geo_target_constant.name,
  geo_target_constant.country_code,
  geo_target_constant.target_type,
  geo_target_constant.canonical_name
FROM geo_target_constant
WHERE geo_target_constant.resource_name IN (<the resource names from step 2>)
```

`geo_target_constant` covers country / region / city / postal / DMA; `target_type` distinguishes the granularity. Use `country_code` to roll any sub-country target up to its country.

### Step 3: Geographic performance (targeting level)

Use `geographic_view` for performance attributed to the **targeted** location (what Google matched as eligible). Per-country ROAS / CPA comparisons use the **primary-action** count from query B when configured. Join in Python on `(customer_id, campaign.id, geographic_view.country_criterion_id)`.

**Query A: spend and funnel**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  geographic_view.country_criterion_id,
  geographic_view.location_type,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query B: primary-action conversions** (skip when no primary action is configured, and add `metrics.conversions` / `metrics.conversions_value` to query A instead)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  geographic_view.country_criterion_id,
  geographic_view.location_type,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

`geographic_view` is keyed by country and location type, so a campaign can return two rows per country (`LOCATION_OF_PRESENCE` and `AREA_OF_INTEREST`); sum them for per-country totals.

### Step 4: User location performance (actual clicks)

Use `user_location_view` for where clicks **physically** came from. Same two-query split; join on `(customer_id, campaign.id, user_location_view.country_criterion_id, user_location_view.targeting_location)`.

**Query A: spend and funnel**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  user_location_view.country_criterion_id,
  user_location_view.targeting_location,
  metrics.cost_micros,
  metrics.clicks,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM user_location_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query B: primary-action conversions** (skip when no primary action is configured)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  user_location_view.country_criterion_id,
  user_location_view.targeting_location,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM user_location_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

`user_location_view.targeting_location` is `true` when the user was physically in the campaign's targeted area, `false` when they were matched via Interest.

**Use both:** `geographic_view` answers "where did Google show my ads on a targeting match?"; `user_location_view` answers "where did the paying user actually sit?" Leakage from Presence or Interest is only visible in `user_location_view`: the difference between the two is this skill's signal for over-reach.

Resolve every `country_criterion_id` to a country name with the `geo_target_constant` query from step 2 (`WHERE geo_target_constant.id IN (<ids>)`).

## Analysis layers

Use Python for every layer. Load all queries, add `cost = cost_micros / 1e6`, join A and B per view, and map country IDs to country codes.

1. **Location setting fit.** For each campaign, compare `positive_geo_target_type` to the business-type recommendation above. Print every mismatch with the campaign's 30-day spend.
2. **Three-way reconciliation.** For each campaign, reconcile:
   - **Name** (as declared by the taxonomy: which markets it claims to cover). Parse the market token out of the campaign name using the naming schema in `ads/taxonomy.md`.
   - **Targeting** (from `campaign_criterion`: the set of countries of the positive, non-negative location targets).
   - **Actuals** (from `user_location_view`: where paying users sat). Per campaign and country, `click_share = clicks / campaign clicks`, and `interest_click_share = clicks where targeting_location = false / campaign clicks`.

   Mismatch types to flag:
   - Name says `_NL` but targeting includes `[DE, FR, NL]` → tagging error
   - Targeting is `NL` only but more than 20% of clicks came from BE → Presence or Interest leakage, probably
   - Name says `_EN` (language?) but targeting is `[UK, IE, NL]` → encoding ambiguity (`google-ads-check-naming-convention` catches this; cross-reference here)
3. **Per-country performance vs account average.** Always per country. From the joined `geographic_view` rows, sum cost, primary conversions and conversion value per `(customer_id, country)` and per account. Compute the account-level ROAS (or CPA, whichever primary KPI is in `rules/`), each country's own ROAS / CPA from its sums, and `vs_account_avg = (country_metric - account_metric) / account_metric × 100`. For CPA, a positive difference is worse; for ROAS, a negative one is. Apply the interpretation rules below.
4. **Media plan compliance.** Compare the actual spend distribution to the `media-plan.md` allocations: `actual_pct = country cost / account cost × 100`, `drift_pp = actual_pct - planned_pct`. If the plan is country-level, compare per country. If tier-level, decompose back to per-country and verify the sum per tier. Flag deviations above 10 percentage points.
5. **Off-plan spend.** If `media-plan.md` declares `off_plan_exclusions` or a positive list of planned countries, flag any spend outside the plan. Use `user_location_view` for this: you care where the money actually went. Per account, `off_plan_share = cost in countries not in the plan (or in the exclusions) / total cost`.
6. **Within-tier variance** (only if tiers are declared). Per tier, `spread = (max - min) / min` of the countries' ROAS (or CPA). If the spread exceeds 50%, surface it as informational: not a fix, but a signal that the tier grouping hides a real performance split.
7. **Long tail / low volume.** Countries below 1–2% of total spend over 30 days with no meaningful conversion volume: flag as "monitor only", or "candidate to pause / consolidate" if consistently low. In Python: country cost share below 2% and primary conversions of 0 (below 1% with 0 conversions is the `low` row in the table below).

Treat a country as having "meaningful volume" for layer 3 when it carries at least 2% of the account's spend; smaller countries fall to layer 7.

## Interpretation rules

| Finding | Severity | Recommendation |
|---|---|---|
| Location setting differs from business-type best practice | **Medium** | Review: correct if unintended, or acknowledge the reason in memory |
| Spend in off-plan geo above 1% of total | **High** | Exclude or justify via memory |
| Campaign name claims geo X but targets `[X, Y, Z]` | **High** | Fix targeting or rename |
| Country ROAS at least 10% better than the account average, meaningful volume | **Medium** | Scale spend |
| Country ROAS at least 10% worse than the account average | **Medium** | Reduce spend, investigate, or pause |
| Plan compliance drift above 10% (per country or tier) | **Medium** | Adjust pacing / bids / budgets |
| Presence or Interest leakage above 20% of clicks on an intent-legit campaign | **Low–Medium** | Acknowledge as intended, or tighten to Presence |
| Within-tier variance above 50% spread on ROAS / CPA | **Low** (informational) | Consider splitting out the outlier country |
| Long-tail country below 1% of spend, no conversions | **Low** | Monitor or pause |

Do NOT re-flag items previously acknowledged in memory.

## Modes

### Media plan not declared (bootstrap-lite)

The skill can still run without a media plan; it just loses the plan-compliance layer. Surface all the performance, setting and leakage findings as usual, and additionally propose a starter plan based on the observed spend distribution (computed in Python as each country's share of 30-day spend):

> "Your current spend is NL 45% / DE 22% / FR 18% / BE 10% / rest 5%. Want this codified as the current plan in `ads/media-plan.md`, or is this meant to shift?"

Include the proposal in the finding body. Do not write `media-plan.md` without the user's confirmation; `google-ads-create-media-plan` is the skill that authors it.

### Media plan declared (verify)

Full compliance check: actual vs planned, off-plan leakage, performance vs target, setting fit.

## Output

One finding: `category: structure`, `kind: audit`. Fill the standard body with:

**Wrap-up:** plan coverage % + biggest issue + spend at risk.
Example: *"18% spend leakage to off-plan BE + 3 campaigns on the wrong setting; €1.2k/month at risk; UK underspending plan by 12%."*

**General improvements:** plan-level / rules-level findings. Examples:
- "Codify current spend as a media plan: none declared, so the account operates without allocation targets."
- "Declare geo tiers: 22 countries in the account and no tier structure; monitoring individually is unmanageable at this scale."
- "Set ROAS targets per group in `ads/google/rules/`: no per-group targets yet, so performance comparisons use the account average as baseline."

**Recommendations:** specific plan, rules and setting changes, as a table the user applies (account | campaign | setting or target | current | proposed | reason).

**Details table:** a single table, one row per country per account:

| account | geo | planned % | actual % | spend | roas_or_cpa | vs_account_avg | location_setting | spend_at_risk | severity | issue_type | recommendation |
|---|---|---|---|---|---|---|---|---|---|---|---|

If tiers are declared in `ads/taxonomy.md`, add grouping headers in the table (e.g. a *Tier 1* row before the Tier 1 country rows). Countries still get their own rows; never roll up.

`severity` values for this skill:
- `high`: location setting contradicts business type (e.g. B2B on Presence or Interest), spend in an off-plan geo, name / targeting / actuals mismatch (tagging error)
- `medium`: country at least 10% off the account-average ROAS / CPA with meaningful volume, plan compliance drift above 10%, within-tier variance above 50% spread
- `low`: long-tail countries (under 1–2% of spend, no conversions), minor plan drift, acknowledged exceptions

`issue_type` values: `setting_mismatch`, `off_plan_spend`, `targeting_mismatch`, `plan_drift`, `underperforming`, `outperforming_scale`, `leakage`, `tier_variance`, `long_tail`.

**Pending example:**
- title: *18% spend leakage to off-plan BE and 3 campaigns on the wrong location setting*
- summary: *Presence or Interest on brand campaigns sent €1.2k/month to clicks from Belgium and Germany; a B2B account should be Presence-only. UK underspending plan by 12%.*

**OK example:**
- title: *Spend matches plan across NL, DE, FR and BE; no off-plan leakage*
- summary: *All campaigns on Presence, matching the B2B business type; per-country ROAS within ±10% of the account average; no long-tail concerns.*
- The body describes what was checked (campaigns, location settings inspected, `geographic_view` and `user_location_view` runs, plan declared) and why it passed.

## Workspace writes (when the user confirms)

- The user confirms a media plan in the bootstrap-lite flow → write `ads/media-plan.md` with the confirmed allocations, period and off-plan list (or hand over to `google-ads-create-media-plan`).
- The user acknowledges intentional exceptions → write a new file under `ads/google/memory/` with a dated note, then add a one-line entry to `MEMORY.md`. Examples:
  - `2026-04-24: User confirmed Presence or Interest on "Awareness EU" is intentional: brand-building, not direct response.`
  - `2026-04-24: User acknowledged AT spend is brand-adjacent tourism traffic, not a geo error.`

On an unattended run, make none of these writes; put the proposals in the finding.

## Evidence rule

Every flag cites the specific campaign + its setting + the actual figure + the rule or target it deviated from. No "this campaign looks mis-targeted" without "campaign `B_EN` targets [UK, IE, NL] but its name suggests English-language only; 34% of its €800 30-day spend came from NL users with English ads."
