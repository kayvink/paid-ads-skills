---
name: google-ads-design-account-structure
description: Design a new Google Ads account structure or restructure an existing one around a motion framework (B2B, B2C ecommerce or B2C growth), mapping each motion to campaign types (brand, non-brand by theme, competitor, Performance Max, Shopping, Demand Gen, remarketing, video), the category or brand point of view and its three or four themes to campaigns, ad groups and asset groups, and the budget to motions, then writing the target structure to ads/google/strategy/account-structure.md with a naming schema for ads/taxonomy.md and, for existing accounts, a measured migration plan covering fragmentation, overlap, cannibalisation and learning-phase risk. Use when the user asks how to structure or restructure a Google Ads account, whether their campaign structure makes sense, how to consolidate, or how to set up a new account. For a single campaign's build spec use google-ads-build-campaign; for the fragmentation audit alone use google-ads-check-spend-fragmentation.
---

# Design account structure

> Decide what campaigns the account should have, what each one is for, and how to get from today's structure to that one without throwing every campaign back into learning at once.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The three motion frameworks and their Google Ads mapping are in `references/motion-campaign-map.md`, the target document's shape is in `references/account-structure-template.md`, conversion floors come from `references/learning-phase-thresholds.md`, test windows after a change from `references/smart-bidding-mechanics.md`, markets from `references/market-partitioning.md`, and overlap severity from `references/priority-tiers.md`.

## Goal

Produce `ads/google/strategy/account-structure.md`: the account's target campaign architecture. Every campaign in it has one motion, one primary metric it is graded on, one conversion it bids on, one theme or role, one market, and a budget share. For an existing account, the document also maps every live campaign onto the target and lays out the migration as dated waves with their learning-phase risk.

The structure starts from the business, not from the current campaigns. Today's campaigns are evidence (what converts, what overlaps, what is too small to learn); they are not the design.

## Scope

- **In scope:** which campaigns exist and why, the brand / non-brand / competitor split, theme cuts, PMax and Shopping roles, upper-funnel and remarketing programs, budget share by motion, routing rules between campaigns, the naming schema proposal, and the migration plan.
- **Out of scope, handed to other skills:** keyword lists (`google-ads-research-keyword-opportunities`), one campaign's launch-ready build (`google-ads-build-campaign`), per-group targets and guardrails (`google-ads-create-channel-rules`), the period budget and country split (`google-ads-create-media-plan`), and ad copy (`google-ads-write-ad-copy`).
- **Read-only.** The skill writes documents. The user builds, merges and pauses campaigns in Google Ads.

## Principles the design follows

These come from the motion frameworks in `references/motion-campaign-map.md`. Apply them as rules, not suggestions.

1. **One campaign, one motion.** Google Ads serves several motions, so it runs several programs, but a single campaign never serves two. A Search campaign that bids on both a demo request and an e-book download is two campaigns pretending to be one.
2. **Graded on its own motion's metric.** Record, per campaign, what it bids on and what it is graded on. They can differ (bid on a qualified lead imported offline; grade on hand-raise volume and cost), but the graded metric always belongs to the campaign's motion.
3. **The narrative sets the cuts.** The point of view lives in brand Search copy and upper-funnel creative. The three or four themes are the cut for non-brand campaigns, ad groups and asset groups. Products sit inside themes as ad groups or listing groups. Never a campaign per product.
4. **Split only what can learn.** A theme gets its own campaign only when that campaign is expected to clear the conversion floor (30 per 30 days for Search; 50 for PMax, Demand Gen and conversion-bid Video). Below that, it is an ad group or asset group inside a shared campaign.
5. **Brand is isolated.** Brand Search is its own campaign per market; brand terms are negatives in every non-brand Search campaign and a brand exclusion on every PMax campaign. Brand and prospecting performance are never reported as one number.
6. **One owner per query.** Each query has exactly one intended campaign in each market. Overlaps are routed with negatives and exclusions in the design, not left for the auction to settle.
7. **The mapping is a quarterly contract.** Motion and theme assignments change at quarter boundaries, with a decision-log entry. Mid-quarter changes are campaign tuning, not restructures.

## Inputs you need

