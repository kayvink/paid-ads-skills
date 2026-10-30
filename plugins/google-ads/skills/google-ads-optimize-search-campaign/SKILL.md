---
name: google-ads-optimize-search-campaign
description: Run the full 17-step optimisation routine on one Google Ads Search campaign or every Search campaign in an account, in five groups (segmentation and spending, targeting, ads and landing pages, bidding, quality control), pulling the data for each step, computing the decision in Python, handing the deep work to the matching skill or health-check catalog check, and ending with one consolidated finding and a prioritised action list. Use when the user asks to optimise a Search campaign, for a full Search review, a monthly optimisation pass, or "go through the checklist". For a single topic run the specialist directly, for example google-ads-check-search-terms, google-ads-check-keyword-performance, google-ads-analyze-segments or google-ads-analyze-auction-insights; for an account-wide health read across every channel use google-ads-health-check.
---

# Optimise a Search campaign

> Work through one Search campaign (or all of them) step by step, in the order an experienced account manager does it, and come out with one prioritised list of changes.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`; bidding steps use `references/smart-bidding-mechanics.md`, `references/learning-phase-thresholds.md` and `references/sis-headroom.md`.

## Goal

Run the 17-step Search checklist end to end and turn it into one decision list. Each step has four parts: what to pull, what to compute, the decision rule, and which skill or catalog check goes deeper. This skill does the first three itself at a light depth for every step, and calls the specialist only where the light pass finds something or the user asked for a full run. It doesn't duplicate the specialists: when it calls one, it takes that skill's method and folds the result into this run's finding.

## Scope

Search campaigns only (`campaign.advertising_channel_type = 'SEARCH'`). Either one campaign the user names, or every enabled Search campaign with spend in the window. Performance Max, Shopping, Display and Video are out of scope; their overlap with Search shows up only where a step says so (search terms via `google-ads-audit-search-term-cannibalisation`).

Read-only: every output is a recommendation the user applies.

## Modes

| Mode | What runs | When |
|---|---|---|
| **Standard** (default) | The light pass for all 17 steps; a specialist only where the light pass flags something | Monthly optimisation, "optimise this campaign" |
| **Full** | The light pass plus every specialist named in the step table | The user asks for a full or deep review, or a campaign is being rebuilt |
| **Group** | One of the five groups only (for example "just the targeting steps") | The user names a part of the checklist |

When the user is present and the run is large (many campaigns, full mode), state the number of campaigns and specialists before starting and offer standard mode or a narrower scope.

## Inputs you need

1. **Business context:** `wiki/company.md` (offer, buyer, service area, opening hours, what a conversion is worth).
2. **Rules:** `ads/google/rules/*.md` for each campaign group's KPI and target CPA or ROAS. Without rules, judge each campaign against its own 90-day average and say so; offer `google-ads-create-channel-rules`.
3. **Plan:** `ads/media-plan.md` for budget lines (steps 1 and 17).
4. **Index:** `ads/google/index.md` for accounts, `primary_conversion_action` and brand terms.
5. **Memory:** `ads/google/memory/MEMORY.md`.
6. **Recent work:** `ads/google/findings/` and `ads/google/health/` from the last 14 days. A step already covered by a fresh finding or health result reuses it instead of re-running, and says so.
7. **Live data:** the queries per step, each account in scope. Default window: the last 30 days ending yesterday, written as explicit `BETWEEN` ranges, plus the previous 30 days for comparisons. Steps that need more data say so.

## Before step 1: tracking gate

Run catalog check `conversions-flowing` (it's part of step 17) first. If any account in scope recorded no conversions on recent days that normally have them, stop judging performance: every CPA in steps 1–16 would be wrong. Report the gate failure as the top action, point at `google-ads-setup-tracking`, and finish the run with only the steps that don't depend on conversions (6, 13, 14, 17). Report the gate in step 17's place in the output so the step order is kept.

Also pull the campaign spine that most steps join to, once:

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.status,
  campaign.bidding_strategy_type,
  campaign.target_cpa.target_cpa_micros,
  campaign.maximize_conversions.target_cpa_micros,
  campaign.target_roas.target_roas,
  campaign.maximize_conversion_value.target_roas,
  campaign_budget.amount_micros,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Run it for the current and the previous 30 days. When `primary_conversion_action` is set, run the primary-action copy (`segments.conversion_action_name` selected and filtered) and join it on `(customer_id, campaign.id)`. Use Python to derive per campaign `cost`, `cpa = cost / conversions`, `roas = value / cost`, `cvr = conversions / clicks`, the target from rules (or the bid strategy's own target when rules are silent), and `vs_target = cpa / target_cpa` (or `roas / target_roas`).

## The 17 steps at a glance

| # | Group | Step | Light pass in this skill | Deeper |
|---|---|---|---|---|
| 1 | Segmentation and spending | Campaign spend vs results | Scale-ready or needs optimisation | `google-ads-find-scale-candidates`, `google-ads-budget-allocation`; checks `impression-share-losses`, `scale-headroom` |
| 2 | Segmentation and spending | Ad group spend vs results | Break out or fix | checks `ad-group-underperformer`, `ad-group-scale-candidate` |
| 3 | Targeting | Search term audit | Waste share, converting terms not yet keywords | `google-ads-check-search-terms`; `google-ads-audit-negative-strategy`; check `n-gram-analysis` |
| 4 | Targeting | Keyword review | High CPC, high CPA | `google-ads-check-keyword-performance`; check `high-cpc-outliers` |
| 5 | Targeting | Auction insights | New competitors, rising pressure | `google-ads-analyze-auction-insights` |
| 6 | Targeting | Keyword status | QS below 5, below first page bid, low search volume | checks `kw-status-warnings`, `kw-quality-score-low` |
| 7 | Targeting | Location results | Weak locations, clicks outside the target | `google-ads-analyze-segments` (location); `google-ads-check-geo-targeting`; check `geo-targeting-type` |
| 8 | Targeting | Device results | Device CVR gap and the right lever | `google-ads-analyze-segments` (device); check `device-imbalance` |
| 9 | Targeting | Audience performance | Observation coverage and segment gaps | `google-ads-analyze-segments` (audience); checks `audience-targeting-mode`, `rlsa-configured` |
| 10 | Targeting | Demographic performance | Age and income gaps | `google-ads-analyze-segments` (demographics); check `demographic-exclusions` |
| 11 | Targeting | Performance by time | Day, hour, budget running out | `google-ads-analyze-segments` (time); check `dayparting-coverage` |
| 12 | Ads and landing pages | Ad split tests | Winners and losers per ad group | checks `ad-strength-rsa`, `ad-rotation-mode`, `missing-rsa` |
| 13 | Ads and landing pages | Ad quality | Disapproved and limited ads | `google-ads-ad-disapprovals`; check `disapproved-ads` |
| 14 | Ads and landing pages | Ad assets | Missing asset types | checks `ad-extensions`, `asset-type-coverage` |
| 15 | Ads and landing pages | Landing page CVR | Weak pages | `google-ads-audit-ad-relevance`; check `lp-conv-rate-outlier` |
| 16 | Bidding | Campaign bidding review | Enough data? Target still right? | `google-ads-choose-bid-strategy`; checks `smart-bidding-readiness`, `smart-bidding-cold-start`, `bid-strategy-churn` |
| 17 | Quality control | Conversions, budget, payment, auto-apply | Pass or fail per item | `google-ads-health-check` targeted run; `google-ads-check-pacing` |

Checks are entries in the `google-ads-health-check` catalog (`references/checks/search.md` and `account.md` inside that skill). To run one, use `google-ads-health-check` in targeted mode with the check IDs, or follow the entry's queries and Python directly. If a skill named here isn't installed, use the light pass below and say the specialist would sharpen the step.

## Segmentation and spending

### Step 1: Campaign spend vs results

**Pull:** the campaign spine (both windows).

**Compute (Python):** per campaign, `spend_share = cost / total Search cost`, `vs_target`, the change in CPA or ROAS vs the previous window, and the impression share fields as fractions. Classify:

| Class | Rule (CPA goal; mirror for ROAS) |
|---|---|
| **Scale-ready** | `vs_target <= 1.0`, conversions >= 30, and `search_budget_lost_impression_share >= 0.10` or `search_impression_share < 0.60` |
| **Efficient, capped** | `vs_target <= 1.0` and impression share above 0.85: little headroom left |
| **Needs optimisation** | `vs_target >= 1.2`, or 0 conversions with spend >= 2× target CPA |
| **Hold** | everything else |
| **Insufficient data** | under 20 conversions in the window: directional only |

**Decision:** Scale-ready campaigns get a budget or target proposal sized with `references/sis-headroom.md` (no more than +20% per step). Needs-optimisation campaigns are where steps 2–16 focus first; list them at the top of the run order.

**Deeper:** `google-ads-find-scale-candidates` for the scale case, `google-ads-budget-allocation` when budget should move between campaigns.

### Step 2: Ad group spend vs results

**Pull:**

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group.id, ad_group.name,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value,
  metrics.search_impression_share
FROM ad_group
WHERE ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Compute (Python):** per ad group, `spend_share` within its campaign, `cpa_index = 100 * ad_group_cpa / campaign_cpa` (or ROAS index). Flag:

- **Break-out candidate:** `cpa_index <= 80`, conversions >= 20, spend share >= 20%, and search impression share below 0.65. It deserves its own budget (a separate campaign) so it isn't starved by weaker ad groups.
- **Low performer:** `cpa_index >= 150` with spend share >= 10%, or 0 conversions with spend >= 2× campaign CPA.

**Decision:** break-outs become a structure proposal; low performers go to steps 3, 4 and 12 for the cause (queries, keywords, ads) before any pause.

**Deeper:** checks `ad-group-underperformer` and `ad-group-scale-candidate` (account-average versions of the same test).

## Targeting

### Step 3: Search term audit

**Pull:** `search_term_view` for the campaign, as in `google-ads-check-search-terms` step 1.

**Compute (Python):** per campaign, the share of spend on terms with at least 30 clicks and 0 conversions (waste share), and the converting terms not yet added: `search_term_view.status = 'NONE'`, conversions >= 2 and CPA at or below the campaign CPA.

**Decision:** waste share above 5% of campaign spend → run `google-ads-check-search-terms` for the negative list. Converting terms not yet added → propose them as exact-match keywords in the ad group that matched them (or a new ad group when the theme differs). Check the proposals against existing negatives first so you don't add a keyword that a negative blocks.

**Deeper:** `google-ads-check-search-terms` (waste and negatives), `google-ads-audit-negative-strategy` (list structure), check `n-gram-analysis` (recurring words).

### Step 4: Keyword review

**Pull:**

```sql
SELECT
  customer.descriptive_name, customer.currency_code,
  campaign.id, ad_group.id, ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  metrics.clicks, metrics.impressions, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM keyword_view
WHERE ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Compute (Python):** per keyword, `cpc = cost / clicks` and `cpa`. High CPC: CPC above the ad group median + 2.5 × MAD with at least 20 clicks (the `high-cpc-outliers` rule). High CPA: `cpa >= 1.5 × campaign CPA` with conversions >= 3, or 0 conversions with spend >= 2× campaign CPA.

**Decision:** high CPA with on-intent search terms → bid down (manual) or leave to the bidder and fix the ad or page (Smart Bidding); with off-intent terms → tighten the match type and add negatives. Never pause a keyword that is the only route to a converting term.

**Deeper:** `google-ads-check-keyword-performance` (six buckets and Quality Score diagnosis).

### Step 5: Auction insights

**Pull, compute, decide:** run `google-ads-analyze-auction-insights` for the campaigns in scope. It checks API access and falls back to a CSV export. In standard mode, run it for campaigns that step 1 marked Needs optimisation or whose rank-lost impression share rose 5 points or more vs the previous window; skip it otherwise and say so.

**Decision:** a new entrant or rising competitor that lines up with higher rank-lost share or CPC → the bid and Quality Score questions in steps 6 and 16. No competitor change → the cause is in the account; continue.

### Step 6: Keyword status checks

**Pull, compute:** the queries and Python of catalog checks `kw-status-warnings` (rarely served, low search volume, below first page bid, disapproved) and `kw-quality-score-low` (QS below 5, with the dragging component).

**Decision:** keywords with QS below 5 that carry 10% or more of campaign spend → fix the dragging component (ad relevance → step 12 copy, landing page → step 15, expected CTR → step 12 headlines). Below first page bid on a keyword with converting search terms → raise the bid (manual) or review the target (step 16). Low search volume → pause or merge into a broader keyword; it adds clutter, not reach.

### Step 7: Location results

**Pull, compute:** the location family of `google-ads-analyze-segments` (`geographic_view` and `user_location_view`, index, volume gate, significance).

**Decision:** weak or dead locations → adjustment (manual CPC) or exclusion (Smart Bidding), per that skill's lever rules. Clicks with `targeting_location = false` above 10% of the campaign → check `geo-targeting-type` and exclude non-targeted locations the business can't serve.

**Deeper:** `google-ads-check-geo-targeting` when names, targets and actual clicks disagree or a media plan sets country allocations.

### Step 8: Device results

**Pull, compute:** the device family of `google-ads-analyze-segments`.

**Decision:** a device converting significantly below the rest → fix the experience first (mobile page speed, form length, click-to-call), then a modifier on manual CPC, or -100% only when the device is dead. Cross-check with catalog check `device-imbalance`.

### Step 9: Audience performance

**Pull, compute:** the audience family of `google-ads-analyze-segments`, plus catalog checks `audience-targeting-mode` (observation, not targeting) and `rlsa-configured` (coverage).

**Decision:** a campaign with no observation audiences → add the site's remarketing lists, customer lists and two or three relevant in-market segments in observation, so the next run has data. Strong audiences → modifier (manual) or a remarketing-specific campaign when the gap is large and volume allows. Audience lists set to targeting by mistake → switch to observation.

### Step 10: Demographic performance

**Pull, compute:** the demographics family of `google-ads-analyze-segments` (age, gender, household income where the market reports it).

**Decision:** exclude only groups outside the buyer profile in `wiki/company.md` that also test weak or dead; leave the `UNDETERMINED` group alone. Cross-check with catalog check `demographic-exclusions`.

### Step 11: Performance by time

**Pull, compute:** the day-of-week, hour and budget-sufficiency parts of `google-ads-analyze-segments` (8-week window).

**Decision:** day of week is usually the clearest signal; act on it first. Hours only in blocks that pass the gate. A campaign that runs out of budget before its strongest hours → budget (step 1 sizing) or a schedule that shifts spend into those hours. Cross-check with catalog check `dayparting-coverage`.

## Ads and landing pages

### Step 12: Ad split test results

**Pull:**

```sql
SELECT
  customer.descriptive_name,
  campaign.id, ad_group.id, ad_group.name,
  ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
  ad_group_ad.ad_strength,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use a 60-day window when ad groups have under 1,000 impressions per ad in 30 days.

**Compute (Python):** for each ad group with two or more enabled ads, each with at least 1,000 impressions, compare every challenger with the ad group's top ad on conversions per impression (`conversions / impressions`, the metric that combines CTR and CVR) using `statsmodels.stats.proportion.proportions_ztest([conv_a, conv_b], [impr_a, impr_b])` with conversions rounded; fall back to CTR (`clicks / impressions`) when conversions are under 20 per ad and say so. Correct across ad groups with `multipletests(..., method="fdr_bh")`. Flag ad groups with only one enabled ad.

**Decision:** a challenger significantly worse → pause it and write a new challenger that changes one idea (offer, proof point, call to action). No significant difference → leave the test running unless it's older than 90 days, in which case pause the weaker and start a new test. Ad groups with one ad → add a second RSA. When ad rotation is set to optimise, Google already skews impressions to the stronger ad; read the result with that in mind (catalog check `ad-rotation-mode`). Weak `ad_strength` → catalog check `ad-strength-rsa`.

### Step 13: Ad quality check

**Pull, compute:** `google-ads-ad-disapprovals` for disapproved and limited ads. For ads that are approved but barely serving, select `ad_group_ad.primary_status` and `ad_group_ad.primary_status_reasons` on `ad_group_ad` (confirm the fields with `get_resource_metadata`) and list ads whose status reasons indicate limited or low-quality serving.

**Decision:** disapprovals → the policy fix from that skill. Ad groups left with no serving ad → top action, since the ad group has stopped.

### Step 14: Ad asset review

**Pull, compute:** catalog checks `ad-extensions` and `asset-type-coverage`. Then list, per campaign, which asset types are live at account, campaign or ad group level:

```sql
SELECT campaign.id, campaign.name, campaign_asset.field_type, campaign_asset.status
FROM campaign_asset
WHERE campaign_asset.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

Run the same shape against `customer_asset` (`customer_asset.field_type`) and `ad_group_asset` (`ad_group_asset.field_type`), and union them in Python per campaign.

**Decision:** every Search campaign should have sitelinks, callouts and structured snippets. Call, lead form, location, price, promotion and image assets apply when `wiki/company.md` says the business takes calls, collects leads, has premises, lists prices or runs offers; propose the missing ones that apply, and don't propose the rest.

### Step 15: Landing page conversion rate review

**Pull:**

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  landing_page_view.unexpanded_final_url,
  metrics.clicks, metrics.cost_micros, metrics.conversions,
  metrics.speed_score, metrics.mobile_friendly_clicks_percentage
FROM landing_page_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Confirm `metrics.speed_score` and `metrics.mobile_friendly_clicks_percentage` with `get_resource_metadata` and drop them if they aren't selectable.

**Compute (Python):** per campaign and URL (strip query strings), clicks, CVR and `cvr_index` against the campaign. Test pages with at least 100 clicks against the rest of the campaign with the two-proportion test from step 12.

**Decision:** a page with significantly lower CVR and 15% or more of campaign clicks → compare it with the best page (message match, speed, form, call to action) and propose either a page fix or pointing those ad groups at the better page. Catalog check `lp-conv-rate-outlier` gives the account-wide view; `google-ads-audit-ad-relevance` goes deeper on keyword, copy and page match.

## Bidding

### Step 16: Campaign bidding review

**Pull:** the campaign spine (bid strategy, targets, 30-day conversions), plus 90 days of daily conversions per campaign for stability.

**Compute (Python):** per campaign:

- **Enough data for Smart Bidding?** 30-day conversions against `references/learning-phase-thresholds.md` (Search: 30). Value-based bidding also needs conversion values that vary; check the spread of `conversions_value / conversions` across days.
- **Target still optimal?** `vs_target` from the spine, impression share and the lost-share split.

| Situation | Decision |
|---|---|
| Manual CPC with 30+ conversions in 30 days | Propose Smart Bidding (catalog check `smart-bidding-readiness`) |
| Smart Bidding with under 15 conversions in 30 days | Too little data: consider Maximize clicks, consolidation, or a micro-conversion; see `smart-bidding-cold-start` |
| Actual CPA at least 10% below target, rank-lost IS above 20% | Loosen: raise target CPA (or lower target ROAS) by 5–10% to buy volume |
| Actual CPA at least 20% above target for 2+ weeks, outside learning | Tighten by 5–10%, after checking conversion delay and step 17 |
| Target changed in the last 14 days, or several times in 30 days | Hold; check `bid-strategy-churn` |

Steps follow `references/smart-bidding-mechanics.md`: 5–10% per move, one move per two weeks.

**Deeper:** `google-ads-choose-bid-strategy` when the strategy itself is in question (manual vs Smart Bidding, CPA vs ROAS, portfolio vs campaign).

## Quality control

### Step 17: Quality control checks

Run `google-ads-health-check` in targeted mode with these check IDs, or follow their entries directly:

| Item | Checks |
|---|---|
| Conversion actions working | `conversions-flowing` (already run as the gate), `conversion-action-health`, `primary-event-quality` |
| Budget on track | `monthly-budget-pacing`, `daily-budget-overdelivery`, `account-budget-cap`; `google-ads-check-pacing` when a media plan exists |
| Payment method | `account-budget-cap` covers invoiced accounts. For card or direct-debit billing, query `billing_setup.status` from `billing_setup` (confirm fields with `get_resource_metadata`); when the API doesn't show it, ask the user to confirm in Billing → Summary that there's no payment issue |
| Auto-apply settings | `auto-apply-settings` |

**Decision:** any failure here goes to the top of the action list, ahead of optimisation work: a broken conversion action or a lapsed payment invalidates or stops everything else.

## Consolidate

Use Python to build one action table from every step:

1. One row per proposed change: account, campaign, step, group, entity, current value, proposed value, evidence, spend at stake (the 30-day cost of the entity the change touches), priority.
2. **Priority** per `references/priority-tiers.md`: Critical (step 17 failures, the tracking gate, dead spend above 5% of the campaign, ad groups with no serving ad), Moderate (most performance changes with material spend), Low (hygiene, assets, low-spend items). Mark rows from segments below the minimum-data rule as directional.
3. **De-duplicate** across steps: the same keyword flagged in steps 4 and 6 is one row with both reasons; a location excluded in step 7 drops any modifier proposal for it.
4. **Conflicts:** when one step proposes more budget (step 1) and another proposes cutting the same campaign's weak segments (steps 7–11), keep both and order them: cut the waste first, then scale.
5. **Order** by priority, then spend at stake. Cap the main table at 20 rows and summarise the rest by step.

## Output

One finding: `kind: optimization`. Set `category` to the category of the highest-priority action (`tracking` for a gate or step 17 failure, otherwise `bids`, `keywords`, `budget`, `creative` or `structure`).

**Wrap-up example:** *"Non-Brand Generic FR is 24% over its €40 target CPA; most of the gap is two ad groups with off-intent broad-match traffic (6% of spend on wasted terms) and a mobile landing page converting at half the desktop rate. Fix those first; the campaign also runs out of budget by 15:00, so scale only after the waste is cut."*

**Per-account summary:** one line per account, with campaigns covered and the mode.

**General improvements**, for example:
- "No campaign has observation audiences, so steps 9 and 10 have no audience data. Adding remarketing and in-market lists in observation now gives the next run something to read."
- "Auction insights aren't enabled for this API connection; step 5 used the CSV export."

**Recommendations:**

| priority | account | campaign | step | entity | current | proposed | evidence | spend_at_stake |
|---|---|---|---|---|---|---|---|---|
| critical | Acme FR | Non-Brand Generic FR | 3 | negative "jobs" (phrase) | none | add at campaign level | 94 clicks, €171, 0 conv in 30 days | €171 |
| moderate | Acme FR | Non-Brand Generic FR | 15 | /offer-mobile | final URL | point ad groups 2 and 4 at /offer | CVR 1.9% vs 4.1% rest, 640 clicks, p_adj 0.002 | €1,050 |
| moderate | Acme FR | Non-Brand Generic FR | 16 | target CPA | €40 | hold, revisit after the step 3 and 15 changes | CPA €49.6, rank-lost IS 14%, no recent target change | €3,970 |

**Details:** the step-by-step status table, then the evidence tables from the steps that flagged something (using the specialist's table format where one ran).

| step | group | status | summary | ran |
|---|---|---|---|---|
| 1 | Segmentation and spending | flagged | Needs optimisation: CPA 24% over target | light pass |
| 5 | Targeting | ok | No competitor change above 5 points | google-ads-analyze-auction-insights |
| 9 | Targeting | skipped | No observation audiences attached | light pass |

`status` is `flagged`, `ok`, `skipped` (with the reason) or `reused` (a fresh finding or health result, with its date).

**Pending example**
- title: *Non-Brand Generic FR 24% over target CPA, driven by wasted broad-match terms and a weak mobile page*
- summary: *17 steps on 1 campaign, 30 days: 6% of spend on non-converting terms, one landing page converting at 46% of the others on 640 clicks, budget exhausted by 15:00 on 18 of 28 days. 3 critical, 7 moderate, 5 low actions.*

**OK example**
- title: *Brand and Non-Brand Generic FR on track across all 17 steps*
- summary: *Both campaigns within 5% of target CPA over 30 days, waste under 1% of spend, no keyword or ad below the thresholds, conversions, budget, billing and auto-apply all pass. Two low-priority asset gaps noted.*
- The body keeps the step status table so the reader sees every step was checked.

## Workspace writes (when the user confirms)

- The finding itself, per the conventions. Sub-skills called during the run don't write their own findings; their results go into this one. Health checks run in targeted mode write their own `ads/google/health/` files as usual.
- The user declines a recommendation for a reason → a memory file and a line in `MEMORY.md` (for example "Brand FR keeps weekend hours for brand presence").
- The user wants a recurring routine → propose the cadence as a line in `ads/google/index.md` (for example `search_optimisation: monthly, standard mode`).

## Evidence rule

Every action names the step it came from, the entity, the numbers, and the threshold it crossed:

> *"Step 2, Non-Brand Generic FR, ad group 'Running shoes women': €820 in 30 days, 22 conversions, CPA €37 vs campaign €49.6 (index 75), 34% of campaign spend, search impression share 48%. Break-out candidate (index at or below 80, 20+ conversions, 20%+ spend share, IS below 65%). Proposed: move to its own campaign with a €40 target CPA."*
