---
name: google-ads-analyze-segments
description: Analyse Google Ads performance by day of week, hour of day, device, location, audience (observation lists) and demographics (age, gender, household income) for Search and other campaign types, indexing each segment's CPA and conversion rate against the campaign average behind a volume gate and a significance test, checking whether budget runs out at certain hours, and proposing bid adjustments only where the campaign bids manually (exclusions or structure changes under Smart Bidding). Use when the user asks about dayparting, ad schedules, device or mobile performance, which locations, audiences, ages or income groups convert, bid adjustments or modifiers, or whether budget lasts the whole day. For the deep geo targeting audit use google-ads-check-geo-targeting; for audience strategy on Display, YouTube, Demand Gen and PMax use google-ads-audit-audience-strategy; for the full Search optimisation routine use google-ads-optimize-search-campaign.
---

# Analyse segment performance

> Find the days, hours, devices, locations, audiences and demographic groups that convert well above or below the campaign average, prove the gap is real, and recommend the lever the campaign's bid strategy actually listens to.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Bid strategy behaviour comes from `references/smart-bidding-mechanics.md`, confidence tiers from `references/priority-tiers.md`, and budget increase caps from `references/sis-headroom.md`.

## Goal

For each campaign in scope, cut performance along six segment families and answer three questions per segment:

1. **Is it different?** CPA index and CVR index against the campaign average.
2. **Is the difference real?** A volume gate, then a two-proportion test of the segment's CVR against the rest of the campaign.
3. **What is the lever?** A bid adjustment when the campaign bids manually; an exclusion, a schedule, a split campaign or nothing at all when it runs Smart Bidding.

Plus one budget question: does the campaign run out of budget before the day ends, and at which hour?

## Scope

| Segment family | Resource and field | Campaign types |
|---|---|---|
| Day of week | `campaign` + `segments.day_of_week` | all |
| Hour of day | `campaign` + `segments.hour` | all |
| Device | `campaign` + `segments.device` | all |
| Location | `geographic_view` (targeted location), `user_location_view` (where the user was) | all |
| Audience | `ad_group_audience_view`, `campaign_audience_view` | Search (observation lists) mainly; other types read-only here |
| Demographics | `age_range_view`, `gender_view`, `income_range_view` | Search, Display, Video, Demand Gen |

Day of week is the most reliable cut in practice: each weekday collects data from every week in the window, so it reaches significance first. Hour of day needs more data, and should be grouped into blocks when single hours don't pass the gate.

**Performance Max** reports device, day, hour and location at campaign level, but its bidding ignores adjustments and it has no demographic or audience reports here. Analyse it read-only; the levers are location exclusions and the ad schedule.

**Neighbouring skills.** This skill reports segment performance and the lever. The location setting audit (Presence vs Presence or Interest, name vs targeting reconciliation, media plan compliance) belongs to `google-ads-check-geo-targeting`. Audience list hygiene, prospecting vs retargeting, and lookback windows on non-Search channels belong to `google-ads-audit-audience-strategy`. Read-only recommendations: the user applies every change.

## Inputs you need

1. **Rules:** `ads/google/rules/*.md` for each campaign group's KPI (CPA or ROAS) and target. Without rules, compare against the campaign's own average and say so.
2. **Index:** `ads/google/index.md` for `primary_conversion_action` and brand terms.
3. **Business context:** `wiki/company.md`: opening hours, service area, who the buyer is (a B2B tool expects weekday office hours; a takeaway expects evenings).
4. **Memory:** `ads/google/memory/MEMORY.md`. Respect acknowledged exceptions such as "weekends are low CVR but we keep them for brand presence".
5. **Recent findings:** `ads/google/findings/` from the last 14 days, especially earlier runs of this skill and health-check results for `dayparting-coverage`, `device-imbalance`, `demographic-exclusions` and `geo-targeting-type` in `ads/google/health/`.
6. **Live data:** the queries below, for each account in scope.

**Windows** (explicit `BETWEEN` ranges ending yesterday):

