---
name: google-ads-check-spend-fragmentation
description: Deep audit of whether Google Ads Search and Performance Max budgets are spread too thin for Smart Bidding to learn, and whether high-volume campaigns are still on manual bidding, with a per-campaign classification, the account fragmentation rate, and merge candidates within declared taxonomy groups. Use when the user asks if they have too many campaigns, about consolidation, Smart Bidding readiness, or campaigns stuck in learning. For a quick structural check use google-ads-audit-spend-fragmentation.
---

# Check spend fragmentation

> Audit whether Search and PMax budgets are spread too thin for Smart Bidding to optimise, and whether high-volume campaigns are missing the Smart Bidding upside. Propose consolidation candidates when fragmentation is material; don't propose pausing large numbers of campaigns.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The conversion floors and the Smart Bidding onboarding path come from `references/learning-phase-thresholds.md`.

## Goal

For every live Search and PMax campaign with a conversion focus, check two things:
1. **Signal sufficiency:** does the campaign generate enough conversions in 30 days for Smart Bidding to learn and optimise?
2. **Bid strategy alignment:** if a campaign has sufficient volume, is it actually on a Smart Bidding strategy to take advantage?

When many campaigns miss the sufficiency threshold, surface consolidation candidates (same theme, declared taxonomy permitting). The role is diagnostic, not strategic overhaul: this skill does not recommend pausing large numbers of campaigns or restructuring entire account philosophies.

## Scope

Google Ads only. **Search and Performance Max** channel types; others (Display, Video, Demand Gen, Shopping) are out of scope for fragmentation analysis. Awareness campaigns are excluded (see detection below).

This skill recommends only. The user merges campaigns or changes bid strategies.

## Sufficiency thresholds

- **Search:** ≥ 30 conversions in the last 30 days
- **PMax:** ≥ 50–100 conversions in the last 30 days (use 50 as the floor; between 50 and 100 is "learning", below 50 is below threshold)

These are Smart Bidding learning rules of thumb, not hard rules. Respect declared exceptions in `ads/google/memory/` where the user has acknowledged intentional under-threshold campaigns (testing, new markets, policy constraints).

## Excluding awareness campaigns

Awareness campaigns optimise for reach or impression share, not conversions, so sufficiency thresholds don't apply. Detect exclusion via:

1. **Declared groups in `ads/taxonomy.md`:** if the taxonomy marks certain naming patterns or groups as awareness, exclude them.
2. **Primary conversion action absent or non-transactional:** if `campaign.selective_optimization.conversion_actions` is empty, or the conversion action is view-based (e.g. `view_product`), treat as awareness.
3. **Bidding strategy:** `TARGET_IMPRESSION_SHARE` or `TARGET_CPM` without conversion focus → awareness.

When unclear and the user is present, ask once and offer to write the classification to memory.

## Inputs you need

1. **Business context:** `wiki/company.md` for scale cues.
2. **Taxonomy:** `ads/taxonomy.md` for campaign groupings, the declared naming schema (used to identify merge candidates), and any awareness-group declarations.
3. **Rules:** `ads/google/rules/*.md` for per-group target KPIs (informs recommendations).
4. **Memory:** `ads/google/memory/MEMORY.md`. Scan for acknowledged exceptions and read the individual files for full context.
5. **Primary conversion action:** `ads/google/index.md`.
6. **Live data:** the two queries below, for each account in scope, over the last 30 complete days. Don't select `segments.date`: fragmentation works on 30-day totals per campaign, so let the API return one row per campaign. Join in Python on `(customer_id, campaign.id)`.

**Query A: structure, spend and funnel conversions**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  campaign.bidding_strategy_type,
  campaign.target_cpa.target_cpa_micros,
  campaign.maximize_conversion_value.target_roas,
  campaign.selective_optimization.conversion_actions,
  metrics.cost_micros,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query B: primary-action conversions** (skip when no primary action is configured, and use `metrics.conversions` added to query A instead)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

The thresholds (30 conversions per 30 days on Search, 50 on PMax) apply to the **primary-action** count from query B when configured. A campaign with 40 all-conversions but only 12 primary conversions is still fragmented on the KPI Smart Bidding actually optimises toward (assuming the primary action is what the bidding strategy targets). A campaign missing from query B has 0 primary conversions.

