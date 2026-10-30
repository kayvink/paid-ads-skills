# Video checks

These checks cover Video campaigns (`campaign.advertising_channel_type = 'VIDEO'`), plus `video-attribution-model`, which reads the account's conversion actions. Missing frequency caps on Video are flagged by `frequency-caps` in `display.md`. Shared setup for every check in this file:

- **Windows.** "Last N days" means the N days ending yesterday: `segments.date BETWEEN '<start>' AND '<end>'` with `<end>` = yesterday and `<start>` = yesterday minus N−1 days. Most checks use 30 days; `video-learning-stuck` uses 14 and the two spend checks use 7. Queries that do not select `segments.date` return one row per entity aggregated over the window; keep it that way unless the entry says otherwise.
- **Accounts.** Run each query for every account in scope. Every query adds `customer.descriptive_name`, plus `customer.currency_code` where money is selected. Report accounts by name.
- **Standard aggregation.** Load each result with a `customer_id` column, cast metrics, set `cost = metrics.cost_micros / 1e6` (same for `campaign_budget.amount_micros`). When an entry says "aggregate per campaign", group by `(customer_id, campaign.id)`, take name and settings fields from the first row, and sum the additive metrics. Skip rows whose entity ID is empty.
- **Statistics.** `median`: middle value of the sorted list, mean of the two middle values for an even count, 0 for an empty list. `MAD`: median of `|x - median|`, 0 for fewer than 2 values.
- **Status reasons.** `campaign.primary_status_reasons` arrives as a list (or a comma-separated string: split, trim, upper-case).
- **Status.** Each check produces at most one observation, with the status named in its Result. No offending rows means **ok**, including when there are no Video campaigns in scope (say so in the report). **unknown** means the primary query (Query A unless stated) failed on every account and returned no rows; report the error per account. If only some accounts failed, evaluate the rest and name the failed accounts. Errors on a secondary query do not make the check unknown: treat that account as having no rows from it.
- **Money in messages.** Round row-level spend to 2 decimals. Totals in messages are rounded to whole units; sum them per currency when accounts use different currencies.

## Video bidding readiness

- **ID:** `video-bidding-readiness`
- **Category:** bidding · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each Video campaign on a target-based smart bidding strategy has at least 50 conversions in 30 days. Below that, Video tCPA/tROAS spends without a learnable signal; Maximize Conversions is the better starting point until volume catches up.
- **Settings:** `minConversions` = 50 (30-day conversions below which target-based bidding lacks signal on Video; negative values are treated as 0).

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.bidding_strategy_type, metrics.cost_micros, metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend and conversions = sums; strategy = first row's `bidding_strategy_type`, upper-cased.
2. Flag campaigns with strategy `TARGET_CPA` or `TARGET_ROAS` and conversions < `minConversions`. Sort by spend descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns on target-based bidding without enough signal": "<n> Video campaigns are running on Target CPA or Target ROAS with fewer than <minConversions> conversions in 30 days. The bidder is being asked to hit a target it doesn't have enough data to learn; it spends the budget regardless, often inefficiently." Table (first 20): account, campaign, current strategy, 30-day conversions (1 decimal), spend.
- **Action:** Switch to Maximize Conversions (no target) until 30-day conversion volume passes the threshold. Once it does, layer the target back in and let the bidder ease into it. As a backstop, if Video conversions are sparse because of attribution-window issues, lengthen the engaged-view window before switching strategies.

## Video companion banners

- **ID:** `video-companion-banner`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every desktop-eligible Video ad has a custom 300×60 companion banner. The companion is the one piece of persistent real estate next to the video player; the auto-generated version pulls from your channel banner, which is rarely tuned to the campaign.
- **Settings:** none.

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type,
  ad_group_ad.ad.video_responsive_ad.companion_banners, metrics.cost_micros
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND ad_group_ad.ad.type IN ('VIDEO_RESPONSIVE_AD', 'IN_FEED_VIDEO_AD')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per ad (`ad_group_ad.ad.id`): spend = sum of cost; has companion = first row's `companion_banners` is a non-empty list (if a string, parse as JSON; if parsing fails, a non-empty string other than `[]` counts).
2. Flag ads of type `VIDEO_RESPONSIVE_AD` without a companion (in-feed ads are queried but never flagged). Sort by spend descending.

**Result**