- Day of week and hour of day: the last 56 days (8 full weeks, so every weekday appears 8 times).
- Device, location, audience, demographics: the last 30 days; extend to 90 days for a campaign whose segments fail the volume gate, and say so.
- Exclude days inside a known learning period or tracking outage (from memory or recent findings) before computing anything.

## Step 1: Campaign settings and existing adjustments

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  customer.time_zone,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  campaign.bidding_strategy_type,
  campaign.manual_cpc.enhanced_cpc_enabled,
  campaign.status,
  campaign_budget.amount_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
```

```sql
-- Existing campaign-level device, schedule and location adjustments and exclusions
SELECT
  campaign.id,
  campaign_criterion.criterion_id,
  campaign_criterion.type,
  campaign_criterion.negative,
  campaign_criterion.bid_modifier,
  campaign_criterion.device.type,
  campaign_criterion.ad_schedule.day_of_week,
  campaign_criterion.ad_schedule.start_hour,
  campaign_criterion.ad_schedule.end_hour,
  campaign_criterion.location.geo_target_constant
FROM campaign_criterion
WHERE campaign.status = 'ENABLED'
  AND campaign_criterion.type IN ('DEVICE', 'AD_SCHEDULE', 'LOCATION')
```

Use Python to label each campaign's **lever mode** from `bidding_strategy_type`:

| Bid strategy | Lever mode | What works |
|---|---|---|
| `MANUAL_CPC` (with or without `enhanced_cpc_enabled`), `MANUAL_CPM`, `MANUAL_CPV` | `adjust` | Bid adjustments on device, schedule, location, audience and demographics, plus exclusions |
| `TARGET_CPA`, `TARGET_ROAS`, `MAXIMIZE_CONVERSIONS`, `MAXIMIZE_CONVERSION_VALUE` | `exclude` | Smart Bidding sets bids per auction from these signals already and ignores bid adjustments except a -100% device adjustment. Levers: exclusions (ad schedule hours, locations, demographic groups, -100% device), separate campaigns with their own targets, or fixing the experience (landing page, mobile UX) |
| `MAXIMIZE_CLICKS`, `TARGET_IMPRESSION_SHARE` and anything else | `partial` | Treat as `exclude` for recommendations and note that the adjustment behaviour of this strategy should be confirmed in the campaign's settings |

Enhanced CPC has been retired on Search; where it still shows on a campaign, Google treats the campaign as manual CPC. Keep the existing adjustments table: a recommendation states the current modifier and the proposed one, never only the new value.

## Step 2: Pull each segment family

Every query selects the same metrics. When `primary_conversion_action` is set, run a second copy of each query with `segments.conversion_action_name` selected and `segments.conversion_action_name = '<primary_conversion_action>'` in the conditions, keep only `metrics.conversions` and `metrics.conversions_value` in it, and join it in Python on the segment keys plus `customer_id` and `campaign.id`. Without a primary action, use `metrics.conversions` from the main query and note it.

**Day of week and hour of day**

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  segments.day_of_week, segments.hour,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`segments.hour` is in the account's time zone (`customer.time_zone`); say so in the output.

**Device**

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  segments.device,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Location.** Country level first, from `geographic_view` (the targeted location Google matched) and `user_location_view` (where the user physically was, with `user_location_view.targeting_location` true when they were inside the targeted area):

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  geographic_view.country_criterion_id,
  geographic_view.location_type,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  user_location_view.country_criterion_id,
  user_location_view.targeting_location,
  metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM user_location_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

For single-country campaigns, cut one level deeper by adding `segments.geo_target_region` (or `segments.geo_target_city` for local businesses) to the `geographic_view` query. Confirm the segment is selectable with `get_resource_metadata` on `geographic_view` first. Resolve IDs to names with:

```sql
SELECT geo_target_constant.id, geo_target_constant.name,
  geo_target_constant.country_code, geo_target_constant.target_type
