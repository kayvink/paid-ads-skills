# Performance Max checks

These checks cover Performance Max: campaigns with `campaign.advertising_channel_type = 'PERFORMANCE_MAX'`, their asset groups, products and search-term insight categories (one check also reads Search keywords). Shared setup for every entry: the window is the last 30 days ending yesterday (`<start>` = today minus 30 days, `<end>` = yesterday); run each query once per account in scope; sum metric columns per entity key in Python (keys always include `customer_id`) and divide every `*_micros` field by 1e6. `campaign_search_term_insight` only accepts one campaign per query (`campaign_search_term_insight.campaign_id = <id>`, otherwise the API returns `REQUIRES_FILTER_BY_SINGLE_RESOURCE`), so the checks that use it first list the active PMax campaigns and then run one insight query per campaign against that campaign's account. A check is **unknown** when its main query errored on every account and returned no rows (report each account's error); partial failures still run and name the failed accounts. A check with no observation is **ok**; with observations its status is the worst observation (fail > warn > opportunity). Report accounts by `customer.descriptive_name` and money in `customer.currency_code`. Brand terms come from `brand_terms` in `ads/google/index.md` (conventions section 3).

## PMax asset disapprovals

- **ID:** `pmax-asset-disapprovals`
- **Category:** creative · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** No assets in any active PMax asset group are disapproved or limited. PMax serves whatever assets it has: a single disapproved image or headline doesn't block the campaign, but it quietly removes a creative variant the optimiser would otherwise test. PMax has no ad-level disapproval, only per-asset, so a disapproved-ads check doesn't see this. Healthy accounts keep it at zero.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name,
  campaign.id, campaign.name, asset_group.id, asset_group.name,
  asset.id, asset.name, asset.type,
  asset.policy_summary.review_status, asset.policy_summary.approval_status
FROM asset_group_asset
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND asset_group_asset.status = 'ENABLED'
```

**Analyse with Python**

1. Upper-case both policy fields. Offending rows: `review_status == 'DISAPPROVED'` OR `approval_status` in {`DISAPPROVED`, `AREA_OF_INTEREST_ONLY`}. One row per asset link; no aggregation.
2. Count offenders by `asset.type` and format the breakdown as "TYPE: n" sorted by count descending.

**Result**

- **fail:** at least one offending asset. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} PMax asset(s) are disapproved or limited and won't serve. PMax keeps running on whatever's left, but each missing creative variant is one fewer thing the optimiser can test, which over time caps performance." Include the type breakdown. Table (first 20): account, campaign, asset group, asset name, asset type, review status, approval status.
- **Action:** In Google Ads open the affected PMax campaign, Asset groups, click into each asset group listed and look for the red status icon on individual assets. Replace or fix the disapproved ones. Common fixes: image with text overlay, headline with disallowed punctuation, video with a policy issue, logo too small.

## PMax ad strength

- **ID:** `ad-strength-pmax`
- **Category:** creative · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each PMax asset group rates at least "Good" ad strength; weak groups get starved of impressions.
- **Settings:** `minStrength` = GOOD (one of POOR, AVERAGE, GOOD, EXCELLENT; an unrecognised value is treated as GOOD); `maxOffending` = 0 (the result stays ok while the number of weak asset groups is at or below this).

**Queries**

```sql
SELECT customer.descriptive_name,
  asset_group.id, asset_group.name, asset_group.ad_strength,
  campaign.id, campaign.name
FROM asset_group
WHERE asset_group.status = 'ENABLED'
```

**Analyse with Python**

1. Rank each upper-cased `ad_strength`: PENDING, UNSPECIFIED, UNKNOWN, NO_ADS and anything unrecognised = 0; POOR = 1; AVERAGE = 2; GOOD = 3; EXCELLENT = 4. Minimum rank = rank of `minStrength`.
2. Offending = asset groups with rank below the minimum. Also count the distribution of EXCELLENT, GOOD, AVERAGE, POOR across all rows. Total = number of asset-group rows.

**Result**

- **warn:** number of offending groups `> maxOffending`. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} of {total} Performance Max asset group(s) rate below {minStrength} ad strength. Weak asset groups get starved of impressions: PMax downranks them and the whole campaign's volume suffers." Add the distribution line. Table (first 20): account, asset group, strength, campaign.
- **Action:** Open each asset group and fill the asset fields: push headlines and descriptions toward the maximum count, add at least 5 images in each image size, 1–2 videos (even auto-generated), and 5+ sitelinks. Take every green suggestion Google offers.

## PMax asset coverage

- **ID:** `asset-coverage`
- **Category:** creative · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each PMax asset group has 5+ headlines, 4+ descriptions, 4+ images and 1+ video.
- **Settings:** `minHeadlines` = 5; `minDescriptions` = 4; `minImages` = 4 (marketing images); `minVideos` = 1 (YouTube videos). Negative values clamp to 0.

**Queries**

Query A, enabled asset groups:

```sql
SELECT customer.descriptive_name,
  asset_group.id, asset_group.resource_name, asset_group.name, campaign.name