## Smart Bidding classification

Smart Bidding strategies (value-based, conversion-aware, algorithmic):
- `MAXIMIZE_CONVERSIONS`
- `MAXIMIZE_CONVERSION_VALUE`
- `TARGET_CPA`
- `TARGET_ROAS`

Non-Smart-Bidding strategies:
- `MANUAL_CPC` / `ENHANCED_CPC`
- `MANUAL_CPM` / `MANUAL_CPV`
- `TARGET_SPEND`
- `PERCENT_CPC`

PMax campaigns are inherently Smart Bidding (`MAXIMIZE_CONVERSION_VALUE` or `TARGET_ROAS`); Search is where the manual-vs-smart split actually matters.

## Analysis steps

1. **Load and filter.** Use Python to load both queries, join them, and add `cost = cost_micros / 1e6` and `primary_conv` (from query B, 0 when absent). Keep ENABLED Search and PMax and drop awareness campaigns per the three rules above; print the excluded campaigns and which rule excluded each.
2. **Classify each remaining campaign** in Python:
   - `threshold = 30` for `SEARCH`, `50` for `PERFORMANCE_MAX`; `sufficient = primary_conv >= threshold`. For PMax, also label `50 <= primary_conv < 100` as "learning".
   - `smart = bidding_strategy_type in {MAXIMIZE_CONVERSIONS, MAXIMIZE_CONVERSION_VALUE, TARGET_CPA, TARGET_ROAS}`.
   - **sufficient + smart** → healthy; keep.
   - **sufficient + manual** → bid-strategy opportunity; recommend testing Smart Bidding (typical path: Max Conversions → Target CPA / Target ROAS once stable).
   - **insufficient + smart** → fragmentation flag; Smart Bidding can't learn on fewer than 30 conversions a month (Search) or 50 (PMax).
   - **insufficient + manual** → both issues; fragmentation flag + manual already. The recommendation depends on whether consolidation is feasible.
3. **Compute the account-level fragmentation rate** in Python, per account:
   - `fragmentation_rate = (insufficient + smart campaigns) / (conversion-focused Search + PMax campaigns)`
4. **Apply the fragmentation thresholds:**
   - **> 50%:** a meaningful fragmentation challenge; explore consolidation with purposeful recommendations. Still don't propose pausing large numbers; propose merge candidates within the same declared group.
   - **> 30%:** fragmentation present; surface merge candidates where obvious (same-theme siblings below threshold).
   - **≤ 30%:** likely within normal range; minor individual flags only.
5. **Identify merge candidates** only within the same declared group from `ads/taxonomy.md`. Respect strategic splits (regional tiers, product lines, etc.): declared structure is intentional.

## Consolidation candidate detection

