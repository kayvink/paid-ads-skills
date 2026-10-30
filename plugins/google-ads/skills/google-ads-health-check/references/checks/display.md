# Display checks

These checks cover Display campaigns (`campaign.advertising_channel_type = 'DISPLAY'`), plus five that reach wider: `frequency-caps` (Display, Video, Demand Gen), `display-accidental-clicks` and `display-mobile-app-leak` (Display and Performance Max placements), `junk-placements` (every placement row) and `placement-exclusions` (Display, Video, Performance Max, Demand Gen). Shared setup for every check in this file:

- **Windows.** "Last 30 days" means the 30 days ending yesterday: `segments.date BETWEEN '<start>' AND '<end>'` with `<end>` = yesterday and `<start>` = yesterday minus 29 days. Queries that do not select `segments.date` return one row per entity aggregated over the window; keep it that way unless the entry says otherwise.
- **Accounts.** Run each query for every account in scope. Every query adds `customer.descriptive_name` and `customer.currency_code` (the latter only where money is selected; on `user_list`, `conversion_action` and criterion resources add both for naming). Report accounts by name.
- **Standard aggregation.** Load each result with a `customer_id` column, cast metrics, set `cost = metrics.cost_micros / 1e6`. When an entry says "aggregate per X", group by `(customer_id, X id)`, take name and settings fields from the first row, and sum the additive metrics. Skip rows whose entity ID is empty.
- **Statistics.** `median`: middle value of the sorted list, mean of the two middle values for an even count, 0 for an empty list. `MAD`: median of `|x - median|`, 0 for fewer than 2 values.
- **Status.** Each check produces at most one observation, with the status named in its Result. No offending rows means **ok**, including when the account has no campaigns of that type (say "no Display campaigns in scope" in the report). **unknown** means the primary query (Query A unless stated) failed on every account and returned no rows; report the error per account. If only some accounts failed, evaluate the rest and name the failed accounts. Errors on a secondary query do not make the check unknown: treat that account as having no rows from it.
- **Money in messages.** Round row-level spend to 2 decimals. Totals in messages are rounded to whole units; sum them per currency when accounts use different currencies.

## Display low-rated assets

- **ID:** `display-low-assets`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** No individual asset on an active Display ad is rated 'Low'. Google's per-asset grading is one of the few transparent signals on Display: a 'Low' label means that asset is being chosen rarely or losing combinations against alternatives, and replacing it should lift the ad as a whole.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label,
  asset.id, asset.type, asset.name
FROM ad_group_ad_asset_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND ad_group_ad_asset_view.enabled = TRUE
  AND ad_group_ad_asset_view.performance_label = 'LOW'