FROM asset_group
WHERE asset_group.status = 'ENABLED'
```

Query B, enabled asset links:

```sql
SELECT asset_group_asset.asset_group, asset_group_asset.field_type, asset_group_asset.status
FROM asset_group_asset
WHERE asset_group_asset.status = 'ENABLED'
```

**Analyse with Python**

1. From Query B, count per `asset_group_asset.asset_group` resource name by upper-cased `field_type`: headlines = `HEADLINE` + `LONG_HEADLINE`; descriptions = `DESCRIPTION`; images = `MARKETING_IMAGE` + `SQUARE_MARKETING_IMAGE`; videos = `YOUTUBE_VIDEO`. Other field types are ignored.
2. For each Query A row, look up its counts by `asset_group.resource_name` (fallback `customers/<customer_id>/assetGroups/<id>`; no match = all zeros). Missing list: `headlines<min` etc. for each count below its setting. Offending = groups with any missing entry.
3. Covered averages: over every asset group in the Query B counts that meets all four minimums, average headlines, descriptions, images, videos (0 when none qualify). Covered = total Query A groups − offending.

**Result**

- **warn:** at least one offending group. **ok:** otherwise.
- **unknown:** both queries errored on every account and returned no rows.
- **Report:** "{n} of {total} Performance Max asset group(s) are below the recommended asset counts. Groups that meet the bar average {h} headlines, {i} images and {v} videos." Add the covered count "{covered} of {total}". Table (first 20): account, asset group, campaign, headlines, descriptions, images, videos, missing.
- **Action:** Open each asset group and add the missing fields. At minimum: 5 headlines, 4 descriptions, 4 images (at least one of each required size), and 1 video (Google auto-generates one if you don't provide it, but a real one performs better).

## PMax brand exclusion

- **ID:** `pmax-brand-exclusion`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each PMax campaign has brand exclusions configured. Branded clicks go to the dedicated branded Search (or branded Shopping) campaign at a low CPC, and PMax learns from non-branded conversions only. Without this, PMax inflates its own ROAS by intercepting traffic that was already yours, and the bidder learns from a flattering signal that doesn't generalise.
- **Settings:** `minSpend` = 500 (skip PMax campaigns spending less than this over 30 days).

**Queries**

Query A, PMax spend:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, negative campaign criteria (no date range):

```sql
SELECT campaign.id, campaign_criterion.type, campaign_criterion.negative,
  campaign_criterion.keyword.text
FROM campaign_criterion
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign_criterion.negative = TRUE
```

**Analyse with Python**

1. Group Query A by `(customer_id, campaign.id)` and sum spend.
2. From Query B, per `(customer_id, campaign.id)`: has brand exclusion = any negative row with upper-cased type `BRAND_LIST` or `BRAND`; has negative keywords = any negative row of type `KEYWORD` (context only, not a pass).
3. Offenders: spend `>= minSpend` and no brand exclusion. Sort by spend descending; total = sum of offender spend.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** both queries errored on every account and returned no rows.
- **Report:** "{n} Performance Max campaign(s) spending real money have no brand exclusion configured. PMax tends to intercept branded search clicks that would have gone to your branded campaign, making PMax's ROAS look strong while the branded campaign starves. Branded share inside PMax is often 20–30%, sometimes 80%+, when this isn't fixed." Table (first 20): account, campaign, spend, has negative keywords. Note the known gap: brand lists applied at account level are not detected, so campaigns covered only by an account-level brand list show as false positives; state this caveat in the finding.
- **Action:** For each campaign, open Settings, Brand exclusions and add a brand list. This excludes branded queries from Search and Shopping inventory inside PMax. To also exclude branded video and display traffic, submit Google's Performance Max campaign modification request form with a negative-keyword list.

## PMax non-converting categories

- **ID:** `pmax-non-converting-categories`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No PMax search category drives meaningful click volume without converting. PMax doesn't expose individual search terms in detail, so categories are the closest signal; a category with hundreds of clicks and zero conversions is a clear candidate for a negative-keyword list submission.
- **Settings:** `minClicks` = 30 (minimum clicks a non-converting category needs before it is flagged).

**Queries**

Query A, active PMax campaigns (no date range):

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
```

