---
name: google-ads-build-campaign
description: Turn one planned Google Ads Search or Performance Max campaign, taken from the account structure document or the user's request, into a launch-ready build spec at ads/google/strategy/launch-<slug>.md, covering every setting (networks, locations and presence, languages, bid strategy and starting target, budget, conversion goals, brand exclusions, final URL expansion, ad schedule), ad groups or asset groups, keywords and match types, negatives, assets and extensions, audience signals, UTM tracking and the conversion action, plus a pre-launch QA list tied to health-check IDs, with the budget computed from target CPA and expected volume and keywords deduplicated against existing ones. Use when the user asks to build, set up, launch or spec a new campaign, or to turn a planned campaign into build steps. For deciding which campaigns should exist use google-ads-design-account-structure; for the paid strategy around a product launch use google-ads-evaluate-launch.
---

# Build campaign

> Turn one planned campaign into a spec someone can build in an hour and launch without the usual first-week mistakes: wrong network, wrong goal, brand leaking in, keywords already owned by another campaign, a budget that can never reach the learning floor.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The spec's shape is in `references/launch-spec-template.md`. Conversion floors and the Smart Bidding onboarding path come from `references/learning-phase-thresholds.md`, target-adjustment steps and test windows from `references/smart-bidding-mechanics.md`, markets from `references/market-partitioning.md`, conversion values from `references/value-elicitation.md`, and the first read after launch from `references/stability-windowing.md`.

## Goal

Produce `ads/google/strategy/launch-<slug>.md`: a complete, checked build spec for one Search or Performance Max campaign. Every setting has a value and a reason; every number (budget, target, expected conversions) is computed from the account's own data or the user's inputs; every keyword has been deduplicated and checked against what the account already runs; and the QA list says which health-check entry would catch each mistake after launch.

## Scope

- **One campaign per run,** Search or Performance Max. For Shopping, Demand Gen or Video, say the skill doesn't cover them and fall back to the settings checklist plus the health-check entries for that channel type.
- **Where the campaign comes from:** a row in `ads/google/strategy/account-structure.md` (preferred), the "New campaign candidate" section of a `google-ads-evaluate-launch` strategy doc, or the user's request.
- **Hands off:** keyword discovery to `google-ads-research-keyword-opportunities`, ad copy to `google-ads-write-ad-copy`, tracking implementation to `google-ads-setup-tracking`, choosing the primary conversion to `google-ads-configure-conversion-action`, and deciding which campaigns should exist to `google-ads-design-account-structure`.
- **Read-only.** The skill writes the spec. The user builds the campaign, ideally paused, and launches it after the QA list passes.

## Inputs you need

1. **The campaign's slot:** its row in `ads/google/strategy/account-structure.md` (motion, theme, market, type, bid strategy, conversion goal, budget share, routing rules). Without a structure doc, ask the user for the minimum: motion or purpose, theme, market and language, campaign type, what it should bid on, and the budget or target. Offer `google-ads-design-account-structure` if the user is unsure which campaigns they need.
2. **Business context:** `wiki/company.md` (products, what a customer is worth, competitors, brand voice pointers).
3. **Taxonomy:** `ads/taxonomy.md` for the naming schema and the UTM schema. Missing: use the defaults in step 9 and say so.
4. **Rules and plan:** `ads/google/rules/<group>.md` for the target CPA or ROAS, `ads/media-plan.md` for the budget allotment.
5. **Platform settings:** `ads/google/index.md` for the account, `primary_conversion_action` and `brand_terms`.
6. **Memory:** `ads/google/memory/MEMORY.md`, for constraints such as "no Search partners in DE" or "'free trial' is a valid term".
7. **Keyword candidates:** the user's list, a recent `google-ads-research-keyword-opportunities` finding, or the launch strategy doc. If there are none, run or suggest that skill first; don't invent keyword lists.
8. **Live data:** the queries in step 2, for the account the campaign will run in.

## Step 1: Frame the campaign

Restate the campaign in one short block and confirm it with the user before building (in an unattended run, proceed and list the assumptions under Open questions):