Two or more campaigns are merge candidates when all of these hold:
- Same declared group (parse names against the taxonomy's naming schema)
- Each individually below the sufficiency threshold for its channel type
- Combined conversions would meet or exceed the threshold
- No declared reason to keep them split (tier, product line, budget-owner constraint)

Use Python: parse each campaign name into its taxonomy fields, group the below-threshold campaigns by `(customer_id, channel type, declared group)` plus any field the taxonomy marks as a strategic split (market, tier, product line), and keep groups with 2 or more campaigns whose summed `primary_conv` reaches the channel threshold. Print each candidate set with members, combined conversions and combined spend. Merge only within one channel type: never pair a Search campaign with a PMax one.

If the taxonomy hasn't been declared, don't invent merge candidates: propose running the `google-ads-check-naming-convention` skill first to clarify structure, and flag fragmentation as an observation only.

## Interpretation rules

- **Severity:**
  - `high`: account fragmentation rate > 50%, OR a bid-strategy opportunity on a high-spend campaign (more than €3k/month, or the equivalent in the account currency, with sufficient volume and manual bidding)
  - `medium`: fragmentation 30–50%, OR multiple clear merge candidates within a single group
  - `low`: individual campaigns below threshold with no obvious merge candidates; minor fragmentation (under 30%)
- **Do not re-flag** items the user has acknowledged in `ads/google/memory/` (intentional testing campaigns, new-market pilots, etc.).
- **Do not propose pausing** campaigns. Reallocation and merging are in scope; pausing is not. Strategic pauses need human judgement this skill doesn't have.
- **Do not estimate business impact.** Don't say "this could save you X" or "you're losing Y". Report the structural condition and recommendation; let the user decide impact.
- **No loaded language.** Avoid "extreme", "severe", "broken": sentence case, neutral phrasing, specific numbers.

## Output

One finding: `category: structure`, `kind: audit`.

**Wrap-up:** one line with the fragmentation rate + biggest opportunity.
Example: *"52% of 21 conversion-focused Search and PMax campaigns are below Smart Bidding sufficiency; 4 merge candidates within Non-Brand NL."*

**Per-account summary:** only if multi-account.

**General improvements:** account-level observations:
- "18 of 21 conversion-focused campaigns are on Smart Bidding; 3 are on Manual CPC despite sufficient conversion volume, worth testing Smart Bidding on those."
- "Awareness classification unclear for 4 Search campaigns (no declared group, no primary conversion); confirm intent before a full fragmentation read."

**Recommendations:** consolidation and bid-strategy changes to consider.
- "Consider consolidating Non-Brand Generic NL campaigns 1 and 2: both below the 30-conversion threshold, same declared group, combined ~45 per month."
- "Review the bid strategy on Generic Search DE: 120 conversions a month but on Manual CPC; test Max Conversions, then Target CPA."

**Details table:** per-campaign classification, sorted by severity, then spend.

| account | campaign | type | bid_strategy | spend_30d | conversions_30d | meets_threshold | severity | recommendation |
|---|---|---|---|---|---|---|---|---|

- `type`: `Search` / `PMax`.
- `bid_strategy`: the `campaign.bidding_strategy_type` value, human-readable (e.g. `Target ROAS`, `Manual CPC`).
- `meets_threshold`: `yes` / `no` / `n/a (awareness)`.
- `recommendation`: one of `keep`, `test smart bidding`, `consolidate with X`, `reallocate`, `merge with X`, `review` (ambiguous case).

Set `status: ok` when nothing is actionable.

**Pending example:**
- title: *52% of Search and PMax campaigns below Smart Bidding threshold; 4 merge candidates*
- summary: *11 of 21 conversion-focused campaigns at under 30 conversions in 30 days on Smart Bidding. Merge candidates in Non-Brand NL (2 campaigns) and Generic DE (2 campaigns). 3 high-volume Manual CPC campaigns worth moving to Smart Bidding.*

**OK example:**
- title: *Budget allocation healthy; 85% of campaigns on sufficient-volume Smart Bidding*
- summary: *Checked 21 Search and PMax campaigns. 18 on Smart Bidding with at least 30 conversions in 30 days (Search) or 50 (PMax). 3 below threshold with strategic reasons recorded in memory. No merge candidates surfaced.*
- Body: what was checked, thresholds applied, awareness exclusions, why nothing is actionable.

## Workspace writes (when the user confirms)

- The user acknowledges a below-threshold campaign as intentional (testing, new market, regulatory split, etc.) → write a new file under `ads/google/memory/` with a scoped note (campaign, reason, date), then add a one-line entry to `MEMORY.md`.
- The user confirms a merge is not feasible for strategic reasons → record that acknowledgment the same way so the next run doesn't re-flag it.
- Actual merges, strategy changes and budget reallocations happen in Google Ads, done by the user. The finding records the recommendation.

On an unattended run, make no memory writes; put the proposal in the finding.

## Evidence rule

Every flag cites: campaign name, bidding strategy, 30-day spend, 30-day conversions, the threshold used, and (if applicable) the candidate merge partner and combined volume. Example:

> *"Non-Brand Generic NL: Target CPA, €1,450 over 30 days, 18 conversions (below the 30 threshold). Merge candidate with Non-Brand Generic NL Shoes (Target CPA, €980, 12 conversions); combined 30 conversions meets the threshold. Same declared group per taxonomy, no strategic split reason in memory."*

No "fragmented" without the numbers + the threshold + the declared structure it's measured against.