Query B, run once per campaign from Query A in that campaign's account:

```sql
SELECT campaign_search_term_insight.category_label,
  metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value
FROM campaign_search_term_insight
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign_search_term_insight.campaign_id = <campaign.id>
```

**Analyse with Python**

1. If Query A returned no campaigns, stop: ok.
2. Tag each Query B row with its `customer_id`, campaign ID and campaign name. Sum clicks, impressions, conversions and value per `(customer_id, campaign.id, category_label)` (the API normally returns one row per label already).
3. Offenders: clicks `>= minClicks` AND conversions == 0. Sort by clicks descending; total wasted clicks = sum of offender clicks.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** Query A errored on every account.
- **Report:** "{n} PMax search categor(ies) drove at least {minClicks} clicks each in the last 30 days with zero conversions. Categories are the closest lever PMax exposes, and these are the highest-value targets for a negative-keyword submission." Add total wasted clicks. Table (first 20): account, campaign, category, clicks, impressions, conversions, value.
- **Action:** Collect the category labels into a request through Google's Performance Max campaign modification request form (Google Ads Help) and submit them as negative keywords. For competitor-brand categories use Brand exclusions instead (campaign Settings, Brand exclusions): same effect, no support ticket.

## PMax Final URL Expansion

- **ID:** `pmax-final-url-expansion`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** no
- **Good looks like:** Each PMax campaign has Final URL Expansion turned off, so traffic only lands on the URLs specified in the asset group. With expansion on (the default), PMax sends traffic to URLs it picks, often the homepage or a blog post. Expansion fits some commerce use cases but breaks lead gen and brand-controlled landing experiences.
- **Settings:** `minSpend` = 200 (skip PMax campaigns spending less than this over 30 days).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.asset_automation_settings,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. `campaign.asset_automation_settings` is a list of entries with `asset_automation_type` and `asset_automation_status` (anything that isn't a list counts as empty). Find the entry with type `FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION`. Expansion on = its upper-cased status contains `OPT_IN` or equals `OPTED_IN` or `ENABLED`; any other non-empty status = off; no entry or empty status = unknown (not flagged).
2. Group by `(customer_id, campaign.id)`: sum spend; keep the last known (non-unknown) expansion value.
3. Offenders: spend `>= minSpend` AND expansion on. Sort by spend descending; total = sum of offender spend.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} PMax campaigns have Final URL Expansion enabled. PMax routes traffic to URLs it picks rather than the ones you configured, often the homepage or a top blog post. About {total} of monthly spend lands where Google decides, not where you decided." Table (first 20): account, campaign, spend.
- **Action:** For each campaign, open the campaign settings, Final URL Expansion, and turn it off. If you deliberately want broader landing-page coverage on a campaign, record that decision in the campaign name; otherwise the default-on behaviour leaks brand control silently.

## PMax branded search share

- **ID:** `pmax-search-categories-split`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each PMax campaign's conversions come mostly from non-branded categories (typically 70–80% non-brand, 10–20% brand). When branded share climbs past that, PMax competes with the branded Search campaign and inflates its own reported ROAS. The fix is brand exclusions, not better creative.
- **Settings:** `brandKeywords` = the `brand_terms` list from `ads/google/index.md` (comma-separated brand terms matched against category labels); `maxBrandSharePct` = 30 (flag campaigns whose branded share of conversions exceeds this percent); `minTotalConversions` = 10 (skip campaigns with fewer conversions in the window).

**Queries**

Query A and Query B are the same as in PMax non-converting categories: list active PMax campaigns, then run the `campaign_search_term_insight` query once per campaign over the last 30 days.

**Analyse with Python**

1. Build the brand regex: split the brand terms on commas, trim, drop empties, regex-escape each, and compile `\b(term1|term2|...)\b` case-insensitive. If there are no terms, stop: unknown.
2. If Query A returned no campaigns, stop: ok.
3. Classify each insight row's `category_label`: empty or whitespace = blank; regex match = brand; otherwise non-brand. Per `(customer_id, campaign.id)` sum conversions into brand, non-brand, blank and total.
4. Skip campaigns with total `< minTotalConversions`. Brand share = brand conversions / total × 100. Flag where share `> maxBrandSharePct`. Sort by share descending.

**Result**