- Name per the taxonomy schema; slug for the file name (lower case, `_` to `-`).
- Motion, the metric it is graded on, the conversion it bids on.
- Theme and message; the queries it owns and the ones that belong to other campaigns (brand, competitor, sibling themes).
- Market (country or region) and language.

Two framing checks, in order:

1. **Does it serve one motion?** If the request mixes, for example, a demo request and a report download as goals, split it into two specs or drop one goal. One campaign, one motion.
2. **Should it be a campaign at all?** That is decided in step 4: a theme that can't reach the conversion floor on its own is better built as an ad group (Search) or asset group (PMax) inside an existing campaign. The spec then covers that ad group or asset group instead.

## Step 2: Pull the account context

Run for the target account. Use a 90-day window ending yesterday for performance, written as an explicit `BETWEEN` range.

**Query A: existing keywords** (no metrics, so every enabled keyword is listed)

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
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

**Query B: search terms** (90 days, every Search campaign)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  search_term_view.search_term,
  search_term_view.status,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
```

**Query C: comparable campaigns** (90 days, one row per campaign; impression share is a ratio, so leave `segments.date` out of `SELECT`)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type,
  campaign.bidding_strategy_type,
  campaign_budget.amount_micros,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.search_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
```

When `primary_conversion_action` is set, run the primary-action variant from the conventions (`segments.conversion_action_name` selected and filtered) and use its conversions.

**Query D: markets of existing campaigns** (positive location targets; resolve with `geo_target_constant` as in `google-ads-audit-keyword-cannibalisation`)

```sql
SELECT customer.descriptive_name, campaign.id, campaign_criterion.location.geo_target_constant
FROM campaign_criterion
WHERE campaign_criterion.type = 'LOCATION'
  AND campaign_criterion.negative = FALSE
  AND campaign.status = 'ENABLED'
```

**Query E: conversion actions and account goals**

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

```sql
SELECT customer_conversion_goal.category, customer_conversion_goal.origin,
  customer_conversion_goal.biddable
FROM customer_conversion_goal
```

Add the per-action daily conversions for the last 14 days (`FROM campaign`, `segments.date` and `segments.conversion_action_name` selected, `metrics.all_conversions`) to see whether the action the campaign will bid on is recording.

**Query F: shared negative lists and where they are applied**

```sql
SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.member_count, shared_set.status
FROM shared_set
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  AND shared_set.status = 'ENABLED'
```

```sql
SELECT campaign.id, campaign.name, campaign_shared_set.shared_set, campaign_shared_set.status
FROM campaign_shared_set
WHERE campaign_shared_set.status = 'ENABLED'
```

```sql
SELECT shared_set.id, shared_criterion.keyword.text, shared_criterion.keyword.match_type
FROM shared_criterion
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
```

Account-level negatives: the query of the health-check entry `account-negatives`.

**Query G: audience lists**

```sql
SELECT user_list.id, user_list.name, user_list.type, user_list.membership_status,
  user_list.size_for_search, user_list.size_for_display
FROM user_list
```

**Query H: account-level assets and tracking**

```sql
SELECT customer_asset.asset, customer_asset.field_type, customer_asset.status
FROM customer_asset
WHERE customer_asset.status = 'ENABLED'
```

```sql
SELECT customer.descriptive_name, customer.auto_tagging_enabled,
  customer.final_url_suffix, customer.tracking_url_template
FROM customer
```

For PMax, also run the queries of the health-check entries `pmax-brand-exclusion` (to see whether a brand list is already used elsewhere) and `auto-apply-settings`.

Use Python to load every result with a `customer_id` column, convert micros, and resolve each existing Search campaign's market with `references/market-partitioning.md`. **Comparable campaigns** are the enabled campaigns of the same channel type in the same market and campaign group (from the taxonomy or the structure doc), excluding brand campaigns unless the new campaign is brand. If none exist in the market, widen to the same group in other markets with the same language, and say so.

## Step 3: Settings checklist

Fill one row per setting. Defaults below; the structure doc or memory can override them, with the reason recorded.

**Search**