1. **Business context:** `wiki/company.md`. Business type (picks the framework), products, markets, what a customer is worth, sales motion. Required: if it's missing and the user is present, ask for the business type, products and markets and offer to write the file. In an unattended run, write an `ok`-status finding that names the gap and stop.
2. **Existing structure doc:** `ads/google/strategy/account-structure.md`. Present means Mode C (update), unless the user asks for a fresh design.
3. **Taxonomy:** `ads/taxonomy.md` for the naming schema and campaign groups, if declared.
4. **Media plan and rules:** `ads/media-plan.md` (total budget, markets, strategy) and `ads/google/rules/*.md` (targets per group). Both optional; missing ones mean the skill proposes shares, not amounts.
5. **Platform settings:** `ads/google/index.md` for accounts in scope, `primary_conversion_action` and `brand_terms`.
6. **Memory:** `ads/google/memory/MEMORY.md`. Acknowledged splits ("DE and AT stay separate for legal reasons") are constraints the design keeps.
7. **Recent findings:** `ads/google/findings/` from the last 30 days, especially `google-ads-check-spend-fragmentation`, `google-ads-audit-keyword-cannibalisation` and `google-ads-audit-search-term-cannibalisation`. Reuse their numbers instead of recomputing when they are under 14 days old.
8. **Live data** (Modes B and C): the queries in Mode B, for each account in scope.

## Step 1: Pick the motion framework (every mode)

1. Read the business type from `wiki/company.md` and pick the framework with the table in `references/motion-campaign-map.md`. If it is missing or ambiguous, ask once (the question is in that file) and offer to record the answer.
2. List the four motions and mark which ones Google Ads serves for this business. Motions with no Google Ads role (ecommerce Conversion, growth Activation) are written into the document with the reason, so nobody builds a campaign for them later.
3. For each served motion, fix the **graded-on** metric (from the framework) and the **bids-on** conversion action. Pick the deepest action that will clear the floor, following `references/conversion-anti-patterns.md`; if `primary_conversion_action` is set, start from it. List the account's conversion actions with:

```sql
SELECT
  customer.descriptive_name,
  conversion_action.id,
  conversion_action.name,
  conversion_action.category,
  conversion_action.type,
  conversion_action.status,
  conversion_action.primary_for_goal,
  conversion_action.counting_type
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
```

4. Write down the narrative: one point of view and three or four themes, in buyer language. Take them from `wiki/company.md` or the user's positioning docs. If none exist, propose them from the products and (Mode B) the converting search terms, and ask the user to confirm: themes are a business decision, not a data output.

## Mode A: Bootstrap (new account, or no usable structure)

1. **Draft the campaign map.** For each served motion, list the campaigns the framework calls for, using the campaign-type table in `references/motion-campaign-map.md`. Start from the maximal set: brand Search per market, one non-brand Search campaign per theme per market, competitor Search where the user wants to bid on competitors, PMax or Shopping for retail, gated-content Search for B2B Contact Acquisition, remarketing per motion that needs it, and upper-funnel video where the media plan funds Brand or Authority.
2. **Gather the volume inputs.** For each candidate campaign you need a monthly budget (from the media plan, or a share the user gives), a target CPA (or, for value bidding, a target ROAS and an average order value), and an expected CPC if the budget may exceed demand. Targets come from `ads/google/rules/` or `wiki/company.md` (what a customer is worth); if neither has them, ask. Never invent a CPA.
3. **Allocate budget by motion** with the method in "Budget across motions" below, then within a motion split across its campaigns in proportion to the user's priorities (default: equal per theme, brand sized to its expected demand).
4. **Check each campaign can learn.** Use Python: for each candidate, `expected_conv_30d = monthly_budget / target_cpa`, or `monthly_budget * target_roas / aov` for value bidding. Compare it with the floor for the campaign type (Search 30, PMax 50, Demand Gen 50, conversion-bid Video 50; brand Search on Target impression share and no-conversion reach campaigns are exempt). Print a table: campaign, type, budget, target, expected conversions, floor, passes.
5. **Fold what can't learn.** For every non-brand theme campaign below the floor, merge it into its sibling theme campaign in the same market as an ad group (Search) or asset group (PMax), recompute, and repeat until every conversion-bid campaign passes or only one non-brand campaign per market is left. A single remaining campaign below the floor stays, flagged: start it on Maximize Conversions without a target (per `references/learning-phase-thresholds.md`) and say so in the document. Print the merges made.
6. **Fill in each campaign:** ad groups or asset groups (one per product or sub-theme inside the theme, with its landing page), the routing rules between campaigns, and the start-then-steady bid strategy (new campaigns start on Maximize Conversions or Maximize Conversion Value and add a target after 2 to 4 weeks of stable volume).
7. **Propose the naming schema** (see "Naming schema") and write the draft into the finding.