FROM geo_target_constant
WHERE geo_target_constant.id IN (<ids>)
```

**Audience (observation lists)**

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  ad_group.id, ad_group.name,
  ad_group_criterion.criterion_id, ad_group_criterion.type,
  ad_group_criterion.display_name, ad_group_criterion.bid_modifier,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM ad_group_audience_view
WHERE campaign.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Run the same shape against `campaign_audience_view` with `campaign_criterion.*` fields, since many Search accounts attach audiences at campaign level. Read `ad_group.targeting_setting.target_restrictions` (see catalog check `audience-targeting-mode`) to know whether each ad group's audiences observe or restrict: only observation audiences can be compared with the rest of the campaign.

**Demographics**

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  ad_group.id,
  ad_group_criterion.age_range.type,
  ad_group_criterion.bid_modifier,
  ad_group_criterion.negative,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM age_range_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Run the same query against `gender_view` (`ad_group_criterion.gender.type`) and `income_range_view` (`ad_group_criterion.income_range.type`). Household income is only reported in some countries; an empty result is normal and goes in the output as "not available for this market". The `UNDETERMINED` bucket (age, gender or income unknown) is a real segment: report it, and never recommend excluding it without the user's explicit agreement, because it is often the largest bucket.

Save every result to the scratch folder as the conventions describe.

## Step 3: Build segment tables

Use Python, per segment family:

1. Cast metrics, `cost = cost_micros / 1e6`, `value = conversions_value`. Join the primary-action query when there is one.
2. Group by `(customer_id, campaign.id, <segment key>)` and sum impressions, clicks, cost, conversions, value. For demographics and ad-group audiences, sum across ad groups to campaign level (keep the ad-group rows for exclusions that must be set per ad group). For `geographic_view`, sum the `LOCATION_OF_PRESENCE` and `AREA_OF_INTEREST` rows per country.
3. Campaign totals per `(customer_id, campaign.id)` from the same family's rows, so the segment shares add up to 100%. Audience rows overlap and don't add up to the campaign: take campaign totals from the device query instead and compare each audience against "campaign minus that audience".
4. Derived per segment: `cvr = conversions / clicks`, `cpa = cost / conversions`, `roas = value / cost`, `spend_share = cost / campaign cost`, `conv_share = conversions / campaign conversions`.
5. Indexes against the campaign average: `cvr_index = 100 * cvr / campaign_cvr`, `cpa_index = 100 * cpa / campaign_cpa`, `roas_index = 100 * roas / campaign_roas`. Use the KPI the campaign group's rules name; default to CPA when conversion values are absent or constant.
6. **Hour blocks.** When fewer than half the hours of a campaign pass the volume gate in step 4, regroup hours into blocks before testing: 00–05, 06–08, 09–11, 12–13, 14–16, 17–19, 20–23. Also build a day × block grid (7 × 7) for the output, keeping cells that fail the gate as blank.

## Step 4: Volume gate and significance

Use Python to test each segment against the **rest of the campaign** (campaign totals minus the segment), not against the campaign total that already contains it.

**Volume gate.** A segment is testable when:

- the campaign has at least 30 conversions in the window, and
- the segment has at least 100 clicks, and
- the segment has at least 20 conversions, or its spend is at least 2× the campaign CPA (so a zero-conversion segment can still be tested).

Segments that fail the gate are reported as "insufficient data" with their numbers, never as winners or losers. A campaign below 30 conversions is reported as directional only, per the minimum-data rule in `references/priority-tiers.md`.

**Significance.** Two-proportion z-test on CVR:

```python
from statsmodels.stats.proportion import proportions_ztest
from scipy.stats import fisher_exact
from statsmodels.stats.multitest import multipletests

conv_s, clicks_s = round(min(seg_conv, seg_clicks)), seg_clicks
conv_r, clicks_r = round(min(rest_conv, rest_clicks)), rest_clicks
if min(conv_s, conv_r, clicks_s - conv_s, clicks_r - conv_r) < 5:
    _, p = fisher_exact([[conv_s, clicks_s - conv_s], [conv_r, clicks_r - conv_r]])
else:
    _, p = proportions_ztest([conv_s, conv_r], [clicks_s, clicks_r])