| Setting | Default | Why |
|---|---|---|
| Networks | Google Search on; Search partners off at launch; Display Network off | Display inside Search is the most common silent waste (`network-leak-on-search`). Partners get tested later against Search CPA (`search-partner-roas`). |
| Locations | The market's countries or regions, Presence only ("people in or regularly in") | Interest-based targeting serves people you can't sell to (`geo-targeting-type`). |
| Languages | The language of the ads and landing page | A French ad shown to an English-language browser rarely converts. One campaign per language in multilingual markets. |
| Bid strategy and target | Step 4 | |
| Budget | Step 4 | |
| Conversion goals | Campaign-specific goal set to the one conversion the motion bids on, when it differs from the account default | One motion per campaign (`single-campaign-multi-motion-bidding`, `correct-campaign-goals`). |
| Ad schedule | All hours, every day | Smart Bidding prices time of day itself. Restrict only to business hours when the conversion is a phone call that needs someone to answer. |
| Ad rotation | Optimise | (`ad-rotation-mode`) |
| Broad match and automated expansion | Off at launch (exact and phrase only); AI Max or similar query and URL expansion off | Expansion is earned once the campaign clears the floor and the search terms are clean. Its URL expansion carries the same risk as PMax's. |
| Brand handling | Brand terms as exact and phrase negatives (non-brand campaigns); brand campaign owns them | (`search-brand-leak`) |
| Start state | Built paused; enabled after the QA list passes | |

**Performance Max** (rows that differ from Search)

| Setting | Default | Why |
|---|---|---|
| Bid strategy | Maximize conversions or Maximize conversion value; target added later (step 4) | PMax needs 50 conversions in 30 days to learn. |
| Customer acquisition | Ecommerce Performance motion: bid higher for new customers, with an existing-customer Customer Match list of 1,000+ members | Without the list the goal does nothing (`nca-goal-config`). |
| Brand exclusions | The account's brand list applied | PMax otherwise takes brand traffic and flatters its ROAS (`pmax-brand-exclusion`). |
| Final URL expansion | Off for lead generation and brand-controlled landing pages; on only as a deliberate choice for broad ecommerce catalogues, with URL exclusions for blog, careers and support pages | (`pmax-final-url-expansion`) |
| Listing groups (with a feed) | Split by the structure doc's cut (category, margin tier, stock label); no single catch-all at one target | (`shopping-catch-all-groups`, `pmax-product-matrix`) |
| Asset groups | One per theme or product cut (step 5) | |

## Step 4: Starting budget and bid target

Use Python. Inputs, each with its source printed:

- `T`: target CPA from `ads/google/rules/<group>.md` or the user. For value bidding, take target ROAS `R` and average order value `AOV` and use `T = AOV / R`. If neither exists, ask; for how to set the value, follow `references/value-elicitation.md`.
- `F`: the conversion floor (Search 30, PMax 50, per `references/learning-phase-thresholds.md`).
- `B_plan`: the monthly allotment from the structure doc's budget share times the media plan's Google Ads total, or the user's figure. May be unknown.
- Demand, from the best source available, in this order:
  1. **Keyword Planner volumes the user pastes:** `clicks = sum(monthly_searches) * IS_comp * CTR_comp`, where `IS_comp` is the comparable campaigns' search impression share and `CTR_comp` their CTR (clicks / impressions, summed over the comparables before dividing).
  2. **Search terms already in the account:** filter Query B to terms matching the planned keywords (exact text, or phrase containment for phrase keywords). Their 90-day clicks / 3 is a floor on monthly clicks the new campaign will see, because it only counts traffic that already arrives.
  3. **Neither:** ask the user for an expected monthly click or conversion volume, or set the budget from the floor alone and label demand as unknown.
- `CPC_comp` = comparable cost / clicks; `CVR_comp` = comparable conversions / clicks. When the search terms from source 2 have at least 20 conversions, use their own CPC and CVR instead.

Compute:

```python
monthly_clicks = ...                        # from the demand source
expected_conv = monthly_clicks * CVR
demand_spend  = monthly_clicks * CPC        # what the demand can absorb
floor_spend   = F * T                       # spend needed to reach the floor at target
recommended   = min(B_plan, demand_spend) if B_plan else demand_spend
daily_budget  = recommended / 30.4
implied_cpa   = recommended / expected_conv if expected_conv else float("nan")
```