```

**Analyse with Python**

1. Every returned row is one offending asset (no aggregation, no dedup). Count the rows across accounts.

**Result**

- **opportunity:** at least one row. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Display assets rated 'Low' by Google's per-asset grading": "<n> individual assets across active Display ads are rated 'Low' on per-asset performance. Each one is being chosen rarely or losing combinations against the alternatives; replacing them should lift the ad as a whole." Table (first 50 rows): account, campaign, ad group, `asset.type`, `field_type`. Metric: assets affected.
- **Action:** For each ad, open the asset details, sort by performance label, and replace the LOW-rated assets first. Aim to keep at least 5 headlines, 5 descriptions, 3+ landscape images, and 3+ square images at GOOD or BEST after replacement.

## Display ad strength

- **ID:** `display-ad-strength`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each active RDA is rated 'Good' or 'Excellent' on Ad Strength. Strength below that means a slot is missing or assets are too similar: the optimization has fewer combinations to test.
- **Settings:** none (the weak set is `POOR`, `AVERAGE`).

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type,
  ad_group_ad.ad_strength, metrics.cost_micros
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND ad_group_ad.ad.type = 'RESPONSIVE_DISPLAY_AD'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per ad (`ad_group_ad.ad.id`): spend = sum of cost; ad strength = first row's value, upper-cased.
2. Keep ads whose strength is `POOR` or `AVERAGE`. Sort by spend descending.
3. Total spend = sum of the offenders' spend.

**Result**

- **opportunity:** at least one weak ad. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Responsive Display Ads with weak Ad Strength": "<n> Responsive Display Ads are rated 'Poor' or 'Average', covering about <total spend> of 30-day spend. Weak strength caps how aggressively Google's RDA optimization can run combinations." Table (first 30): account, campaign, ad group, ad strength, spend. Metric: ads affected.
- **Action:** Open each ad in the editor and follow the inline Ad Strength suggestions. Most common gaps: too few unique headlines (under 5), descriptions that all sound the same, missing logo or video asset.

## Display RDA asset slots

- **ID:** `display-rda-asset-slots`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each active Responsive Display Ad has at least 5 headlines, 5 descriptions, 3 landscape images, 3 square images, and a logo. Google's machine learning needs slots filled to test combinations: the difference between 5 headlines and 1 is one of the largest performance levers on Display.
- **Settings:** `minHeadlines` = 5 (short headlines; maximum is 5); `minDescriptions` = 5 (maximum is 5); `minLandscapeImages` = 3 (1.91:1 marketing images); `minSquareImages` = 3 (1:1 images); `minLogos` = 1. Negative values are treated as 0.

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  ad_group.id, ad_group.name, ad_group_ad.ad.id,
  ad_group_ad.ad.responsive_display_ad.headlines,
  ad_group_ad.ad.responsive_display_ad.long_headline,
  ad_group_ad.ad.responsive_display_ad.descriptions,
  ad_group_ad.ad.responsive_display_ad.marketing_images,
  ad_group_ad.ad.responsive_display_ad.square_marketing_images,
  ad_group_ad.ad.responsive_display_ad.logo_images,
  ad_group_ad.ad.responsive_display_ad.youtube_videos,
  metrics.cost_micros
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND ad_group_ad.ad.type = 'RESPONSIVE_DISPLAY_AD'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per ad: spend = sum of cost. From the first row, count the items in each list field (`headlines`, `descriptions`, `marketing_images`, `square_marketing_images`, `logo_images`, `youtube_videos`). A field may arrive as a list or a JSON string of a list; anything else counts as 0.
2. Flag an ad when headlines < `minHeadlines`, or descriptions < `minDescriptions`, or marketing images < `minLandscapeImages`, or square images < `minSquareImages`, or logos < `minLogos`. Videos are reported but never flag. Sort by spend descending.

**Result**

- **opportunity:** at least one flagged ad. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Responsive Display Ads under-filled on asset slots": "<n> Responsive Display Ads are missing the recommended asset coverage. Google's machine learning serves the best combination of what you give it; a half-filled ad caps the upside." Table (first 30): account, campaign, ad group, headlines, descriptions, landscape images, square images, logos, videos, spend.
- **Action:** Fill all 5 headline slots, 5 description slots, multiple landscape (1.91:1) and square (1:1) images, and at least one logo. Even a single video asset (15 to 30 seconds) opens up additional Display surfaces.

## Display accidental clicks

- **ID:** `display-accidental-clicks`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No placement shows CTRs incompatible with real engagement. Genuine Display placements rarely exceed 5% CTR. Placements at 50%+ are almost always taps from sandboxed games or fraud, rarely real intent.
- **Settings:** `maxCtrPct` = 50 (flag placements with CTR above this percent); `minImpressions` = 100 (skip placements with fewer 30-day impressions). Negative values are treated as 0.

**Queries**

Last 30 days. Do not select `segments.date`.

```sql
SELECT customer.descriptive_name, customer.currency_code,
  detail_placement_view.placement, detail_placement_view.display_name,
  detail_placement_view.placement_type, campaign.name,
  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM detail_placement_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per `(customer_id, detail_placement_view.placement)` (skip rows with an empty placement): sum impressions, clicks, cost, conversions; display name, placement type and campaign name come from the first row (so a placement serving in several campaigns shows one campaign).
2. Keep placements with impressions ≥ `minImpressions`. CTR % = clicks / impressions × 100. Keep CTR % > `maxCtrPct`.
3. Sort by cost descending. Total spend = sum of offenders' cost.

**Result**

- **fail:** at least one placement. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Placements with click patterns suggesting accidental taps or fraud": "<n> placements recorded CTRs above <maxCtrPct>% over the last 30 days, about <total spend> of spend. Real Display CTRs almost never exceed a few percent. Numbers like these are usually accidental taps in sandboxed games or click fraud." Table (first 30): account, placement, display name, placement type, CTR % (1 decimal), impressions, clicks, cost, conversions (1 decimal). Metrics: placements affected, spend on suspected fraud.
- **Action:** Add each placement below to a campaign-level or account-level placement exclusion list. Then audit your campaigns' content and topic settings: if these placements keep coming back, the broader topic or category needs excluding too.