## Mode B: Audit and restructure (existing account)

Use a 90-day window ending yesterday for performance and a 30-day window for overlap, both as explicit `BETWEEN` ranges. Save every result to disk as the conventions describe.

### B1: Pull the current structure

**Query 1: campaigns and settings** (no metrics, so paused campaigns with history are included)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  campaign.bidding_strategy_type,
  campaign.target_cpa.target_cpa_micros,
  campaign.maximize_conversion_value.target_roas,
  campaign_budget.amount_micros,
  campaign_budget.explicitly_shared,
  campaign.network_settings.target_search_network,
  campaign.network_settings.target_content_network,
  campaign.geo_target_type_setting.positive_geo_target_type
FROM campaign
WHERE campaign.status IN ('ENABLED', 'PAUSED')
```

**Query 2: daily campaign performance** (90 days; daily rows give active days and the 30-day slice)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  segments.date,
  metrics.cost_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status IN ('ENABLED', 'PAUSED')
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
```

When `primary_conversion_action` is set, add the same query with `segments.conversion_action_name` selected and `segments.conversion_action_name = '<primary_conversion_action>'` in the conditions, and use its `metrics.conversions` for every floor check.

**Query 3: what each campaign bids on** (30 days; `metrics.conversions` only counts actions the campaign optimises toward)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  segments.conversion_action_category,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.all_conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query 4: markets.** Positive location targets per campaign, then resolve them, as in `google-ads-audit-keyword-cannibalisation`:

```sql
SELECT customer.descriptive_name, campaign.id, campaign_criterion.location.geo_target_constant
FROM campaign_criterion
WHERE campaign_criterion.type = 'LOCATION'
  AND campaign_criterion.negative = FALSE
  AND campaign.status = 'ENABLED'
```

```sql
SELECT geo_target_constant.resource_name, geo_target_constant.name,
  geo_target_constant.country_code, geo_target_constant.target_type
FROM geo_target_constant
WHERE geo_target_constant.resource_name IN ('<resource names from the query above>')
```

**Query 5: keyword inventory** (no metrics, so keywords with no recent activity are included)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Query 6: keyword performance** (30 days)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  ad_group.id,
  ad_group_criterion.criterion_id,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions
FROM keyword_view
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query 7: search terms** (30 days)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  ad_group.id,
  search_term_view.search_term,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query 8: PMax asset groups** (only when PMax is present)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  asset_group.id,
  asset_group.name,
  asset_group.status,
  metrics.cost_micros,
  metrics.conversions
FROM asset_group
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

**Query 9: audience lists in use** (tells remarketing campaigns from prospecting; only when Display, Demand Gen, Video or PMax is present)

```sql
SELECT customer.descriptive_name, campaign.id, ad_group.id,
  ad_group_criterion.user_list.user_list, ad_group_criterion.negative
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'USER_LIST'
  AND ad_group_criterion.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

```sql
SELECT customer.descriptive_name, user_list.resource_name, user_list.name,
  user_list.type, user_list.size_for_display, user_list.size_for_search