- **warn:** at least one flagged campaign. **ok:** otherwise.
- **unknown:** no brand terms are set ("No brand terms configured. Add `brand_terms` to `ads/google/index.md` to enable PMax brand-share detection."; propose a list as conventions section 3 describes), or Query A errored on every account.
- **Report:** "{n} PMax campaigns get more than {maxBrandSharePct}% of conversions from branded search categories. PMax is intercepting clicks that would have gone to your branded Search campaign at lower CPC: reported ROAS is inflated and the branded campaign is starving." Add the worst share. Table (first 20): account, campaign, brand share % (0 decimals), brand conversions, non-brand conversions, blank conversions, total conversions.
- **Action:** Add brand exclusions to the PMax campaign (Settings, Brand exclusions). Verify the branded Search or Shopping campaign has enough budget to reclaim the demand. Re-measure in 2–3 weeks; branded share should fall below 20%.

## PMax product matrix

- **ID:** `pmax-product-matrix`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Most PMax products sit in the profitable or meh buckets, with a small minority in flukes. Zombies (zero impressions) and costly (clicks without conversions) together stay under 30% of the catalog. Past that, either the feed rotted (out of stock, broken images, mispriced) or the campaign structure isn't routing budget to product clusters that work.
- **Settings:** `minSpendForCostly` = 25 (products spending at least this with no conversions are costly); `minClicksForFluke` = 10 (conversions on products with fewer clicks are flukes; minimum 1); `profitableRoas` = 2 (converting products at or above this ROAS are profitable); `maxBadSharePct` = 30 (flag accounts where zombies plus costly exceed this share of the catalog).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, segments.product_item_id, segments.product_title,
  metrics.impressions, metrics.clicks, metrics.conversions,
  metrics.cost_micros, metrics.conversions_value
FROM shopping_performance_view
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows with no item ID. Group by `(customer_id, product_item_id)` (the same item across several PMax campaigns sums together): sum impressions, clicks, conversions, cost, value.
2. Classify each product, in this order: impressions == 0 → zombie; clicks > 0 and conversions == 0 → costly if cost `>= minSpendForCostly`, else zero-conv; conversions > 0 → fluke if clicks `< minClicksForFluke`, else profitable if ROAS (value / cost, 0 when cost is 0) `>= profitableRoas`, else meh; anything else (impressions but no clicks and no conversions) → meh.
3. Per `customer_id`: total products, count per bucket, costly spend = sum of cost of costly products. Bad share = (zombies + costly) / total × 100. Flag where bad share `> maxBadSharePct`. Sort by bad share descending.

**Result**

- **warn:** at least one flagged account. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} accounts have more than {maxBadSharePct}% of their PMax catalog in zombies (zero impressions) or costly (clicks without conversions)." Table (first 20): account, total products, zombies, costly, profitable, bad share % (0 decimals), costly spend.
- **Action:** Pull the worst offenders by spend (the costly bucket). Exclude them via listing-group rules, fix the underlying product (images, price, title), or split the catalog into separate PMax campaigns by product cluster so strong products don't subsidise weak ones.

## PMax channel split

- **ID:** `pmax-channel-split`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each PMax campaign distributes spend across 3 or more asset groups, with no single group taking more than 70% of the budget. PMax learns better against diversified creative and audience signals. The true channel split inside PMax (Search, Shopping, Video, Display) isn't available as a single GAQL dimension, so this proxies it through asset-group concentration.
- **Settings:** `minSpend` = 200 (skip PMax campaigns spending less than this over 30 days); `minAssetGroups` = 2 (flag campaigns with fewer active asset groups with spend in the window; minimum 1); `maxTopShare` = 0.7 (flag when the top asset group's share of spend exceeds this fraction, clamped to 0–1).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, asset_group.id, asset_group.name,
  metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
FROM asset_group
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by `(customer_id, campaign.id, asset_group.name)` and sum spend (the engine keys groups by name within a campaign).
2. Per `(customer_id, campaign.id)`: total = sum of group spend; skip when total `< minSpend`. Top group = highest spend; top share = top spend / total; group count = number of groups.
3. Flag where group count `< minAssetGroups` OR top share `> maxTopShare`. Sort by top share descending.

**Result**

- **opportunity:** at least one flagged campaign. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} PMax campaigns run on fewer than {minAssetGroups} asset groups or have one asset group taking more than {maxTopShare × 100}% of spend. Either the campaign narrowed onto its best-performing group, or the others are misconfigured and starving." Table (first 20): account, campaign, asset group count, total spend, top group share % (0 decimals), top group name.
- **Action:** Open each PMax campaign's asset groups. If a single group dominates intentionally (single product line, one audience), split it into its own campaign so reporting is comparable. Otherwise audit the underperforming asset groups for missing assets, mismatched audience signals or stale URLs.

## Search–PMax cannibalisation

