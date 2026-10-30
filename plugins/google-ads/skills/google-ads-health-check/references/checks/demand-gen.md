# Demand Gen checks

These checks cover Demand Gen: campaigns with `campaign.status = 'ENABLED'` and `campaign.advertising_channel_type = 'DEMAND_GEN'` (the product-feed check also reads Shopping and Performance Max spend, the lookalike check reads `user_list`). Shared setup for every entry: the window is the last 30 days ending yesterday (`<start>` = today minus 30 days, `<end>` = yesterday); run each query once per account in scope; sum metric columns per entity key in Python (keys always include `customer_id`) and divide every `*_micros` field by 1e6. A check is **unknown** when its main Demand Gen query errored on every account and returned no rows (report each account's error); partial failures still run and name the failed accounts. A check with no observation is **ok** (including accounts with no Demand Gen campaigns); with observations its status is the worst observation (warn > opportunity). Report accounts by `customer.descriptive_name` and money in `customer.currency_code`.

## Demand Gen bid strategy

- **ID:** `demandgen-bid-strategy`
- **Category:** bidding · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Demand Gen campaigns run on Maximize Conversions, Target CPA or Target ROAS, the conversion-based strategies the format was built for. Google's own Demand Gen guidance explicitly warns against Maximize Clicks: click strategies spend the visual format's strength on traffic, not outcomes.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.bidding_strategy_type,
  metrics.cost_micros, metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DEMAND_GEN'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by `(customer_id, campaign.id)`: sum spend and conversions; keep the upper-cased `bidding_strategy_type`.
2. Offenders: strategy in {`MAXIMIZE_CLICKS`, `TARGET_SPEND`, `MANUAL_CPC`, `ENHANCED_CPC`}. Sort by spend descending; total = sum of offender spend.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Demand Gen campaigns are running on click-based bidding (Max Clicks or similar), covering about {total} of 30-day spend. Google's own Demand Gen guidance explicitly warns against these strategies; the format is designed for conversion-based optimisation." Table (first 20): account, campaign, current strategy, 30-day conversions (1 decimal), spend.
- **Action:** Migrate each campaign to Maximize Conversions (or tCPA / tROAS once enough volume is built). If conversion volume is too low to switch to a target, Maximize Conversions still beats Max Clicks: the visual creative needs the conversion signal to know who to show what.

## Demand Gen conversion volume

- **ID:** `demandgen-conversion-volume`
- **Category:** bidding · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each Demand Gen campaign on tCPA or tROAS has at least 50 conversions in 30 days. Below that, Maximize Conversions is the right starting point: the bidder gets the conversion signal it needs without being held to a target it doesn't have the data to hit. Demand Gen is signal-hungry; target bidding without volume spends without converging.
- **Settings:** `minConversions` = 50 (below this 30-day count, target-based bidding lacks signal on Demand Gen; negative clamps to 0).

**Queries**

Same query as Demand Gen bid strategy.

**Analyse with Python**

1. Group by `(customer_id, campaign.id)`: sum spend and conversions; keep the upper-cased strategy.
2. Offenders: strategy in {`TARGET_CPA`, `TARGET_ROAS`} AND conversions `< minConversions`. Sort by spend descending.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Demand Gen campaigns run Target CPA or Target ROAS with fewer than {minConversions} conversions in 30 days. The bidder is asked to hit a target it can't learn." Table (first 20): account, campaign, current strategy, 30-day conversions (1 decimal), spend.
- **Action:** Switch each campaign to Maximize Conversions (no target) until volume passes the threshold, then layer the target back in.

## Demand Gen asset coverage

- **ID:** `demandgen-asset-coverage`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each Demand Gen asset group has all three image aspect ratios: landscape (1.91:1) for Discover and Gmail, square (1:1) for the Discover feed, and portrait (9:16 or 4:5) for YouTube Shorts. Missing portrait means no Shorts delivery, missing landscape means no Gmail delivery, missing square means no Discover feed delivery.
- **Settings:** none. Fixed aspect-ratio bands (width / height): landscape 1.7 to 2.0; square 0.9 to 1.1; portrait at or below 0.7; anything else (or height 0) is other.

**Queries**

```sql
SELECT customer.descriptive_name,
  campaign.id, campaign.name, asset_group.id, asset_group.name,
  asset_group_asset.field_type, asset.id, asset.type,
  asset.image_asset.full_size.width_pixels,
  asset.image_asset.full_size.height_pixels
FROM asset_group_asset
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DEMAND_GEN'
  AND asset_group.status = 'ENABLED'
  AND asset_group_asset.status = 'ENABLED'
```

**Analyse with Python**

1. Group rows by `(customer_id, asset_group.id)`. For rows with upper-cased `asset.type == 'IMAGE'`: count images and classify width / height with the bands above, setting has-landscape, has-square, has-portrait. Rows with type `YOUTUBE_VIDEO` count as videos.
2. Missing list, per group: "Landscape (1.91:1)", "Square (1:1)", "Portrait (9:16)" for each band not present. Flag groups with any missing entry.
3. Sort by campaign name ascending. Note the portrait band: a 4:5 image (ratio 0.8) falls in "other" under the engine's bands, so it does not count as portrait even though the good-looks-like text mentions 4:5.

**Result**

- **opportunity:** at least one flagged group. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Demand Gen asset groups are missing one or more image aspect ratios. Each surface (Shorts, Discover, Gmail) wants a specific ratio; missing portrait, for example, means no YouTube Shorts delivery at all." Table (first 30): account, campaign, asset group, missing aspect ratios, image count, video count. If the query returns no rows while Demand Gen campaigns are active, say that no asset-group assets were found to check rather than reporting full coverage: Demand Gen creative may sit on ads rather than asset groups in your API version, which this check does not read.
- **Action:** For each asset group, upload the missing aspect ratios. Minimum: 1 landscape (1200×628), 1 square (1200×1200), 1 portrait (960×1200). Add several per ratio so the system can test combinations.

## Demand Gen product feed

- **ID:** `demandgen-product-feed`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Demand Gen campaigns at e-commerce accounts attach the Merchant Center product feed. Without it, the campaign serves static creative and asks the user to convert via the website, missing the roughly 33% conversion lift at the same CPA that Google reports for feed-attached Demand Gen. An account counts as e-commerce when it has Shopping or Performance Max spend in the window.
- **Settings:** none.

**Queries**

Query A, Demand Gen spend:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  customer.id, campaign.id, campaign.name, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DEMAND_GEN'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, Shopping and PMax spend (e-commerce signal):

```sql
SELECT customer.id, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SHOPPING', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query C, Demand Gen campaigns with a listing-group filter (no date range):

```sql
SELECT campaign.id
FROM asset_group_listing_group_filter
WHERE campaign.advertising_channel_type = 'DEMAND_GEN'
```

**Analyse with Python**

1. E-commerce accounts: `customer_id`s with any Query B row where cost > 0.
2. Campaigns with a feed: the set of `(customer_id, campaign.id)` in Query C.
3. Group Query A by `(customer_id, campaign.id)` and sum spend. Offenders: account is e-commerce AND the campaign is not in the feed set AND spend > 0. Sort by spend descending; total = sum of offender spend.

**Result**

- **opportunity:** at least one offender. **ok:** otherwise.
- **unknown:** Query A errored on every account (Query B and C errors are not checked; if either failed for an account, say so, because a failed Query C flags every campaign in that account).
- **Report:** "{n} Demand Gen campaigns at e-commerce accounts are running without a product feed, leaving about {total} of 30-day spend without the dynamic-product creative path. Google's own data: adding a feed lifts Demand Gen conversions by about 33% at the same CPA." Table (first 20): account, campaign, spend. The check only detects feeds through `asset_group_listing_group_filter`, so a feed linked another way would show as a false positive; state this caveat in the finding.
- **Action:** For each campaign, open Settings, Product feed and link the existing Merchant Center feed (the same one Shopping or PMax uses). Filter to the relevant product set if the full catalog is too broad. The lift shows up within 1–2 weeks of attaching.

## Demand Gen lookalike audiences

- **ID:** `demandgen-lookalike-missing`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each account spending on Demand Gen has at least one active lookalike audience, built from converters, top customers or another high-intent seed list. Without lookalikes, Demand Gen targeting is limited to Google's pre-built in-market and affinity segments.
- **Settings:** none.

**Queries**

Query A, Demand Gen spend:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'DEMAND_GEN'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, open user lists (no date range):

```sql
SELECT user_list.id, user_list.name, user_list.type,
  user_list.lookalike_user_list.seed_user_list_ids
FROM user_list
WHERE user_list.membership_status = 'OPEN'
```

**Analyse with Python**

1. A Query B row is a lookalike when `lookalike_user_list.seed_user_list_ids` is a non-empty list (or, if it arrives as a string, is non-empty and not `"[]"`). The engine identifies lookalikes this way, not by `user_list.type`. Count lookalikes per `customer_id`.
2. Sum Query A spend per `customer_id`. Offenders: accounts with Demand Gen spend > 0 and zero lookalikes. Sort by Demand Gen spend descending; total = sum of offender spend.

**Result**

- **opportunity:** at least one offending account. **ok:** otherwise.
- **unknown:** Query A errored on every account (if Query B failed for an account, that account would be flagged; say so).
- **Report:** "{n} accounts spent on Demand Gen over the last 30 days without a single active lookalike audience. About {total} of Demand Gen spend is targeted only by in-market or affinity segments, missing the cheapest first-party signal lever." Table (first 20): account, Demand Gen spend, lookalike count.
- **Action:** In each account, build at least one lookalike from your top converters or full customer list (Audience manager, Lookalike segment, seed = converters from the last 30 days or a higher-quality CRM list). Attach it to the Demand Gen ad groups as positive targeting.