FROM user_list
```

Campaign-level audience criteria (`campaign_criterion.user_list.user_list`) can carry the same lists; query them too if Query 9 returns nothing for a campaign that looks like remarketing by name. PMax audience signals are hints, not targeting, so don't use them to call a PMax campaign remarketing.

**Query 10: PMax brand exclusions.** Use the queries of the health-check entry `pmax-brand-exclusion` (Query B there).

### B2: Build the campaign table

Use Python to load Queries 1 to 4 and build one row per `(customer_id, campaign.id)`:

- `cost_30d`, `cost_90d`, `conv_30d`, `conv_90d` (primary action when configured), `value_30d`, `active_days_90d` (days with cost > 0), CPA = cost / conversions (NaN when 0), ROAS = value / cost.
- `market`: the MarketKey from `references/market-partitioning.md` (location targeting first, then the name's geo token).
- `brand_share_30d`: from Query 7, the share of the campaign's search-term cost on terms containing a brand term (case-insensitive, whole word).
- `bid_categories`: the set of `segments.conversion_action_category` values with `metrics.conversions > 0` in Query 3.
- `audience_role` (Display, Demand Gen and Video only; on Search, user lists are RLSA bid layers, not a remarketing campaign): `remarketing` when every non-negative audience criterion in Query 9 is a user list of type `RULE_BASED`, `LOGICAL` or `CRM_BASED`; `prospecting` when it has none of those; `unknown` otherwise, and step B5 falls back to the name. Whether a list targets or only observes is set per ad group; when it matters, confirm it in the UI or with `google-ads-audit-audience-strategy`.

Print the table sorted by `cost_30d`, with totals per account and market.

### B3: Measure fragmentation

Use Python on the campaign table, per `(customer_id, market)`:

1. **Below-floor share.** Among enabled campaigns on a conversion bid strategy (`TARGET_CPA`, `TARGET_ROAS`, `MAXIMIZE_CONVERSIONS`, `MAXIMIZE_CONVERSION_VALUE`), the share with `conv_30d` below the floor for their type (Search 30, PMax 50, Demand Gen 50, Video 50). Classify with the fragmentation table in `references/learning-phase-thresholds.md`: up to 30% normal, 30–50% fragmented, over 50% severely fragmented. Print the spend share sitting in below-floor campaigns.
2. **Effective number of campaigns.** Per motion (after B5) or per channel type (before it), `n_eff = 1 / sum(s_i ** 2)` where `s_i` is each campaign's share of that group's 30-day cost. Print `n_eff` next to the raw campaign count: 12 campaigns with `n_eff = 2.1` means two campaigns carry the spend and ten are clutter.
3. **Small campaigns.** Count campaigns with `0 < cost_30d < 100` (account currency), as the health-check entry `spend-fragmentation` does.
4. **Ad group shape.** From Queries 5 and 6, keywords per ad group; flag ad groups over 30 keywords (diluted) and under 5 keywords with under 100 impressions in 30 days (clutter), the thresholds of the health-check entry `ad-group-structure`.

If a `google-ads-check-spend-fragmentation` finding is under 14 days old, reuse its classification and say so.

### B4: Measure overlap and cannibalisation

Use Python, within each `(customer_id, market)` only (never across markets):

1. **Keyword overlap.** Normalise keyword text (`strip().lower()`, collapse whitespace). Key = `(customer_id, market, text, match_type)`. A key in more than one campaign is a duplicate. Print the duplicate count, the share of unique keys duplicated, and the 30-day keyword cost on duplicated keys (join Query 6 on `(customer_id, ad_group.id, criterion_id)`).
2. **Query overlap.** From Query 7, group by `(customer_id, market, search_term)`; keep terms served by two or more campaigns. For each, the best campaign is the one with the lowest CPA among those with at least 1 conversion; with no conversions anywhere, the one with the lowest CPC. `non_best_spend = term cost - best campaign's cost on it`. Per market: `NonBestSpendShare = sum(non_best_spend) / sum(cost of overlapping terms)` and `overlap_share = cost of overlapping terms / total Search cost`. `PerfGap = (worst CPA - best CPA) / best CPA` for terms with conversions in two or more campaigns. Tier with the cannibalisation thresholds in `references/priority-tiers.md`, and add the "low data" flag below 20 conversions.
3. **Brand purity.** Non-brand campaigns with `brand_share_30d` above 0 leak brand (any brand cannibalisation is critical in `references/priority-tiers.md`); brand campaigns with more than 20% of cost on non-brand terms are not brand campaigns. PMax campaigns without a brand exclusion (Query 10) count as leaks.
4. **Search vs PMax.** Don't recompute: reuse a recent `google-ads-audit-search-term-cannibalisation` finding or the health-check entry `search-pmax-cross-cannibalisation`, and say which source the numbers came from.
5. **Motion mixing.** Map each conversion category to a motion with the framework's bids-on column (for B2B: `SIGNUP` and `PURCHASE` to A&A, `DOWNLOAD` to Contact Acquisition, `QUALIFIED_LEAD` and `CONVERTED_LEAD` to Demand Generation; hand-raise categories such as `SUBMIT_LEAD_FORM`, `BOOK_APPOINTMENT`, `REQUEST_QUOTE`, `CONTACT` go to whichever motion the user assigned them in step 1). A campaign whose `bid_categories` map to two or more motions is mixed. This is the per-campaign view of the health-check entry `single-campaign-multi-motion-bidding`.