- **ID:** `search-pmax-cross-cannibalisation`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No PMax category labels overlap with active Search keywords in the same account. Branded queries are the most common leak: Search ROAS on brand typically runs about 4x stronger than PMax on the same query, so any branded overlap pays twice for traffic Search would have won at lower CPC. Fix with brand exclusions on PMax (or PMax-side negatives) so each query routes cleanly to one campaign.
- **Settings:** `minLabelClicks` = 10 (only flag labels with at least this many 30-day PMax clicks); `minLabelConversions` = 0 (alternate threshold: also include labels with at least this many PMax conversions even below the click floor; 0 disables it). Brand terms: `brand_terms` from `ads/google/index.md`.

**Queries**

Query A and Query B: the same active-PMax-campaign list and per-campaign `campaign_search_term_insight` query as in PMax non-converting categories (last 30 days).

Query C, active Search keywords (no date range):

```sql
SELECT customer.descriptive_name, ad_group_criterion.keyword.text, campaign.name
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. Normalise text as `strip().lower()` with runs of whitespace collapsed to one space. From Query C, build per `customer_id` a dict of normalised keyword text → the first Search campaign name seen with it.
2. Brand regex: compile `\b(term1|term2|...)\b` case-insensitive from the escaped brand terms; none set means no regex.
3. If Query A returned no campaigns, stop: ok. For each PMax campaign whose account has at least one Search keyword: drop insight rows with an empty label, group by normalised label (keep the first raw label), sum clicks, conversions, value.
4. Keep labels whose normalised text exactly matches a Search keyword in the same account AND (clicks `>= minLabelClicks` OR (`minLabelConversions > 0` AND conversions `>= minLabelConversions`)). Brand = regex match on the raw label, or None when there is no regex.
5. Sort by PMax clicks descending. Totals: overlaps, distinct accounts, total PMax clicks and conversions, counts of brand true, false and None.

**Result**

- **warn:** at least one overlap. **ok:** otherwise.
- **unknown:** Query A and Query C both errored on every account and returned no rows.
- **Report:** "{n} overlapping query label(s) found across {accounts} account(s): each is a query where PMax bids alongside an active Search keyword in the same account. PMax took {clicks} clicks and {conversions} conversions on these labels in the last 30 days." With brand terms set, add: "Of those, {brand} match a brand term (route to PMax brand exclusions) and {generic} are generic (route to Search negatives or PMax-side negatives, depending on which campaign converts better)." Without brand terms: "Brand routing is unavailable: no brand terms are set, so every overlap is unclassified." Table (first 30): account, label, brand, PMax campaign, Search campaign, PMax clicks, PMax conversions, PMax conversion value.
- **Action:** Without brand terms, first add `brand_terms` to `ads/google/index.md` and re-run. Then for each label: brand true → add it to PMax brand exclusions so Search owns brand cleanly; brand false → compare PMax vs Search efficiency on the matching keyword and add the label as a negative on the losing campaign. Goal is zero overlap by next month.

## PMax audience signals

- **ID:** `pmax-audience-signals`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each PMax asset group has audience signals (customer list, custom segment, in-market) telling PMax who to reach.
- **Settings:** `minSignals` = 1 (asset groups with fewer signals are flagged).

**Queries**

Query A, enabled asset groups:

```sql
SELECT customer.descriptive_name,
  asset_group.id, asset_group.resource_name, asset_group.name, campaign.id, campaign.name
FROM asset_group
WHERE asset_group.status = 'ENABLED'
```

Query B, signals (select only the asset group: selecting the signal payload such as `asset_group_signal.audience` fails with `PROHIBITED_FIELD_IN_SELECT_CLAUSE`):

```sql
SELECT asset_group_signal.asset_group
FROM asset_group_signal
```

**Analyse with Python**

1. Count Query B rows per `asset_group_signal.asset_group` resource name.
2. For each Query A row, look up the count by `asset_group.resource_name` (fallback `customers/<customer_id>/assetGroups/<id>`; no match = 0). Flag groups with count `< minSignals`.
3. Total signals = sum of all counts; covered = total groups − flagged.

**Result**

- **warn:** at least one flagged group. **ok:** otherwise.
- **unknown:** Query A errored on every account ("asset_group query failed: ..."), or Query B errored on every account ("asset_group_signal query failed: ...").
- **Report:** "{n} of {total} Performance Max asset group(s) don't have any audience signals attached. Without signals PMax has to work out who to target from scratch; it explores more widely and takes longer to find what converts." Add total signals and "{covered} of {total}" covered. Table (first 20): account, asset group, campaign, signals.
- **Action:** For each asset group, open Audience signals in Google Ads and add your most valuable segments: a customer list, a custom audience built from converters, or in-market audiences matching your buyer. Multiple signals help PMax triangulate faster.