## Display mobile app leak

- **ID:** `display-mobile-app-leak`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Mobile-app placements either convert at the same rate as web placements (in which case they're earning their share) or contribute negligible spend. Heavy app-placement spend with no conversions is the textbook accidental-tap pattern; most accounts blanket-exclude apps with the `mobileappcategory::69500` exclusion.
- **Settings:** `maxAppShare` = 10 (flag campaigns where mobile apps take more than this percent of 30-day spend with zero conversions); `minCampaignSpend` = 100 (skip campaigns below this 30-day spend). Negative values are treated as 0.

**Queries**

Last 30 days. Do not select `segments.date` (one row per ad group × placement).

```sql
SELECT customer.descriptive_name, customer.currency_code,
  detail_placement_view.placement, detail_placement_view.display_name,
  detail_placement_view.placement_type, campaign.id, campaign.name,
  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM detail_placement_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Upper-case `placement_type`. App rows are those with type `MOBILE_APPLICATION` or `MOBILE_APP_CATEGORY`.
2. Per `(customer_id, campaign.id)`: total spend = sum of cost over all its placement rows (this is the campaign's spend for the check, not the campaign report's); app spend and app conversions = sums over its app rows; app placements = count of app rows with cost > 0.
3. Skip campaigns with total spend < `minCampaignSpend` or app spend = 0. App share % = app spend / total spend × 100. Flag when app share % > `maxAppShare` and app conversions = 0.
4. Sort by app spend descending. Total waste = sum of offenders' app spend.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Display/PMax campaigns leaking spend to mobile apps": "<n> campaigns have more than <maxAppShare>% of 30-day spend going to mobile-app placements with zero conversions, about <total> of waste. App inventory is the highest-fraud, lowest-intent surface on Display." Table (first 20): account, campaign, app spend, app share % (1 decimal), app conversions, app placements, campaign spend. Metrics: campaigns affected, spend on apps.
- **Action:** Apply the blanket mobile-app category exclusion (`mobileappcategory::69500`) at the account or campaign level. If mobile-app reach is intentional for the campaign, segment by app and exclude the worst categories instead (games, utilities) while keeping high-quality publishers.

## Junk placements

- **ID:** `junk-placements`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No spend or clicks landing on placements that match a junk-pattern blocklist. The default list catches the most common foot-guns (kids' games, anime sites, ringtone apps, made-for-advertising domains). Add patterns you've seen burn budget before to the settings.
- **Settings:** `keywordBlocklist` = `unblocked,kids,manga,anime,cheats,hacks,wallpaper,ringtones,coupons,jokes,memes,quiz` (comma-separated, case-insensitive substring match); `domainBlocklist` = `mfa.com,clickbait.com,examplespam.com` (comma-separated substring match, so `examplespam` matches `examplespam.com` and `sub.examplespam.com`); `minCost` = 5 (skip placements that spent less). Both lists are split on commas, trimmed, lower-cased, empties dropped.

**Queries**

Last 30 days. Do not select `segments.date`. There is no channel filter: every enabled campaign that has placement rows is scanned.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.advertising_channel_type,
  detail_placement_view.placement, detail_placement_view.display_name,
  detail_placement_view.placement_type, detail_placement_view.target_url,
  metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
FROM detail_placement_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. If both blocklists are empty after parsing, stop: the result is unknown ("both blocklists are empty, nothing to match").
2. Evaluate each row on its own (no aggregation). Skip rows with cost < `minCost`.
3. Haystack = `placement + " " + display_name + " " + target_url`, lower-cased. Test the keywords in list order, then the domains in list order; the first substring hit wins. Reason = `keyword: <k>` or `domain: <d>`.
4. Sort matches by cost descending. Total spend = sum of matches' cost.

**Result**

- **warn:** at least one match. **ok:** otherwise.
- **unknown:** both blocklists empty, or the query failed on every account.
- **Report:** "Spend on junk placements": "<n> placements matched the junk blocklist with at least <minCost> of spend each, roughly <total> over 30 days. Common patterns: kids' games inventory, anime/manga sites, MFA domains, ringtone or wallpaper apps. None of them tend to convert; all of them spend." Table (first 20): account, campaign, placement, display name, placement type, cost, clicks, conversions, reason. Metrics: placements affected, spend on junk.
- **Action:** For each placement below, add it to the campaign's negative placements (Tools, Shared library, Placement exclusions, or the campaign's excluded content settings). Patterns that recur across accounts belong in this check's keyword or domain blocklist setting so every account inherits the protection.

## Display search network leak

- **ID:** `display-search-network-leak`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each Display campaign serves only on the Display Network. Search Network on a Display campaign sends banner-style creatives onto search results pages where they're stripped down and rarely effective.
- **Settings:** none.

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.network_settings.target_search_network,
  campaign.network_settings.target_partner_search_network,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend = sum of cost; the two network flags from the first row (as booleans).
2. Flag campaigns where `target_search_network` or `target_partner_search_network` is true. Sort by spend descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Display campaigns serving on the Search Network": "<n> Display campaigns have Search Network or Search Partners enabled. Display creatives serving on search pages get stripped down to text, rarely the best use of either spend or creative." Table (first 20): account, campaign, search network (yes/no), search partners (yes/no), spend.
- **Action:** For each campaign, open Settings, Networks, and uncheck 'Include Google search partners' and 'Include Search Network'. If you want both surfaces, run them as separate campaigns with appropriate creatives for each.

## Missing frequency caps

- **ID:** `frequency-caps`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every active Display, Video, and Demand Gen campaign has at least 1 frequency cap configured (typically 3 to 5 impressions per user per week). Without a cap, retargeting audiences and small interest lists get hammered until users tune out.
- **Settings:** none. (`video-frequency-excessive` in `video.md` flags caps set too high.)

**Queries**

Last 30 days.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  campaign.advertising_channel_type, campaign.frequency_caps, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'DEMAND_GEN')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Aggregate per campaign: spend = sum of cost; channel = first row's `advertising_channel_type`; has cap = first row's `frequency_caps` is a non-empty list (if it arrives as a string, parse it as JSON; if parsing fails, a non-empty string other than `[]` counts as a cap).
2. Flag campaigns without a cap. Sort by spend descending. Total spend = sum of offenders' spend.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Display, Video, or Demand Gen campaigns without frequency caps": "<n> campaigns on Display, Video, or Demand Gen networks have no frequency cap. About <total> of 30-day spend is running uncapped; small retargeting audiences get hammered until they tune out." Table (first 50): account, campaign, channel, spend. Metrics: campaigns affected, spend exposed.
- **Action:** Open each campaign, Settings, Additional settings, Frequency cap, and set a per-user impression cap. Start at 3 to 5 impressions per user per week for awareness or 8 to 10 per week for retargeting, then tune from performance.

## Display content exclusions

- **ID:** `display-content-exclusions`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each account spending on Display has account-level exclusions for the high-junk content categories: parked domains, below-the-fold, sexually suggestive, profanity, and tragedy/conflict at minimum (the check also requires social issues). Per-campaign exclusions exist too, but the account-level set is the safety floor.
- **Settings:** none. Required labels: `SEXUALLY_SUGGESTIVE`, `BELOW_THE_FOLD`, `PARKED_DOMAIN`, `PROFANITY`, `TRAGEDY_AND_CONFLICT`, `SOCIAL_ISSUES`.

**Queries**

Query A, last 30 days:

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, no date:

```sql
SELECT customer.descriptive_name, customer_negative_criterion.type,
  customer_negative_criterion.content_label.type
FROM customer_negative_criterion
WHERE customer_negative_criterion.type = 'CONTENT_LABEL'
```

**Analyse with Python**

1. Display spend per account = sum of Query A cost by `customer_id`.
2. Excluded labels per account = set of upper-cased `content_label.type` values from Query B (ignore empty values).
3. For each account with Display spend > 0, missing = required labels (in the order above) not in its set. Flag accounts with any missing label. Sort by Display spend descending.

**Result**

- **opportunity:** at least one account. **ok:** otherwise.
- **unknown:** Query A failed on every account.
- **Report:** "Accounts missing account-level content exclusions": "<n> accounts spend on Display without account-level exclusions for one or more of the high-junk content categories. Each missing exclusion is a permanent backdoor for inventory you almost certainly don't want." Table (first 20): account, Display spend, missing labels (comma-joined).
- **Action:** Add account-level content exclusions (account settings, Content exclusions): exclude Parked domains, Below the fold, Sexually suggestive, Profanity, and Tragedy and conflict at minimum. It takes 5 minutes per account and protects every campaign, present and future.

## Display placement waste

- **ID:** `display-placement-waste`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No Display placement burns more than its campaign's average CPA without converting at least once. The threshold is relative: a 200-CPA luxury account isn't held to the same floor as a 5-CPA commodity account.
- **Settings:** `cpaMultiplier` = 2 (flag placements whose 30-day cost exceeds this multiple of the campaign CPA with zero conversions; values below 1 become 1, 0 or invalid becomes 2); `minSpend` = 25 (skip placements spending less over 30 days).

**Queries**

Last 30 days. Do not select `segments.date` (one row per ad group × placement).

```sql
SELECT customer.descriptive_name, customer.currency_code,
  detail_placement_view.placement, detail_placement_view.display_name,
  detail_placement_view.placement_type, campaign.id, campaign.name,
  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM detail_placement_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Campaign baseline per `(customer_id, campaign.id)`: sum cost and conversions over all its placement rows. Campaign CPA = cost / conversions, or 0 when conversions = 0.
2. Evaluate each placement row on its own: skip rows with conversions > 0 or cost < `minSpend`; skip rows whose campaign CPA ≤ 0 (campaign had no conversions). Flag when cost > campaign CPA × `cpaMultiplier`. CPA ratio = cost / campaign CPA (1 decimal).
3. Sort by cost descending. Total spend = sum of offenders' cost.

**Result**

- **warn:** at least one placement. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Placements burning more than campaign CPA without converting": "<n> placements burned more than <cpaMultiplier>× their campaign's average CPA over 30 days with zero conversions, about <total> spent on placements that never converted." Table (first 30): account, campaign, placement, display name, placement type, cost, campaign CPA, CPA ratio. Metrics: placements affected, spend on waste.
- **Action:** Add the worst offenders to a campaign-level or account-level placement exclusion list. If the same placement keeps appearing across campaigns, add it as an account-level negative.

## Display viewability

- **ID:** `display-viewability`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** No active Display campaign has a viewability rate dramatically below the rest of the account. The threshold adapts to the account's own distribution: a publisher-direct campaign at 70% viewability is judged against the account's other campaigns, not a generic 50% floor.
- **Settings:** `madThreshold` = 2.0 (flag campaigns this many MADs below the account median; minimum 0.1, 0 or invalid becomes 2.0); `minCampaigns` = 3 (skip accounts with fewer eligible campaigns; cannot go below 3); `minImpressions` = 10000 (skip campaigns with fewer 30-day impressions).

**Queries**

Last 30 days, no `segments.date` in the select (one row per campaign).

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  metrics.active_view_viewability, metrics.active_view_measurability,
  metrics.active_view_impressions, metrics.impressions, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per campaign: viewability = unweighted mean of `active_view_viewability` over its rows (with one row per campaign, that is the row's value; it is a 0 to 1 fraction); impressions and cost = sums.
2. Drop campaigns with impressions < `minImpressions`. Group the rest by account; skip accounts with fewer than `minCampaigns` campaigns.
3. Per account: median and MAD of the campaign viewabilities. Skip the account if median ≤ 0 or MAD ≤ 0. Cutoff = median − `madThreshold` × MAD. Flag campaigns with viewability < cutoff; MADs below = (median − viewability) / MAD.
4. Sort by spend descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Display campaigns with viewability well below account median": "<n> Display campaigns post a viewability rate well below the account median. The ads are being served but rarely seen, usually below-the-fold inventory or sites with rapid auto-refresh." Table (first 20): account, campaign, viewability % (1 decimal), account median % (1 decimal), MADs below (1 decimal), spend. Metric: campaigns affected.
- **Action:** Open the placement report for each campaign and identify the lowest-viewability sources. Exclude the worst offenders. As a structural fix, tighten the campaign's content suitability setting and explicitly exclude 'below the fold' inventory in the placement type filters.

## Display frequency saturation

- **ID:** `display-frequency-saturation`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Display CTR stays within 25% of the campaign's prior 23-day baseline. When it drops further while impressions hold steady, audiences are saturated; the fix is fresh creative, tighter frequency caps, or audience expansion.
- **Settings:** `maxCtrDeclinePct` = 25 (flag when recent 7-day CTR is more than this percent below the prior baseline); `minPriorImpressions` = 5000 (skip campaigns with less prior-window volume). Constant: recent impressions must be ≥ 70% of the pro-rated prior impressions.

**Queries**

Last 30 days, daily.

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per campaign and date: sum impressions and clicks. Campaign spend = sum of cost over the window.
2. Collect the distinct dates across all campaigns and accounts and sort them. If there are fewer than 14, stop: result ok. Split date = the 8th date from the end. Recent dates = dates after it (the last 7); prior dates = it and everything before.
3. Per campaign: sum impressions and clicks over the recent and prior dates. Skip when prior impressions < `minPriorImpressions`, prior clicks = 0, or recent impressions = 0.
4. Prior CTR = prior clicks / prior impressions; recent CTR likewise. Decline % = (prior CTR − recent CTR) / prior CTR × 100. Expected recent impressions = prior impressions × (number of recent dates / number of prior dates). Flag when decline % > `maxCtrDeclinePct` and recent impressions ≥ 0.7 × expected.
5. Sort by decline % descending.

**Result**

- **warn:** at least one campaign. **ok:** otherwise (including fewer than 14 dates of data).
- **unknown:** the query failed on every account.
- **Report:** "Display campaigns showing audience saturation": "<n> Display campaigns saw CTR fall by more than <maxCtrDeclinePct>% in the last 7 days vs the prior 23 days, while impressions held up. Same audience seeing the same creatives: engagement is dropping not because reach changed but because the audience tuned out." Table (first 20): account, campaign, recent CTR % and prior CTR % (3 decimals), CTR decline % (1 decimal), recent impressions, prior impressions, spend. Metric: campaigns affected.
- **Action:** Refresh creative first (the cheapest fix), then tighten frequency caps so saturated users see fewer impressions, then consider broadening targeting to bring in unsaturated audience pools. If the campaign is locked to a small remarketing list, accept the saturation and lower the budget.

## Display optimized targeting leak

- **ID:** `display-optimized-targeting-leak`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Display ad groups targeting a remarketing or CRM-based user list have Optimized Targeting turned off. Otherwise the algorithm spends remarketing budget on prospecting traffic. This is undocumented but well-evidenced (Search Engine Land, 2023): one case had 99% of budget spent on Optimized Targeting expansion.
- **Settings:** none. Remarketing list types: `REMARKETING`, `CRM_BASED`, `RULE_BASED`.

**Queries**

Query A, last 30 days:

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  ad_group.id, ad_group.name, ad_group.optimized_targeting_enabled, metrics.cost_micros
FROM ad_group
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, no date:

```sql
SELECT customer.descriptive_name, ad_group.id, ad_group_criterion.user_list.user_list, user_list.type
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'USER_LIST'
  AND ad_group_criterion.status = 'ENABLED'
  AND user_list.type IN ('REMARKETING', 'CRM_BASED', 'RULE_BASED')
```

If the API rejects `user_list.type` on `ad_group_criterion`, drop it from Query B's select and where, run `SELECT user_list.resource_name, user_list.type FROM user_list` (Query C), and keep only Query B rows whose `ad_group_criterion.user_list.user_list` matches a Query C list of one of the three types.

**Analyse with Python**

1. Remarketing ad groups = set of `(customer_id, ad_group.id)` from Query B (after the type filter).
2. Aggregate Query A per ad group: spend = sum of cost; optimized targeting = first row's flag.
3. Flag ad groups that are in the remarketing set and have optimized targeting on. Sort by spend descending. Total spend = sum of offenders' spend.

**Result**

- **warn:** at least one ad group. **ok:** otherwise.
- **unknown:** Query A failed on every account.
- **Report:** "Optimized Targeting on for remarketing ad groups": "<n> Display ad groups are running Optimized Targeting on top of a remarketing or CRM list, covering about <total> of 30-day spend. Optimized Targeting expands beyond your audience: the budget meant for warm users gets spent on lookalike prospects." Table (first 20): account, campaign, ad group, spend. Metrics: ad groups affected, spend on expansion.
- **Action:** For each ad group, open Settings, Targeting expansion, and uncheck 'Use Optimized Targeting'. Verify by running the audience segments report and confirming spend stays inside the targeted lists, not the 'Expansion' bucket.

## Display audience targeting

- **ID:** `display-audience-targeting-mode`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each active Display ad group has at least one positive targeting criterion: an audience, topic, placement, demographic, or keyword. Running Display with zero targeting opens the campaign to every available auction, and the lowest-quality inventory usually floods in first.
- **Settings:** none. Targeting types: `USER_LIST`, `USER_INTEREST`, `TOPIC`, `PLACEMENT`, `KEYWORD`, `AGE_RANGE`, `GENDER`, `CUSTOM_AFFINITY`, `CUSTOM_INTENT`, `AUDIENCE`.

**Queries**

Query A, last 30 days:

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  ad_group.id, ad_group.name, metrics.cost_micros
FROM ad_group
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, no date:

```sql
SELECT customer.descriptive_name, ad_group.id, ad_group_criterion.type
FROM ad_group_criterion
WHERE ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
```

**Analyse with Python**

1. Targeted ad groups = set of `(customer_id, ad_group.id)` from Query B rows whose upper-cased `ad_group_criterion.type` is in the targeting types.
2. Aggregate Query A per ad group: spend = sum of cost.
3. Flag ad groups with spend > 0 that are not in the targeted set. Sort by spend descending. Total spend = sum of offenders' spend.

**Result**

- **warn:** at least one ad group. **ok:** otherwise.
- **unknown:** Query A failed on every account.
- **Report:** "Display ad groups spending without any targeting": "<n> Display ad groups spent without a single positive targeting criterion attached, covering about <total> of 30-day spend. Without targeting, Display serves to whoever's available, usually the cheapest, lowest-intent inventory." Table (first 30): account, campaign, ad group, spend. Metrics: ad groups affected, spend untargeted.
- **Action:** For each ad group, add at least one audience (in-market, custom, or remarketing), topic, or placement set. The cheapest acceptable starting point is a custom intent audience built from your top-converting Search keywords: it gives Display a real signal to bid on.

## Closed remarketing lists

- **ID:** `display-remarketing-list-closed`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Lists in active use are open. Closed lists exist for archival reasons (old promo audiences, deprecated source rules); campaigns shouldn't still be targeting them because the audience expires daily.
- **Settings:** none. List types checked: `REMARKETING`, `RULE_BASED`, `CRM_BASED`, `LOGICAL` (YouTube viewer lists are `RULE_BASED`).

**Queries**

No date.

```sql
SELECT customer.descriptive_name, user_list.id, user_list.name, user_list.type,
  user_list.size_for_display, user_list.membership_status, user_list.membership_life_span
FROM user_list
WHERE user_list.membership_status = 'CLOSED'
```

**Analyse with Python**

1. Keep lists whose upper-cased type is in the checked set and `size_for_display` > 0. Every kept list is an offender; keep the query order. (The check does not test whether a campaign still targets the list.)

**Result**

- **opportunity:** at least one list. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Closed remarketing lists still holding users": "<n> remarketing lists are set to CLOSED but still have members. As those members age past the membership lifespan, the list shrinks daily; campaigns targeting it will lose audience without warning." Table (first 30): account, list name, type, size for Display, lifespan (days).
- **Action:** For each list, reopen it if the audience is still useful (restart the source), or remove it from campaigns if it's deprecated. A closed list still in use is the worst of both: the audience shrinks daily while campaigns look like they're targeting someone.

## Display converter exclusions

- **ID:** `display-no-converter-exclusion`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each Display campaign excludes a recent-converters list (or 'all converters' for one-off purchases). Without it, prospecting and remarketing budgets keep showing ads to people who already bought: paying twice for the same conversion.
- **Settings:** none.

**Queries**

Query A, last 30 days:

```sql
SELECT customer.descriptive_name, customer.currency_code, campaign.id, campaign.name,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DISPLAY'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, no date:

```sql
SELECT customer.descriptive_name, campaign.id, campaign_criterion.user_list.user_list,
  campaign_criterion.negative
FROM campaign_criterion
WHERE campaign_criterion.type = 'USER_LIST'
  AND campaign_criterion.negative = TRUE
  AND campaign_criterion.status = 'ENABLED'
```

**Analyse with Python**

1. Campaigns with a negative list = set of `(customer_id, campaign.id)` from Query B (any user list counts, whatever it contains).
2. Aggregate Query A per campaign: spend = sum of cost. Flag campaigns not in the set. Sort by spend descending. Total spend = sum of offenders' spend.

**Result**

- **opportunity:** at least one campaign. **ok:** otherwise.
- **unknown:** Query A failed on every account.
- **Report:** "Display campaigns without negative user-list exclusions": "<n> Display campaigns have no negative user list attached, covering about <total> of 30-day spend. Recent converters keep getting served ads they don't need." Table (first 30): account, campaign, spend. Metrics: campaigns affected, spend exposed.
- **Action:** Build a 'recent converters' user list (rule-based on the conversion event, or a Customer Match upload) with a membership window matching the repeat-purchase cycle: 14 days for consumables, 90 days for SaaS. Attach it to every Display campaign as a negative.

## Display remarketing list size

- **ID:** `display-remarketing-list-size`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every open remarketing list has at least 100 users for Display or 1,000 for Search/RLSA. Lists below those floors look fine in the audience picker but Google won't serve to them: zero impressions, no warning.
- **Settings:** `minDisplaySize` = 100 (Google's documented floor for Display serving); `minSearchSize` = 1000 (floor for Search/RLSA serving). Negative values are treated as 0. List types checked: `REMARKETING`, `RULE_BASED`, `CRM_BASED`, `LOGICAL`.

**Queries**

No date.

```sql
SELECT customer.descriptive_name, user_list.id, user_list.name, user_list.type,
  user_list.size_for_display, user_list.size_for_search,
  user_list.membership_status, user_list.membership_life_span
FROM user_list
WHERE user_list.membership_status = 'OPEN'
```

**Analyse with Python**

1. Keep lists whose upper-cased type is in the checked set. Missing sizes count as 0.
2. Flag lists with `size_for_display` < `minDisplaySize` **and** `size_for_search` < `minSearchSize` (below both floors). Sort by list name ascending.

**Result**

- **warn:** at least one list. **ok:** otherwise.
- **unknown:** the query failed on every account.
- **Report:** "Remarketing lists below serving threshold": "<n> OPEN remarketing lists are below the serving threshold (Display: <minDisplaySize>, Search/RLSA: <minSearchSize>). They're attached to campaigns and look fine in the audience picker, but Google can't serve to them yet." Table (first 30): account, list name, type, size for Display, size for Search, membership lifespan (days).
- **Action:** For each list, confirm the source is firing (tag manager, Customer Match upload, or rule definitions). If the source is fine and the list is just new, wait 48 to 72 hours for population. Long-term, extend the membership lifespan if your audience is small but high-quality: a 540-day lifespan on a niche segment keeps it serving.

## Placement exclusions

- **ID:** `placement-exclusions`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each visual campaign has placement exclusions blocking low-quality apps, kids' content, and clickbait.
- **Settings:** `minExclusions` = 1 (flag campaigns with fewer placement-type exclusions; negative values are treated as 0). Exclusion types counted: `PLACEMENT`, `YOUTUBE_VIDEO`, `YOUTUBE_CHANNEL`, `MOBILE_APPLICATION`, `MOBILE_APP_CATEGORY`.

**Queries**

Query A, no date:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'PERFORMANCE_MAX', 'DEMAND_GEN')
```

Query B, no date:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.status,
  campaign_criterion.type, campaign_criterion.negative
FROM campaign_criterion
WHERE campaign_criterion.negative = TRUE
  AND campaign_criterion.type IN ('PLACEMENT', 'YOUTUBE_VIDEO', 'YOUTUBE_CHANNEL', 'MOBILE_APPLICATION', 'MOBILE_APP_CATEGORY')
  AND campaign.status = 'ENABLED'
```

**Analyse with Python**

1. Exclusion count per `(customer_id, campaign.id)` = number of Query B rows. Also count all Query B rows by upper-cased type (these totals include campaigns of every channel type). Only campaign-level criteria count; exclusion lists attached as shared sets and account-level exclusions are not seen by this check.
2. For each Query A row (one per campaign, in query order), exclusions = its count or 0. Flag campaigns with exclusions < `minExclusions`.
3. Total campaigns = Query A row count; covered = total − flagged.

**Result**

- **warn:** at least one campaign. **ok:** otherwise.
- **unknown:** both queries returned no rows and at least one of them errored.
- **Report:** "Display/Video/PMax campaigns with no placement exclusions": "<flagged> of <total> visual campaigns have zero placement exclusions. A predictable chunk of the budget ends up on low-quality inventory (kids apps, clickbait sites, auto-refresh pages) that would never convert." Table (first 20): account, campaign, exclusions. Metrics: total exclusions (Query B rows), covered campaigns ("<covered> of <total>"), and the per-type counts (placements, YouTube videos, YouTube channels, mobile apps, mobile app categories).
- **Action:** For each campaign below, pull the Placements report (where ads actually served), identify the obvious junk, and add them as exclusions. A shared exclusion list covers the common offenders across campaigns; revisit monthly as new placements appear.