### B5: Map current campaigns onto the target

First design the target with Mode A steps 1 to 6, using the account's own numbers as inputs: observed 90-day CPA or ROAS per group as the starting target (unless the rules files set one), observed spend as the budget baseline. Then use Python to assign every live campaign a target slot, applying the first rule that matches:

1. Name or keywords mark it brand (`brand_share_30d` at or above 80%) → the market's brand Search slot.
2. Keywords or terms mostly contain competitor names (from `wiki/company.md` or the user) → the competitor slot.
3. Search with `bid_categories` in the Contact Acquisition set → the gated-content slot.
4. `audience_role = remarketing` → the remarketing slot for its motion.
5. Video, Display or Demand Gen on a non-conversion bid strategy (`TARGET_CPM`, `MANUAL_CPM`, `MANUAL_CPV`, `TARGET_CPV`; confirm the enum names with `get_resource_metadata`) → the Brand or Authority slot.
6. Non-brand Search → the theme slot whose theme tokens match the most of its keyword text (weighted by keyword cost); ties and zero matches go to `review`.
7. PMax or Shopping → the slot for its market and product or goal split.
8. Nothing matches → `review`, listed for the user.

For each slot, record the action: `keep` (one campaign maps to it and it already fits), `rename` (fits, wrong name), `merge` (several map to one slot), `split` (one campaign maps to several themes with each part above the floor on its own), `new` (no current campaign), or `retire after migration` (its traffic moves elsewhere). In a merge set, the **survivor** is the campaign with the most primary conversions over 90 days: it keeps its history and bid model, and the others' keywords or asset groups move into it. Never pick a brand-new campaign as the destination when an established one can absorb the traffic.

Print the mapping: current campaign, cost 30d, conversions 30d, target slot, action, survivor, reason.

### B6: Plan the migration

Use Python to turn the mapping into ordered steps, each with a learning-phase risk:

- **low:** renames; adding negatives, brand exclusions or routing rules; moving keywords or ad groups into a survivor that keeps its bid strategy and conversion goal and already clears the floor.
- **medium:** a merge where the survivor's 30-day conversions rise by more than 50%, or its budget changes by more than 50%; a target change on the survivor.
- **high:** a step that creates a new campaign replacing established ones, changes a bid strategy, changes the biddable conversion goal, or leaves the destination below the floor.

Then order the steps into waves:

1. **Wave 0, hygiene (no learning impact):** brand exclusions on PMax, brand negatives in non-brand Search, routing negatives between themes, network and location-presence fixes, renames.
2. **Wave 1, brand isolation:** stand up or clean the brand campaign per market.
3. **Wave 2, non-brand consolidation:** merges into survivors, one market at a time, largest spend first.
4. **Wave 3, PMax and Shopping:** asset-group regrouping by theme, listing-group splits.
5. **Wave 4, new programs:** gated-content, remarketing and upper-funnel campaigns that don't exist yet.

Constraints, applied in code:

- **Spend in flux.** Sum the 30-day cost of every campaign a wave touches with medium or high risk. When it exceeds `max_spend_in_flux` (default 30% of account 30-day cost; the user can change it), split the wave in two.
- **Spacing.** Waves start at least 14 days apart, the second-cycle test window in `references/smart-bidding-mechanics.md`. Don't change bid strategy and structure on the same campaign in the same wave.
- **Calendar.** For ecommerce, no medium or high-risk steps in the weeks before the peak window the user names (default: from November 1 through the end of December). Move them to January or earlier.
- **Retire, don't delete.** A campaign marked `retire after migration` is paused only after its survivor has served the moved traffic for 7 days without the survivor's delivery dropping; never removed, so its history stays readable.