Decide, and print the decision with the numbers:

- `demand_spend < floor_spend`: the theme can't reach the floor on its own even with unlimited budget. Recommend building it as an ad group or asset group in the nearest existing campaign of the same motion and market. If the user still wants a campaign, launch on Maximize conversions without a target and say it will not leave learning at this volume.
- `B_plan` known and `B_plan < floor_spend`: underfunded. Either raise the allotment to `floor_spend`, fold the theme into an existing campaign, or launch on Maximize conversions without a target and accept the volatility.
- Otherwise: budget `daily_budget`, expected conversions `expected_conv`.
- When `implied_cpa` is more than 25% above `T`, say the target is unlikely to hold at launch and why (CPC or CVR of the comparables).

Google can spend up to twice the daily budget on a single day while keeping the month to about 30.4 times the daily budget; tell the user so daily spend above the budget in week one isn't read as an overspend.

**Bid strategy path** (from `references/learning-phase-thresholds.md` and `references/smart-bidding-mechanics.md`; once the campaign has history, `google-ads-choose-bid-strategy` manages targets and migrations):

- **New campaign, no history on this goal:** Maximize conversions (or Maximize conversion value) without a target. After 2 to 4 weeks of stable volume at or above the floor, add a target at the observed CPA (or ROAS), not the aspirational one, then tighten 5–10% per step with 7–14 days between steps.
- **Campaign inheriting traffic from an established campaign** (a split or migration in the structure doc, where the source clears the floor on the same goal): a target can start on day one at the source's 30-day CPA loosened by 10–15%, the low-volume step in `references/smart-bidding-mechanics.md`.
- **Brand Search:** Target impression share with a maximum CPC cap when the goal is presence on your own name; Maximize conversions when brand volume is what clears the account's floor. Record which.
- **Never** start a new campaign on a tight target set from the business goal: it suppresses auction entry before learning begins.

**Learning-phase guidance for the spec's "After launch" table:** no bid, target, goal or budget changes in the first 7 days; first CPA read at day 14 with the stability rules (`references/stability-windowing.md`); one change at a time, never bid strategy and conversion goal together (`bid-strategy-churn` catches the pattern).

## Step 5: Ad groups or asset groups

- **Search:** one ad group per product or sub-theme inside the campaign's theme, each with one landing page whose content matches it. Target 5 to 30 keywords per ad group (`ad-group-structure`). No single-keyword ad groups except for a proven high-volume term; no ad group per match type.
- **PMax:** one asset group per theme or product cut, each with its own final URL, audience signal and search themes. Don't split asset groups by audience alone: audience signals are hints, not targeting.
- For each group record: name per the taxonomy, landing page, the theme message the copy must carry, and (PMax) the listing-group filter.

Check every landing page loads before launch: fetch each final URL and record the HTTP status and the final URL after redirects; a redirect to the homepage or a 4xx or 5xx fails (`lp-reachability`). If the agent can't fetch pages, put this on the QA list for the user.

## Step 6: Keywords and match types (Search)

Use Python on the candidate list:

1. **Parse.** Accept `[exact]`, `"phrase"` and bare broad syntax; strip the syntax into a `match_type` column. Normalise text: `strip().lower()`, collapse whitespace.
2. **Validate.** Flag keywords longer than 80 characters or 10 words (Google's limits), and characters other than letters, digits, spaces, `&`, `'`, `-` and `.` for review: Google rejects some symbols and ignores most punctuation.
3. **Route out what belongs elsewhere.** Keywords containing a brand term (whole word, case-insensitive) go to the brand campaign; keywords containing a competitor name go to the competitor campaign; keywords matching a sibling theme's tokens better than this one's go to that theme. Print each move.
4. **Deduplicate.** Drop exact duplicates of `(text, match_type)`. If the same text sits in two ad groups of the new campaign, keep it in the ad group whose name and landing page match more of its tokens. Group near-duplicates by a key of sorted tokens with a trailing plural `s` removed from tokens longer than 3 characters; exact match already covers close variants, so keep one keyword per near-duplicate group (prefer the one with search-term history in Query B) and list the rest as redundant.
5. **Overlap with existing keywords.** Join on `(customer_id, market, text)` against Query A restricted to campaigns in the same market. For every collision record the existing campaign, ad group and match type, and an action: `move` (the structure doc assigns the query to the new campaign: pause it in the old ad group at launch), `negative in old` (add an exact negative in the old campaign once the new one is serving), or `drop from plan` (the old campaign owns it). Without a structure doc, the owner is the campaign whose theme the keyword fits; ask the user when it is unclear. Leaving the same keyword live in two campaigns of one market is not an option: it is what `keyword-cannibalisation` flags.
6. **Overlap with search terms.** Planned keywords that already arrive as search terms in other campaigns (Query B) with conversions are evidence for the keyword and a routing task: list the campaigns where the term converts today, its 90-day clicks, cost and conversions, and the negative that will hand it over once the new campaign serves.
7. **Match types at launch:** exact for the proven and high-intent terms, phrase for the core theme terms. Broad only when the user asks for it and the comparable campaigns clear the floor on Smart Bidding; record the reason. For the trade-offs, see `google-ads-audit-match-type-strategy`.

Print the final table: ad group, keyword, match type, source (user list, research finding, search term), overlap, action. Print counts per ad group against the 5–30 band.

## Step 7: Negatives

Build the negative set from five sources:

1. **Shared lists** the comparable campaigns already use (Query F): attach the same lists unless they contain this campaign's own terms.
2. **Account-level negatives** already apply; note them, don't duplicate them.
3. **Brand and competitor terms** as exact and phrase negatives (non-brand campaigns).
4. **Sibling-theme routing:** each sibling theme's core terms as exact negatives, from the structure doc's routing rules.
5. **Known waste:** terms in Query B with clicks and no conversions that contain the theme's tokens but the wrong intent (jobs, free, definitions, DIY), read against `wiki/company.md` and memory. For the full method see `google-ads-check-search-terms` and `google-ads-audit-negative-strategy`.

Then use Python to check no negative blocks a planned positive, the logic of the health-check entry `negative-keyword-conflicts`: an exact negative blocks a keyword with identical normalised text; a phrase negative blocks a keyword whose token sequence contains the negative's tokens contiguously and in order; a broad negative blocks a keyword containing all of its tokens in any order. Negatives don't match close variants, so compare normalised text only. Print every conflict; fix the plan before writing the spec.

**PMax:** negatives go in the account-level negative list or a campaign negative list where the account supports it; brand handling uses the brand exclusion, not negatives.

## Step 8: Assets and extensions

Required counts, taken from the health-check entries, plus Google's field limits:

| Asset | Campaign type | Minimum | Field limits | Check |
|---|---|---|---|---|
| Responsive search ad | Search, per ad group | 1 RSA with 15 headlines and 4 descriptions, Good ad strength or better | Headline 30 characters, description 90, path 15 each | `missing-rsa`, `ad-strength-rsa` |
| Sitelinks | Search, PMax | 4 | Link text 25, description lines 35 each | `ad-extensions` |
| Callouts | Search, PMax | 4 | 25 | `ad-extensions` |
| Structured snippet | Search, PMax | 1 header with 3 or more values | Value 25 | `ad-extensions` |
| Call, image, logo, business name | Search, PMax | 6 distinct asset types across the set | Business name 25 | `asset-type-coverage` |
| Lead form | Contact Acquisition campaigns | 1 when the motion collects records | | |
| PMax asset group text | PMax | 5 headlines, 4 descriptions (Google allows up to 15 and 5) | Headline 30, long headline 90, description 90 with at least one at 60 or under | `asset-coverage`, `ad-strength-pmax` |
| PMax asset group visuals | PMax | 4 images (landscape and square at least), 1 square logo, 1 video | | `asset-coverage` |

Account-level assets from Query H also serve; list them so the spec only adds what is missing at campaign level. Promotion assets get an end date.

The copy itself is written by `google-ads-write-ad-copy`. Hand it the theme message, the point of view, the product, the landing page, the motion's offer and the brand voice files. When copy comes back (or the user pastes their own), use Python to check every field: character count against the limit, count per field against the minimum, duplicate lines within an ad or asset group, and pins (flag more than 2 pinned headlines per position). Print a pass or fail table per ad group or asset group.

## Step 9: Audiences

- **Search:** attach audiences in observation mode, not targeting: website visitors and customer lists from Query G with `size_for_search` of 1,000 or more and `membership_status = 'OPEN'` (smaller or closed lists don't serve; `customer-match-list-health`, `rlsa-configured`), plus one or two in-market segments matching the buyer. They give bidding signals without narrowing reach (`audience-targeting-mode`).
- **PMax audience signals:** per asset group, a Customer Match list of converters, a custom segment built from this theme's converting search terms in Query B (top 10 to 20 by conversions), and website visitors of the theme's pages. At least one signal per asset group (`pmax-audience-signals`).
- **Exclusions:** existing customers when the motion is acquisition-only and the list exists; obvious demographic misfits only (`demographic-exclusions`).

## Step 10: Tracking

1. **Conversion action.** The action the campaign bids on (Query E) is enabled, set as primary or included in the campaign-specific goal, and counted correctly: once per click for leads and signups, every conversion for purchases (`conversion-action-health`). It recorded conversions in the last 7 days (`conversions-flowing`). If it is new or silent, don't launch on it: fix tracking first with `google-ads-setup-tracking` or `google-ads-configure-conversion-action`. Check it is the deepest action that clears the floor (`primary-event-quality`).
2. **Auto-tagging** on (`auto-tagging-disabled`). Any tracking template contains `{lpurl}` (`tracking-template-sanity`).
3. **UTMs.** Use the UTM schema in `ads/taxonomy.md`. Without one, the defaults of `google-ads-check-utm-tagging`: a campaign-level final URL suffix `utm_source=google&utm_medium=paid_search&utm_campaign=<campaign name, lower case>&utm_term={keyword}&utm_content={creative}`, with `utm_medium=performance_max` for PMax. Never `{campaignid}` as `utm_campaign` (`utm-tagging`).
4. **Name** follows the taxonomy (`naming-convention`), so the campaign lands in the right group in every report from day one.

## Step 11: Pre-launch QA

Build the QA list from the spec. Each item names the setting, the pass condition and the health-check entry that would flag it after launch. Mark each `pass`, `fail` or `user to verify` (things the API can't see before the campaign exists).

| Area | Pass condition | Health-check ID |
|---|---|---|
| Networks | Display off; partners off or a deliberate test | `network-leak-on-search` |
| Locations | Presence only | `geo-targeting-type` |
| Goal | One motion's conversion; conversion bidding on PMax | `single-campaign-multi-motion-bidding`, `correct-campaign-goals` |
| Bidding | No target until the floor is cleared, unless inheriting history | `smart-bidding-cold-start` |
| Conversion action | Enabled, recording, right counting type, deepest viable event | `conversion-action-health`, `conversions-flowing`, `primary-event-quality` |
| Tracking | Auto-tagging on; template with `{lpurl}`; UTMs per schema | `auto-tagging-disabled`, `tracking-template-sanity`, `utm-tagging` |
| Brand | Brand negatives in non-brand Search; brand exclusion on PMax | `search-brand-leak`, `pmax-brand-exclusion` |
| URL expansion | Off unless deliberately on | `pmax-final-url-expansion` |
| Keywords | No keyword live in two campaigns of the market; 5–30 per ad group | `keyword-cannibalisation`, `ad-group-structure` |
| Negatives | No conflict with positives; shared lists attached | `negative-keyword-conflicts`, `negative-kw-coverage` |
| Ads | RSA per ad group at Good or better; PMax asset minimums | `missing-rsa`, `ad-strength-rsa`, `asset-coverage`, `ad-strength-pmax` |
| Assets | 4 sitelinks, 4 callouts, 1 snippet, 6 asset types | `ad-extensions`, `asset-type-coverage` |
| Audiences | Observation lists on Search; a signal per asset group; usable list sizes | `rlsa-configured`, `pmax-audience-signals`, `customer-match-list-health` |
| New customers | NCA goal only with a 1,000+ existing-customer list | `nca-goal-config` |
| Landing pages | Every final URL returns 200 without redirecting to the homepage | `lp-reachability` |
| Account | Auto-apply off or limited; account budget order has room for the new spend | `auto-apply-settings`, `account-budget-cap` |
| Routing elsewhere | Negatives and keyword pauses in other campaigns scheduled for launch day | `search-pmax-cross-cannibalisation` |

After launch, suggest running `google-ads-health-check` on these IDs at day 7 and day 14, and `google-ads-check-search-terms` at day 7.

## Output

Write the spec and one finding: `category: structure`, `kind: recommendation`.

**Wrap-up example:** *"Spec ready for GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_FR_FR: 4 ad groups, 62 keywords after removing 9 duplicates and routing 5 brand terms out, €103/day from demand-capped spend, about 40 conversions a month against the floor of 30. 3 existing keywords move from Non-Brand Generic FR at launch."*

**General improvements**, for example:
- "Paid signup recorded 0 conversions in the last 7 days; fix tracking before launch or the campaign bids blind."
- "No UTM schema in `ads/taxonomy.md`; the spec uses the defaults. Run `google-ads-check-utm-tagging` to declare one."

**Recommendations:** the build steps in order (create paused, settings, ad groups, keywords, negatives, assets, audiences, tracking, routing changes in other campaigns, QA, enable), as a table: step, entity, value, reason.

**Details tables:**

*Budget computation*

| input_or_output | value | source |
|---|---|---|

*Keyword overlap*

| account | planned_keyword | match_type | existing_campaign | existing_ad_group | existing_match_type | search_term_conv_90d | action |
|---|---|---|---|---|---|---|---|

*QA*

| area | item | result | health_check_id | note |
|---|---|---|---|---|

**Pending example:**
- title: *Launch spec for Non-Brand Ship Faster FR: €103/day, 62 keywords, 2 QA items open*
- summary: *Expected 40 conversions a month against a floor of 30 at €95 target CPA. Landing page /fr/pipelines redirects to the homepage, and 3 keywords need pausing in Non-Brand Generic FR at launch.*

**Pending example (fold instead of build):**
- title: *Build 'Trust the numbers' as an ad group, not a campaign*
- summary: *Demand caps spend at €1,150 a month against €2,850 needed to reach 30 conversions at €95 CPA. Proposed as an ad group in Non-Brand Generic FR with the same keywords and copy.*

**OK example:**
- title: *Launch spec for Brand FR passes every pre-launch check*
- summary: *All 17 QA items pass against the account's current state; budget €40/day sized to 90-day brand demand; no keyword overlap.*

## Workspace writes (when the user confirms)

- Write `ads/google/strategy/launch-<slug>.md` from `references/launch-spec-template.md` with `status: draft`; set `status: ready` when every QA item passes, and `launched` when the user says it is live.
- If the file already exists because `google-ads-evaluate-launch` wrote a strategy for a launch with the same slug, don't overwrite it: add a `## Build spec: <campaign name>` section to it. If an earlier build spec for the same campaign exists, append a dated `## Update YYYY-MM-DD` section.
- If the campaign is new to the structure, offer to add its row to `ads/google/strategy/account-structure.md` (status `new`) with a decision-log line.
- A constraint the user states ("never Search partners in this market") → a memory file under `ads/google/memory/` and a line in `MEMORY.md`.

On an unattended run, write the finding with the spec inside it; don't write the strategy files.

## Evidence rule

Every number in the spec names its source and inputs: *"€103/day: 1,300 clicks a month (keyword volumes × 41% search impression share × 6.2% CTR of 3 comparable campaigns in FR) × €2.40 CPC = €3,120, under the €3,500 allotment and above the €2,850 needed for 30 conversions at €95."* Every overlap names the existing campaign, ad group, keyword and match type. Every default that was overridden names who or what overrode it.