- **opportunity:** at least one ad. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video ads without custom companion banners": "<n> Video Responsive Ads have no custom 300×60 companion banner attached. Google auto-generates a banner from your YouTube channel header: useful as a fallback, weak as a deliberate placement." Table (first 30): account, campaign, ad group, ad ID, spend.
- **Action:** Design a 300×60 companion banner per ad group with the campaign's CTA and message. It takes 10 minutes per ad and the desktop CTR lift is usually noticeable.

## Video asset coverage

- **ID:** `video-asset-coverage`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Video Action campaigns (running on conversion-based bidding) have at least one sitelink and one callout attached. Both extensions are mobile-eligible on Video Action and demonstrably lift CTR.
- **Settings:** none.

**Queries**

Query A (campaigns), last 30 days:

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.bidding_strategy_type, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND campaign.bidding_strategy_type IN ('TARGET_CPA', 'TARGET_ROAS', 'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B (campaign assets), last 30 days:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name, campaign.status,
  campaign.advertising_channel_type, campaign_asset.asset, campaign_asset.field_type,
  metrics.cost_micros
FROM campaign_asset
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND campaign_asset.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate Query A per campaign: spend = sum of cost.
2. For each Query B row whose `(customer_id, campaign.id)` is in Query A, mark the campaign as having sitelinks when the upper-cased `field_type` is `SITELINK`, callouts when it is `CALLOUT`. Query B rows for campaigns not in Query A are ignored.
3. Flag campaigns missing sitelinks, callouts, or both. Sort by spend descending.

**Result**

- **opportunity:** at least one campaign. **ok:** otherwise.
- **unknown:** Query A failed on every account.
- **Report:** "Video Action campaigns without full asset coverage": "<n> Video Action campaigns are missing sitelinks, callouts, or both. On mobile, these extensions surface below the video player: free real estate that lifts CTR." Table (first 20): account, campaign, missing sitelinks (yes/no), missing callouts (yes/no), spend.
- **Action:** Add 4 to 6 sitelinks pointing to the most relevant non-homepage destinations (category pages, lead forms, top products) and 4 to 6 callouts (concrete value props, not slogans). They live on the campaign, so updating once benefits every ad.

## Video completion drop-off

- **ID:** `video-completion-dropoff`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** The ratio of 100% completion to 25% completion stays above 0.20. Some drop-off is normal (skippable formats invite skipping), but a campaign where 70% reach 25% and 5% reach 100% has a creative retention problem, not a bidding problem.
- **Settings:** `minCompletionRatio` = 0.2 (flag when p100 rate / p25 rate falls below this; 0.2 means 1 in 5 viewers who reached 25% made it to the end; 0 or invalid becomes 0.2); `minImpressions` = 5000 (skip campaigns with fewer 30-day impressions). Constant: the campaign's p25 rate must be ≥ 0.30 to be judged.

**Queries**

Last 30 days, no `segments.date` in the select (one row per campaign).

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate,
  metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate,
  metrics.impressions, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per campaign: mean p25 and mean p100 = unweighted means of the rate columns over its rows (with one row per campaign, the row's values; rates are 0 to 1 fractions); impressions and cost = sums.
2. Skip campaigns with impressions < `minImpressions` or mean p25 < 0.3. Ratio = mean p100 / mean p25. Flag when ratio < `minCompletionRatio`.
3. Sort by ratio ascending (worst first).

**Result**

- **opportunity:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video creatives losing viewers mid-watch": "<n> Video campaigns have a 100%-to-25% completion ratio below <minCompletionRatio, 2 decimals>. People are starting to watch but bailing well before the end; the creative isn't keeping them." Table (first 20): account, campaign, p25 % and p100 % (1 decimal), completion ratio (2 decimals), spend. Metric: campaigns affected.
- **Action:** Audit the creative against the drop-off pattern: if the cliff is between 25% and 50%, the mid-section is the problem (slow buildup); if it's between 75% and 100%, the closer or CTA is dragging. Either way, the lever is the creative, not bidding. Test a shorter cut: a 15s version of a 30s ad often wins on completion economics.

## Video creative fatigue

- **ID:** `video-creative-fatigue`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each active Video campaign's view rate stays within 25% of its prior 23-day baseline. Below that, audiences have seen the creative enough times to disengage; the lever is fresh creative, not a frequency tweak.
- **Settings:** `maxDeclinePct` = 25 (flag when the recent 7-day view rate is more than this percent below the prior baseline); `minBaselineViewRate` = 15 (percent; skip campaigns whose prior view rate was already below this); `minImpressions` = 5000 (minimum prior-window impressions). Negative values are treated as 0.

**Queries**

Last 30 days, daily.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  segments.date, metrics.video_trueview_view_rate, metrics.impressions, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Keep rows with a campaign ID and a date. Campaign spend = sum of cost over the window.
2. Collect the distinct dates across all campaigns and accounts and sort them. Split date = the 8th date from the end; with fewer than 8 dates nothing can be compared and the result is ok. Recent dates = dates after the split date (the last 7); prior dates = the split date and everything before.
3. Per campaign and window: view rate = unweighted mean of the daily `video_trueview_view_rate` values (sum of rates / number of rows); impressions = sum.
4. Skip campaigns with prior impressions < `minImpressions`, or no rows in either window. Skip when prior view rate ≤ 0 or prior view rate × 100 < `minBaselineViewRate`.
5. Decline % = (prior − recent) / prior × 100. Flag when decline % > `maxDeclinePct`. Sort by decline % descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns showing creative fatigue": "<n> Video campaigns saw view rate fall by more than <maxDeclinePct>% from their prior 23-day baseline in the last 7 days. Same audience, same creative, falling engagement: the classic fatigue signature." Table (first 20): account, campaign, recent view rate % and prior view rate % (2 decimals), decline % (1 decimal), spend. Metric: campaigns affected.
- **Action:** Refresh creative rather than tweaking targeting. Even a re-cut of the same hero asset (different opening 5 seconds, different CTA placement) often resets engagement. In the meantime, tighten frequency caps to slow exposure on the saturated audiences.

## Video network leak

- **ID:** `video-network-leak`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each Video campaign serves only on YouTube. Google Video Partners is opt-in for a reason: a sizeable share of GVP inventory is muted, off-screen, or sandboxed in mobile games (industry audits found about 75% of GVP placements fell into those categories). If you've explicitly tested it and it works, fine; if it's on by default, it's almost certainly wasting budget.
- **Settings:** none.

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.network_settings.target_youtube,
  campaign.network_settings.target_google_tv_network,
  campaign.network_settings.target_content_network,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend = sum of cost; content network = first row's `target_content_network` (Google exposes Video Partners through this bit on Video campaigns). The YouTube and Google TV flags are read but not used.
2. Flag campaigns with content network true. Sort by spend descending. Total spend = sum of offenders' spend.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns serving on Google Video Partners": "<n> Video campaigns have Google Video Partners enabled, covering about <total> of 30-day spend. The Adalytics audit found a majority of GVP inventory was muted or low-quality; if you haven't deliberately tested GVP performance against YouTube-only, it's worth turning off." Table (first 20): account, campaign, spend. Metrics: campaigns affected, spend on GVP.
- **Action:** For each campaign, open Settings, Networks, and uncheck 'Video partners on the Display Network'. Some Video subtypes (Video Reach, certain TrueView) re-enable it on save, so verify afterwards.

## Video attribution model

- **ID:** `video-attribution-model`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Primary conversion actions counted toward smart bidding use Data-Driven Attribution (or at minimum Position-Based or Time-Decay). Last-Click is the worst case for Video: the bidder is told 'Video doesn't drive conversions' even when it does.
- **Settings:** none. Last-click models: `LAST_CLICK`, `EXTERNAL`.

**Queries**

No date. Background on the models: `references/attribution-models.md`.

```sql
SELECT customer.descriptive_name, conversion_action.id, conversion_action.name,
  conversion_action.type, conversion_action.status,
  conversion_action.attribution_model_settings.attribution_model,
  conversion_action.include_in_conversions_metric, conversion_action.primary_for_goal
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
```

**Analyse with Python**

1. Flag actions where `include_in_conversions_metric` is true, `primary_for_goal` is true, and the upper-cased attribution model is `LAST_CLICK` or `EXTERNAL`. The check runs on every account in scope, whether or not it runs Video.
2. Sort by conversion action name ascending.

**Result**

- **opportunity:** at least one action. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Primary conversions still on last-click attribution": "<n> primary conversion actions are set to Last-Click attribution. Smart bidding optimizes for whatever it sees: Last-Click hides Video's contribution, so the bidder under-allocates to Video and you can't tell whether your YouTube spend is working." Table (first 30): account, conversion action, type, attribution model.
- **Action:** Switch eligible conversion actions to Data-Driven Attribution. If DDA isn't available (insufficient volume), Position-Based or Time-Decay are both better than Last-Click for accounts running Video. Migration is a setting toggle; Google handles the back-fill.

## Video content suitability

- **ID:** `video-content-suitability`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Active Video campaigns are set to 'Standard' (Google's default) or 'Limited' inventory. 'Expanded' opens the door to inventory categories the brand-safety filters specifically remove (sandboxed mobile games, made-for-kids content): sometimes a deliberate choice for maximum reach, but rarely the right default.
- **Settings:** none.

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.video_brand_safety_suitability, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend = sum of cost; suitability = first row's value, upper-cased.
2. Flag campaigns with suitability `EXPANDED_INVENTORY`. Sort by spend descending. Total spend = sum of offenders' spend.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns on Expanded inventory": "<n> Video campaigns are running on Expanded inventory, covering about <total> of 30-day spend. Expanded explicitly opens inventory the Standard tier filters out, often the lowest-quality categories." Table (first 20): account, campaign, suitability, spend. Metrics: campaigns affected, spend on Expanded.
- **Action:** For each campaign, open Settings, Inventory type, and switch to Standard (or Limited for maximum brand safety). If you've deliberately set it to Expanded for reach, document why, and verify in placement reports that you're actually getting the reach lift you traded for.

## Video campaigns not spending

- **ID:** `video-campaign-not-spending`
- **Category:** monitoring · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Every enabled Video campaign with a non-zero budget is at least getting impressions. Zero spend on an enabled Video campaign for a week is almost always a problem: Video has more silent-failure modes (asset disapproval, targeting too narrow, content suitability filtering everything) than Search.
- **Settings:** `minImpressions` = 100 (below this 7-day impression count the campaign is effectively not running; negative values are treated as 0).

**Queries**

Last 7 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.advertising_channel_type, campaign_budget.amount_micros,
  metrics.cost_micros, metrics.impressions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend and impressions = sums; budget = first row's `amount_micros / 1e6`.
2. Flag campaigns with budget > 0 and (spend = 0 or impressions < `minImpressions`). Campaigns with a zero budget are skipped (paused intent). Sort by budget descending.
3. Only campaigns the query returns are judged. A campaign with no delivery at all can be missing from a metrics query; if an enabled Video campaign you know of is absent from the rows, mention it in the report rather than adding it to the table.

**Result**

- **fail:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Enabled Video campaigns not spending": "<n> enabled Video campaigns had zero spend or fewer than <minImpressions> impressions in the last 7 days; budget is sitting unused." Table (first 20): account, campaign, budget, 7-day impressions, 7-day spend. Metric: campaigns affected.
- **Action:** For each campaign, check the Status column for 'Limited' reasons; verify all video assets are approved (one disapproved asset can pause an entire ad group); confirm the targeting isn't so narrow that no audience matches; check content suitability isn't set to a level that filters out all available inventory.

## Video budget cap

- **ID:** `video-budget-limited`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No actively spending Video campaign has 'budget-constrained' as its primary status reason. Video bid pacing penalizes constrained campaigns more than Search does: the algorithm pulls back on auction wins to spread the budget through the day, often missing prime-time inventory.
- **Settings:** none. Budget reasons: `CAMPAIGN_BUDGET_CONSTRAINED`, `BUDGET_CONSTRAINED`, `CAMPAIGN_BUDGET_NEGATIVE`.

**Queries**

Last 7 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.primary_status, campaign.primary_status_reasons, campaign_budget.amount_micros,
  metrics.cost_micros, metrics.impressions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend and impressions = sums; primary status, reasons and budget (`amount_micros / 1e6`) from the first row.
2. Flag campaigns with spend > 0 whose reasons include any budget reason. Reason = the first matching one. Sort by 7-day spend descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns capped by budget": "<n> active Video campaigns are flagged as budget-constrained. Video bid pacing penalizes constrained campaigns: it spreads the cap across the day and skips prime-time auctions to avoid running out early." Table (first 20): account, campaign, primary status, reason, budget, 7-day spend. Metric: campaigns affected.
- **Action:** For each campaign, raise the daily budget by 25 to 50% and watch reach lift over a week. If raising isn't an option, narrow the targeting or shorten the schedule (dayparting) so the same money concentrates in higher-value windows instead of being thinned across 24 hours.

## Video stuck in learning

- **ID:** `video-learning-stuck`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Active Video campaigns are out of learning within about 14 days of any bid-strategy change. Persistent learning status means the bidder isn't getting enough signal: too few conversions, frequent restarts (every edit kicks the strategy back to learning), or a target the algorithm can't hit.
- **Settings:** none. Learning reasons: `BIDDING_STRATEGY_LEARNING`, `LEARNING`, `BIDDING_STRATEGY_CONSTRAINED`.

**Queries**

Last 14 days. What a normal learning period looks like: `references/learning-phase-thresholds.md`.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.primary_status, campaign.primary_status_reasons, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend = sum of cost; primary status and reasons from the first row.
2. Flag campaigns with spend > 0 whose reasons include any learning reason. Reason = the first matching one. Sort by spend descending. (The check reads the current status only; it cannot tell how long the campaign has been learning.)

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns stuck in learning": "<n> Video campaigns spent in the last 14 days and are still flagged as learning. Either the conversion volume is too low for the bid strategy to stabilize, or recent edits keep restarting the learning curve." Table (first 20): account, campaign, primary status, reason, spend.
- **Action:** Stop editing the campaign settings until learning completes: every change to budget, bid target, or core targeting kicks the strategy back to learning. If volume is the issue, switch to Maximize Conversions while you build signal, then layer the target back on once the campaign has 30+ conversions per 30 days.

## Video excessive frequency

- **ID:** `video-frequency-excessive`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Active Video campaigns either have a frequency cap at or below 5 per user per week, or have no cap because the campaign type doesn't support one. Caps above this threshold mean the same user can see the same ad enough times to be actively annoyed, usually visible as falling view rate and rising CPV later.
- **Settings:** `maxAcceptableCap` = 5 (highest cap value, in whatever time unit it's set on, before the cap counts as excessive; values below 1 become 1, 0 or invalid becomes 5). Missing caps are `frequency-caps` in `display.md`.

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.frequency_caps, metrics.impressions, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: impressions and spend = sums. From the first row, parse `frequency_caps` (a list of entries, or a JSON string of one): the campaign's cap = the largest numeric `cap` among its entries. Entries without a numeric `cap` are ignored; an empty or unparsable value means no cap.
2. Flag campaigns whose cap exists and is > `maxAcceptableCap`. Sort by spend descending.

**Result**

- **opportunity:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns with frequency caps above the fatigue threshold": "<n> Video campaigns have a frequency cap set above <maxAcceptableCap>. Above this threshold, Google's own research and practitioner data show ad effectiveness declining and ROI dropping: you're paying to annoy the same users." Table (first 20): account, campaign, current cap, spend.
- **Action:** Tighten the cap to <maxAcceptableCap> per user per week (or lower for cold prospecting). Watch view rate and CPV in the week after; both should improve as the campaign stops re-serving to saturated users.

## Video CPV outliers

- **ID:** `video-cpv-outlier`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** No active Video campaign pays a CPV dramatically higher than the rest of the account. The threshold is the account's own median plus N MADs: a finance vertical with naturally high CPVs is judged against itself, not a generic benchmark.
- **Settings:** `madThreshold` = 2.0 (flag campaigns this many MADs above the account median; minimum 0.1, 0 or invalid becomes 2.0); `minCampaigns` = 3 (skip accounts with fewer eligible campaigns; cannot go below 3); `minViews` = 1000 (skip campaigns with fewer derived views).

**Queries**

Last 30 days, daily.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  segments.date, metrics.video_trueview_view_rate, metrics.impressions, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per row, derived views = impressions × `video_trueview_view_rate`. Per campaign: views = sum of derived views; cost = sum of cost.
2. Drop campaigns with views < `minViews`. Group the rest by account; skip accounts with fewer than `minCampaigns` campaigns.
3. Per account: CPV = cost / views per campaign; median and MAD of the CPVs. Skip the account if median ≤ 0 or MAD ≤ 0. Flag campaigns with CPV > median + `madThreshold` × MAD; MADs above = (CPV − median) / MAD.
4. Sort by spend descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns paying CPVs well above the account median": "<n> Video campaigns pay a CPV more than <madThreshold> MADs above the account's median. Auction pressure is up, the audience is too narrow, or the creative is dragging quality down; each scenario has a different fix." Table (first 20): account, campaign, CPV and account median CPV (3 decimals, account currency), MADs above (1 decimal), spend. Metric: campaigns affected.
- **Action:** For each campaign, check audience overlap with other Video campaigns (internal competition raises CPV); review the creative's view-through rate (a low rate forces Google to bid up to win); and look at frequency to make sure you're not hitting the same users repeatedly. If the audience is locked in, broaden it slightly.

## Video view rate outliers

- **ID:** `video-view-rate-outlier`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** No active Video campaign has a view rate dramatically below the rest of the account's distribution. Each campaign is judged against the account's own median, so luxury brand awareness and DTC performance accounts both get a fair read.
- **Settings:** `madThreshold` = 2.0 (flag campaigns this many MADs below the account median; minimum 0.1, 0 or invalid becomes 2.0); `minCampaigns` = 3 (cannot go below 3); `minImpressions` = 5000 (skip campaigns with fewer 30-day impressions).

**Queries**

Last 30 days, daily: the same query as `video-cpv-outlier`.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  segments.date, metrics.video_trueview_view_rate, metrics.impressions, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per campaign: view rate = unweighted mean of the daily `video_trueview_view_rate` values (sum of rates / number of rows); impressions and cost = sums.
2. Drop campaigns with impressions < `minImpressions`. Group the rest by account; skip accounts with fewer than `minCampaigns` campaigns.
3. Per account: median and MAD of the campaign view rates. Skip the account if median ≤ 0 or MAD ≤ 0. Flag campaigns with view rate < median − `madThreshold` × MAD; MADs below = (median − view rate) / MAD.
4. Sort by spend descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Video campaigns with view rate well below account median": "<n> Video campaigns post a view rate more than <madThreshold> MADs below the account's median. Either the audience isn't a fit, the creative hook isn't landing, or the placement mix is bad: the asset is being served but not watched." Table (first 20): account, campaign, view rate % and account median % (2 decimals), MADs below (1 decimal), spend. Metric: campaigns affected.
- **Action:** For each campaign, check the first 5 seconds of the video (skippable formats let users skip after 5 seconds, so the hook is everything). Then look at the placement breakdown: if mobile games or vertical-video apps dominate, exclude that placement type. If the audience is the issue, narrow targeting to the segment with proven engagement.

## Video remarketing lists

- **ID:** `video-remarketing-lists`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every account spending on Video has at least one OPEN remarketing user list (rule-based for YouTube viewers, a Customer Match upload, or standard remarketing). The list is what lets future Search and Video campaigns retarget the warm intent that Video itself created.
- **Settings:** none. List types: `REMARKETING`, `RULE_BASED`, `CRM_BASED`, `LOGICAL` (the API has no YouTube-specific type; YouTube viewer lists are `RULE_BASED`).

**Queries**

Query A, last 30 days:

```sql
SELECT customer.descriptive_name, customer.currency_code, customer.id, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'VIDEO'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, no date:

```sql
SELECT customer.descriptive_name, user_list.id, user_list.name, user_list.type,
  user_list.size_for_display, user_list.membership_status
FROM user_list
WHERE user_list.type IN ('REMARKETING', 'RULE_BASED', 'CRM_BASED', 'LOGICAL')
  AND user_list.membership_status = 'OPEN'
```

**Analyse with Python**

1. Video spend per account = sum of Query A cost by `customer_id`. List count per account = number of Query B rows (list size does not matter).
2. Flag accounts with Video spend > 0 and a list count of 0. Sort by Video spend descending. Total spend = sum of offenders' Video spend.

**Result**

- **opportunity:** at least one account. **ok:** otherwise.
- **unknown:** Query A failed on every account.
- **Report:** "Accounts spending on Video without any remarketing audiences": "<n> accounts spent on Video campaigns over the last 30 days without a single OPEN remarketing user list. About <total> of Video spend isn't building any remarketing audience for follow-up campaigns to harvest." Table (first 20): account, Video spend, lists (0).
- **Action:** In each account, set up the standard set of YouTube user lists (Audience manager, new segment, YouTube users): viewers of any video from your channel (30, 180 and 540 days), channel subscribers, and visitors to the channel. Once created they back-fill from historical viewer data; attach them as targeting or observation audiences on Search and Video.