For each step, print: wave, start week, step, campaigns touched, cost touched, risk, rollback (what to re-enable or revert if the survivor's CPA rises more than the volatility `references/learning-phase-thresholds.md` describes for the learning phase, judged after the 14-day window).

## Mode C: Update (structure doc exists)

1. Read `ads/google/strategy/account-structure.md` and its decision log.
2. Pull Queries 1 and 2 (30 days is enough) and compare live campaigns with the campaign map in Python: campaigns live but not in the doc, doc rows with no live campaign, campaigns whose bid strategy or conversion goal differs from the doc, and budget share by motion against the doc (drift in percentage points; over 10pp high, 5–10pp medium, under 5pp low, as in `google-ads-create-media-plan`).
3. New product or theme requests: map the product to an existing theme. A request for a fifth theme gets the theme-inflation answer from `references/motion-campaign-map.md`, unless the user is revising the theme set at a quarter boundary.
4. Motion or theme re-mapping inside a quarter is proposed for the next boundary, not applied now, unless the user explicitly decides otherwise; record either way in the decision log.
5. If the doc's period has ended, propose rolling it: rename the old file to `account-structure-<period>.md` with `status: superseded` and write the new one at the canonical path.

## Budget across motions

The framework allocations are for the whole marketing budget, and several motions have little or no Google Ads footprint. Use Python:

1. Take the framework's starting split from `references/motion-campaign-map.md` (use the midpoint of a range unless the user gives a stage skew).
2. Drop motions with no Google Ads campaigns in this design, and renormalise the rest to 100%: `ga_share_m = start_m / sum(start of served motions)`.
3. Apply the user's stage skew (new entrant: earlier motions up; established brand: later motions up) as explicit percentage-point moves, then renormalise.
4. If `ads/media-plan.md` sets a Google Ads total, multiply through to monthly amounts; otherwise report shares only.
5. Mode B and C: print observed 30-day share by motion next to the proposed share, with the drift in percentage points.

Round shares so they sum to exactly 100%. The renormalised split is a starting point the user tunes; say so in the document. Two lines are protected by the frameworks: Authority (B2B) and Brand (B2C) are never the first cut when CAC or pipeline misses. If the user wants to cut them, record the decision in the decision log.

## Naming schema

The structure needs names that carry motion and intent so audits can group campaigns without guessing. Propose it in the finding, coordinated with `google-ads-check-naming-convention` (which owns validating the schema against live names):

- **If `ads/taxonomy.md` already declares a schema,** keep it. Only propose adding Motion and Intent fields where they are missing, at the end of the campaign-level pattern so existing parsing still works.
- **If none is declared,** propose: campaign `<PLATFORM>_<CHANNEL>_<MOTION>_<INTENT>_<THEME>_<GEO>_<LANG>`, all upper case, `_` as the only delimiter, every field present (use `ALL` for a campaign that spans themes), for example `GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_NL_NL`. Motion codes: B2B `AA`, `CA`, `DG`, `AUTH`; ecommerce `BRAND`, `PERF`, `RET`; growth `BRAND`, `ACQ`, `RET`. Intent: `BRAND`, `GENERIC`, `COMP`, `RMK`, `PROSP`. Ad groups: `<PRODUCT-OR-SUBTHEME>` in one token; PMax asset groups: `<THEME>_<OFFER>_<SIGNAL>_<VARIANT>`; Shopping ad groups: the inventory segment.
- **Campaign groups** in `ads/taxonomy.md`: one per campaign group in the motions table (`brand`, `non-brand`, `competitor`, `gated-content`, `pmax`, `shopping`, `remarketing`, `video-brand`, ...), each with its motion and the name rule that matches it. These are the groups `google-ads-create-channel-rules` writes targets for.

After the user adopts the schema, suggest running `google-ads-check-naming-convention` in verify mode to produce the rename table for live campaigns.

## Interpretation and severity

- `high`: severe fragmentation (over 50% of conversion campaigns below the floor) in a market; any brand cannibalisation; a mixed-motion campaign with more than 10% of account spend; NonBestSpendShare of 30% or more.
- `medium`: fragmentation 30–50%; NonBestSpendShare 5–30%; more than four non-brand theme campaigns in a market; an upper-funnel campaign on a conversion bid strategy; motion share drift over 10pp in Mode C.
- `low`: diluted or clutter ad groups; small campaigns; naming that can't carry motion or intent.
- Respect memory: acknowledged splits stay split, and are listed as constraints rather than findings.
- Don't estimate savings. Report the structural condition, the spend involved and the plan; the user judges the impact.

## Output

One finding: `category: structure`, `kind: recommendation`.

**Wrap-up example (Mode B):** *"Acme NL runs 14 Search campaigns but 2 carry 81% of spend (n_eff 2.3); 9 of 12 conversion campaigns are under the 30-conversion floor. Proposed structure: 6 campaigns across A&A and Contact Acquisition, reached in 4 waves over 8 weeks with at most 28% of spend in learning at a time."*

**Wrap-up example (Mode A):** *"Drafted a 5-campaign structure for Acme FR on the B2B framework: brand, two theme campaigns, competitor and a gated-content campaign, with the third theme folded into an ad group because it is expected to reach 14 conversions a month against a floor of 30."*

**General improvements**, for example:
- "Paid signups and report downloads are both biddable goals in Non-Brand Generic NL; split the report promotion into its own Contact Acquisition campaign so each bids on one motion's conversion."
- "No brand exclusion on PMax NL while brand Search exists; add it in wave 0."

**Recommendations:** the migration table (wave, week, step, campaigns touched, spend touched, risk, rollback) in Mode B; the campaign map in Mode A; the drift fixes in Mode C. Show the proposed structure document content.

**Details tables:**

*Current to target mapping*

| account | campaign | type | spend_30d | conversions_30d | market | target_slot | action | survivor | severity | reason |
|---|---|---|---|---|---|---|---|---|---|---|

*Fragmentation by market*

| account | market | conversion_campaigns | below_floor | below_floor_share | spend_below_floor | n_eff | severity |
|---|---|---|---|---|---|---|---|

*Overlap by market*

| account | market | duplicate_keywords | overlapping_terms | overlap_share | non_best_spend_share | brand_leak_spend | severity |
|---|---|---|---|---|---|---|---|

*Budget by motion*

| motion | framework_start | google_ads_renormalised | proposed | observed_30d | drift_pp |
|---|---|---|---|---|---|

**Pending example (Mode B):**
- title: *Restructure Acme NL from 14 to 6 campaigns in 4 waves*
- summary: *9 of 12 conversion campaigns under the floor, 22% of Search spend on queries served by two campaigns, brand terms in 3 non-brand campaigns. Plan keeps the 3 highest-volume campaigns as survivors.*

**Pending example (Mode A):**
- title: *Draft account structure for Acme FR on the B2B framework*
- summary: *5 campaigns across Awareness & Activation and Contact Acquisition; one theme folded into an ad group to clear the 30-conversion floor. Confirm the themes and targets before writing.*

**OK example (Mode C):**
- title: *Account structure current for 2026-Q3; live campaigns match the map*
- summary: *All 7 live campaigns appear in the structure doc with matching bid strategies and goals; motion shares within 4pp of plan; no new overlaps.*
- The body says what was compared and why it passed.

## Workspace writes (when the user confirms)

- The user confirms the design → write `ads/google/strategy/account-structure.md` from `references/account-structure-template.md`, with the decision log's first entry dated today. When a current doc exists, rename it first to `account-structure-<period>.md` with `status: superseded`.
- The user confirms the naming schema and groups → add or update the naming and campaign-group sections in `ads/taxonomy.md`, leaving its UTM section untouched.
- The user confirms the business type or narrative → offer to record them in `wiki/company.md`.
- The user keeps a split the design would merge, for a stated reason → write a memory file under `ads/google/memory/` and a line in `MEMORY.md`.

On an unattended run, write the finding only; put the proposed structure document and taxonomy changes inside it.

## Evidence rule

Every structural claim names the campaigns, the numbers and the rule. *"Non-Brand Shoes NL and Non-Brand Boots NL: Target CPA, 18 and 14 primary conversions in 30 days against the Search floor of 30, same market, both mapped to the 'Outdoor' theme. Merge into Non-Brand Shoes NL (survivor: 61 conversions over 90 days vs 38), combined 32 a month. Risk medium: the survivor's 30-day volume rises 78%."* A theme or motion assignment cites what it rests on: the business type, the keyword-token match, or the user's confirmation.