```

Conversions are capped at clicks and rounded because the test needs a count of converting clicks; when a campaign counts every conversion and conversions exceed clicks noticeably, say so and treat the result as indicative.

Within each campaign and segment family, correct for testing many segments at once: `multipletests(pvals, alpha=0.05, method="fdr_bh")`. A segment is **significant** when its adjusted p-value is below 0.05.

For ROAS campaigns, also compare value per click: bootstrap the difference only if the user asks; otherwise report the ROAS index alongside the CVR test and say the test covers conversion rate, not order value.

## Step 5: Classify and choose the lever

Per testable segment:

| Class | Rule |
|---|---|
| **Strong** | significant, `cpa_index <= 80` (or `roas_index >= 120`) |
| **Weak** | significant, `cpa_index >= 125` (or `roas_index <= 80`) |
| **Dead** | spend >= 2× campaign CPA, 0 conversions, significant against the rest |
| **In line** | everything else that passed the gate |

Then the lever, by lever mode from step 1:

**`adjust` (manual bidding).** Proposed modifier for CPA goals: `raw = cvr / campaign_cvr - 1`; for ROAS goals use value per click: `raw = (value / clicks) / (campaign_value / campaign_clicks) - 1`. Shrink it toward zero to allow for noise, `proposed = 0.5 * raw`, clamp to the range -50% to +30%, and round to the nearest 5%. A Dead segment gets an exclusion (-100% or a schedule or location exclusion) rather than a modifier. Compare with the existing modifier from step 1 and propose only changes of 10 points or more. Demographic and audience modifiers are set per ad group: list the ad groups.

**`exclude` and `partial` (Smart Bidding and others).** Do not propose bid adjustments: the bidder ignores them. Instead:

- Dead or Weak hours and days: an ad schedule that excludes them, only when the segment is Dead or its `cpa_index >= 150`, because the bidder already lowers bids in weak hours and an exclusion also removes its cheap wins.
- Dead or Weak locations: a location exclusion, or a separate campaign with its own target when the location carries more than 20% of spend.
- Weak device: fix the experience first (mobile landing page speed, form length, click-to-call); a -100% device adjustment only when the device is Dead.
- Weak demographic groups: an exclusion only for groups outside the buyer profile in `wiki/company.md`; otherwise leave it to the bidder.
- Strong segments: no bid lever. A Strong audience or location with budget-lost impression share is a candidate for its own campaign or a higher budget; say so.

## Step 6: Budget sufficiency by time of day

For campaigns with budget-lost impression share above 10% (catalog check `impression-share-losses`), find when the money runs out.

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  segments.date, segments.hour,
  metrics.impressions, metrics.cost_micros, metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use a 28-day window. First try adding `metrics.search_budget_lost_impression_share` to the same query; impression share metrics are not compatible with every segment, so check `get_resource_metadata` for `campaign` or just run it and fall back when the API rejects it. If it works, report lost-to-budget share by hour directly.

Fallback, in Python: per `(customer_id, campaign.id, date)`, sort by hour and compute cumulative cost; `budget = campaign_budget.amount_micros / 1e6`. A day is **capped** when daily cost >= 0.95 × budget. On capped days, `cap_hour` = the first hour where cumulative cost >= 0.95 × budget. Report: share of days capped, median `cap_hour`, and the share of conversions the campaign normally gets after the median `cap_hour` on uncapped days (`conv_after_cap = conversions in hours > cap_hour / daily conversions`, averaged over uncapped days). A campaign that caps on most days around midday and normally earns 40% of its conversions in the afternoon is losing its afternoon.

Lever: raise the budget, sized with the caps in `references/sis-headroom.md`, or, when budget can't move, exclude the weakest hours so the same money lasts into the strongest ones.

## Interpretation rules

- **Severity:**
  - `high`: a Dead segment, or a Weak segment carrying 15% or more of campaign spend, or a campaign capped by budget on more than half its days before its strongest hours.
  - `medium`: a Weak segment with 5–15% of spend; a Strong segment on manual bidding with no modifier; a location with spend outside the targeted area (`targeting_location = false`) above 10% of clicks.
  - `low`: Strong or Weak segments below 5% of spend; insufficient-data notes; demographic exclusions missing where the buyer profile clearly rules a group out.
- **Don't double-count with the catalog.** If `dayparting-coverage`, `device-imbalance`, `demographic-exclusions` or `geo-targeting-type` already flagged the same campaign in the last 14 days, extend that result with the indexes and the lever instead of raising it again.
- **Interactions.** Device, hour and location are not independent (mobile skews to evenings). When a Weak device and a Weak hour block coexist in one campaign, check the device × hour cut before recommending both.
- **Tracking first.** A segment with clicks and zero conversions across every campaign (for example one device) is more likely a tracking problem than a performance one. Point at `google-ads-setup-tracking` before recommending exclusions.

## Output

One finding: `category: bids`, `kind: optimization`.

**Wrap-up example:** *"Across 6 Search campaigns, Saturday and Sunday convert at 58% of the weekday rate (significant in 4 campaigns), and Non-Brand Generic FR runs out of budget around 14:00 on 19 of 28 days. Two manual-CPC campaigns can take a -25% weekend adjustment; the four on Target CPA need either a budget increase or an afternoon-first schedule, not adjustments."*

**General improvements**, for example:
- "4 of 6 campaigns use Target CPA, so most of this analysis lands as exclusions or structure, not modifiers. The bidder already prices weekends lower; only the Dead segments are worth excluding."
- "Household income is not reported for this market; demographic cuts cover age and gender only."

**Recommendations:**

| account | campaign | lever_mode | segment_family | segment | current | proposed | evidence | severity |
|---|---|---|---|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | adjust | day of week | Saturday | 0% | -25% | 412 clicks, CVR 2.1% vs rest 4.0%, CPA index 186, p_adj 0.003 | medium |
| Acme FR | Brand FR | exclude | hour block | 00–05 | scheduled | exclude 00–05 | €320, 0 conv, campaign CPA €38, p_adj 0.01 | high |
| Acme FR | Non-Brand Generic FR | exclude | budget | daily budget | €150 | €180 | capped on 19 of 28 days, median cap 14:00, 41% of conversions normally after 14:00 | high |

**Details**, one table per segment family:

| account | campaign | segment | clicks | spend | conversions | cvr | cpa | cvr_index | cpa_index | spend_share | p_adj | class | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Plus the day × hour-block grid for the campaigns with a time finding, and the budget table: account, campaign, budget, days capped, median cap hour, conversions after cap hour on uncapped days.

**Pending example**
- title: *Weekends convert at 58% of weekdays in 4 campaigns; one campaign runs out of budget by 14:00*
- summary: *Saturday and Sunday CPA index 160–186 across €2.1k of 8-week spend. Non-Brand Generic FR hits its €150 budget before 14:00 on 19 of 28 days and normally earns 41% of conversions after that. Two manual-CPC campaigns get modifiers; four Target CPA campaigns get schedule and budget proposals.*

**OK example**
- title: *No segment converts significantly off the campaign average across 6 Search campaigns*
- summary: *Checked day, hour block, device, country, 14 observation audiences, age and gender over 30 to 56 days. 41 segments passed the volume gate; none differs from the rest of its campaign after correction (all adjusted p above 0.05). No campaign runs out of budget before 21:00.*
- The body lists the families checked, the gate, how many segments passed it and which ones lacked data.

## Workspace writes (when the user confirms)

- The user keeps a Weak segment on purpose ("we stay on weekends for brand presence") → a memory file under `ads/google/memory/` naming the campaign, segment and reason, plus a line in `MEMORY.md`.
- The user adopts a schedule or set of exclusions as policy → propose a line for the campaign group's `ads/google/rules/<group>.md` (for example `ad_schedule: Mon–Fri 07–22, Sat–Sun 09–20`) so later runs check against it.

## Evidence rule

Every flagged segment names the campaign, the segment, its clicks, spend, conversions, CVR and CPA, the campaign figures it was compared with, the adjusted p-value, and the lever mode that decided the recommendation:

> *"Non-Brand Generic FR, Saturday: 412 clicks, €610, 9 conversions, CVR 2.2% vs 4.0% for the rest of the campaign (adjusted p = 0.003), CPA index 186 over 8 weeks. Manual CPC, current Saturday modifier 0%: proposed -25% (half the observed gap, rounded)."*
