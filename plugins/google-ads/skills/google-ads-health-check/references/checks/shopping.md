# Shopping checks

These checks cover Standard Shopping: campaigns with `campaign.status = 'ENABLED'` and `campaign.advertising_channel_type = 'SHOPPING'` (one check, Branded Shopping companion, also reads Performance Max). Shared setup for every entry: the window is the last 30 days ending yesterday (`<start>` = today minus 30 days, `<end>` = yesterday); run each query once per account in scope; queries that select no `segments.date` return one row per entity for the whole window, but always sum the metric columns per entity key in Python anyway (keys always include `customer_id`), and convert every `*_micros` field by dividing by 1e6. A check is **unknown** when its main query errored on every account and returned no rows (report each account's error); partial failures still run and name the failed accounts. A check with no observation is **ok**; with observations its status is the worst observation (fail > warn > opportunity). Report accounts by `customer.descriptive_name` and money in `customer.currency_code`.

## Shopping bid strategy misalignment

- **ID:** `shopping-bid-strategy-misalignment`
- **Category:** bidding · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Once a Shopping campaign has 30+ conversions in 30 days, it runs on a value-based smart bidding strategy (tROAS or Maximize Conversion Value). Click-based strategies optimise for traffic, not revenue: they ignore the per-conversion-value signal Shopping inherently has.
- **Settings:** `minConversions` = 30 (minimum 30-day conversions before value-based bidding is recommended; below this smart bidding is starved for signal; negative values clamp to 0).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.bidding_strategy_type,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by `(customer_id, campaign.id)`: sum `cost`, `conversions`, `conversions_value`; keep the first `campaign.name` and the upper-cased `bidding_strategy_type`.
2. Offenders: strategy in {`MANUAL_CPC`, `ENHANCED_CPC`, `TARGET_SPEND`, `MAXIMIZE_CLICKS`} AND `conversions >= minConversions`.
3. Sort by spend descending; total spend = sum of offender spend.

**Result**

- **opportunity:** at least one offender. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Shopping campaigns are running on click-based bidding despite having {minConversions}+ conversions in 30 days, about {total spend} of spend that could be optimising for revenue instead of clicks." Table (first 20): account, campaign, current strategy, 30-day conversions (1 decimal), 30-day conversion value, spend.
- **Action:** For each campaign with strong conversion-value tracking, migrate to Maximize Conversion Value (no target) for 2–3 weeks of learning, then layer a tROAS target once the curve stabilises. If conversion-value tracking is weaker, Maximize Conversions with tCPA is the fallback.

## Shopping network leak

- **ID:** `shopping-network-leak`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each Shopping campaign serves only on Google Search and Shopping surfaces. Display Network on a Shopping campaign serves product images on banner inventory with no Shopping intent, rarely worth the spend without a deliberate test. Search Partners on Shopping is the same conversation as on Search: opt in, monitor, decide.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  campaign.network_settings.target_search_network,
  campaign.network_settings.target_content_network,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by `(customer_id, campaign.id)`: sum spend; keep the two network booleans from the first row.
2. Display leaks: `target_content_network` is true. Partners on: `target_search_network` is true. Sort each list by spend descending.

**Result**

- **warn:** at least one display leak. **opportunity:** no display leak but at least one campaign with Search Partners on. (Both observations are reported when both exist; status is warn.) **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** Display: "{n} Shopping campaigns have the Display Network turned on. Your product images get pushed onto banner inventory with no Shopping intent." Partners: "{n} Shopping campaigns are serving on Search Partners. Not automatically wrong (partners can be net-positive), but it's an unmeasured assumption until you compare CPA/ROAS on partners vs Google Search." Each table (first 20): account, campaign, 30-day spend.
- **Action:** Display: open each campaign, Settings, Networks, and uncheck the Display Network; for Display reach on these products, run a separate Display remarketing campaign with its own budget and creative. Partners: segment by Network in Google Ads and compare ROAS on "Search partners" vs "Google search"; if partners is meaningfully worse, uncheck it in Settings, Networks.

## Shopping search term waste

- **ID:** `shopping-search-term-waste`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No single Shopping query burns meaningful money without converting. Accounts that review this weekly steadily push out informational queries, off-product matches and competitor brand traffic, lifting ROAS without raising bids.
- **Settings:** `minWastedCost` = 50 (flag queries that spent at least this much, in account currency, over 30 days with zero conversions; negative clamps to 0).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  search_term_view.search_term, search_term_view.status, campaign.name,
  metrics.cost_micros, metrics.clicks, metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
```

**Analyse with Python**

1. Drop rows with an empty search term. Group by `(customer_id, search_term, campaign.name)`: sum cost, clicks, conversions; mark the group already negated if any row's upper-cased `search_term_view.status` is `EXCLUDED`, `ADDED_EXCLUDED` or `NONE`.
2. Offenders: not already negated AND `cost >= minWastedCost` AND `conversions == 0`. Sort by cost descending; total = sum of offender cost.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Shopping search terms spent at least {minWastedCost} over 30 days with zero conversions, about {total} of waste. Shopping queries can't be opted into by keyword, only opted out of by negative." Table (first 30): account, search term, campaign, clicks, cost.
- **Action:** Add the worst offenders to a shared negative-keyword list attached to all Shopping campaigns. For each query decide: informational ("how to", "reviews"), off-product (wrong category) or competitor brand, and negate accordingly. If it's on-intent but doesn't convert, the problem is the listing or landing page: tag it for product-level investigation.

## Shopping priority alignment

- **ID:** `shopping-priority-alignment`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** When an account runs more than one Shopping campaign, priority levels (Low/Medium/High) are set deliberately so generic queries route to a different campaign than branded or high-intent ones. Multi-campaign accounts with every Shopping campaign at the same priority leave the simplest query-routing lever unused.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.shopping_setting.campaign_priority,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by `(customer_id, campaign.id)`: sum spend; keep the priority as an integer (missing = 0). Priority: 0 = Low, 1 = Medium, 2 = High.
2. Per `customer_id`: skip accounts with fewer than 2 campaigns. Flag accounts where the set of distinct priorities has exactly one value; record the campaign count, that priority, total spend, and the comma-joined campaign names.
3. Sort flagged accounts by total spend descending.

**Result**

- **opportunity:** at least one flagged account. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} accounts run multiple Shopping campaigns all at the same priority level. Priority routes which campaign wins the auction when a query matches several; it's the cheapest way to keep generic queries out of your branded Shopping campaign." Table (first 20): account, Shopping campaigns, priority level, total spend, campaigns.
- **Action:** Decide a query-sculpting structure. The typical setup is High priority for generic/discovery (low bids, broad negative coverage), Medium for category, Low for branded (highest bids). Reset priorities in each campaign's Settings, Additional settings.

## Shopping negative lists

- **ID:** `shopping-negative-lists`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every active Shopping campaign has at least one shared negative-keyword list attached. The list centralises core junk negatives (informational queries, competitor brand, off-product terms), so adding to it once protects every campaign.
- **Settings:** none.

**Queries**

Query A, Shopping campaigns:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Query B, shared negative lists attached to campaigns (no date range):

```sql
SELECT campaign_shared_set.campaign, campaign_shared_set.shared_set, shared_set.type
FROM campaign_shared_set
WHERE campaign_shared_set.status = 'ENABLED'
  AND shared_set.type = 'NEGATIVE_KEYWORDS'
```

**Analyse with Python**

1. From Query B, build the set of `campaign_shared_set.campaign` resource names (`customers/<cid>/campaigns/<id>`).
2. Group Query A by `(customer_id, campaign.id)`, sum spend, and build each campaign's resource name as `customers/<customer_id>/campaigns/<campaign.id>`.
3. Offenders: campaigns whose resource name is not in the set. Sort by spend descending; total = sum of offender spend.

**Result**

- **opportunity:** at least one offender. **ok:** otherwise.
- **unknown:** Query A errored on every account (Query B errors are not checked; if Query B failed for an account, every campaign in it would be flagged, so say so).
- **Report:** "{n} Shopping campaigns have no shared negative-keyword list attached, covering about {total} of 30-day spend. Each campaign protects itself in isolation: a junk query already negated in one campaign can still match in others." Table (first 30): account, campaign, spend.
- **Action:** Create one shared negative list per category of waste (for example "Junk core", "Competitor brand", "Informational") and attach it to every Shopping campaign. Pull existing campaign-level negatives into the shared lists, then drop the duplicates.

## Branded Shopping companion

- **ID:** `branded-shopping-companion`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Any account running Performance Max also runs a branded Standard Shopping campaign at low priority with manual CPC. The companion defends branded queries at low cost while PMax handles non-brand inventory.
- **Settings:** `requireBrandedShoppingCompanion` = true (turn off for accounts that don't run Shopping, for example lead gen; when off the check returns ok without querying).

**Queries**

```sql
SELECT customer.descriptive_name,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  campaign.shopping_setting.campaign_priority, campaign.bidding_strategy_type
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('PERFORMANCE_MAX', 'SHOPPING')
```

**Analyse with Python**

1. If the setting is false, stop: ok.
2. Per `customer_id`: `has_pmax` = any row with channel type `PERFORMANCE_MAX`; `has_companion` = any row with channel type `SHOPPING` AND priority == 0 (missing priority counts as 0) AND upper-cased bidding strategy == `MANUAL_CPC`.
3. Flag accounts with `has_pmax` and not `has_companion`.

**Result**

- **opportunity:** at least one flagged account. **ok:** otherwise (including no PMax anywhere).
- **unknown:** the query errored on every account.
- **Report:** "{n} accounts run Performance Max without a branded Standard Shopping companion. PMax intercepts branded clicks at higher CPC than a defended branded campaign would pay, inflating PMax's reported ROAS." List every flagged account.
- **Action:** Create a Standard Shopping campaign with priority Low, bidding Manual CPC (cap CPC near your branded baseline), and the feed scoped to branded inventory only. Run it alongside PMax. Low priority and manual CPC defend branded queries cheaply without competing with PMax's bidding. Priority 0 is Google's lowest of the three Shopping priorities.

## Shopping catch-all groups

- **ID:** `shopping-catch-all-groups`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each Shopping ad group subdivides its products down to meaningful units (item ID, brand, category). The "Everything else" bucket exists as a safety net but doesn't carry most of the spend: a healthy ad group has under `maxOtherShare` of its spend in the catch-all.
- **Settings:** `maxOtherShare` = 30 (flag when the catch-all leaf takes more than this percent of its ad group's 30-day spend); `minAdGroupSpend` = 50 (skip ad groups spending less than this over 30 days).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.listing_group.type,
  ad_group_criterion.listing_group.case_value.product_item_id.value,
  metrics.cost_micros, metrics.clicks, metrics.conversions
FROM product_group_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND ad_group.status = 'ENABLED'
  AND ad_group_criterion.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Keep only rows with `listing_group.type == 'UNIT'`. A row is "other" when `case_value.product_item_id.value` is empty or missing.
2. Group by `(customer_id, ad_group.id)`: total spend over all UNIT rows, and "other" spend over the other rows.
3. Skip groups with total spend `< minAdGroupSpend` or other spend == 0. Share = other spend / total spend × 100. Flag where share `> maxOtherShare`.
4. Sort by share descending. This is an approximation: listing groups can subdivide on dimensions other than item ID, but item-ID leaves are the most common terminal level.

**Result**

- **opportunity:** at least one flagged ad group. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Shopping ad groups have more than {maxOtherShare}% of 30-day spend running through the 'Everything else' catch-all. High-value SKUs get the same default bid as low-value ones." Table (first 20): account, campaign, ad group, other spend, other share %, ad group spend.
- **Action:** For each ad group, find the top-spending products inside "Everything else" (segment by Item ID), promote them to their own UNIT leaves with intentional bids, then verify the new leaves move out of the catch-all on the next refresh. Use `custom_label_0..4` in the feed to make this repeatable.

## Ghost products

- **ID:** `shopping-ghost-products`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Every product in an active Shopping campaign is at least getting served. Products with zero 30-day impressions are usually disapproved, sitting in an "Other" bucket with too-low bids, or losing every auction they enter. None of those resolve themselves.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name,
  campaign.id, campaign.name, segments.product_item_id, segments.product_title,
  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM shopping_performance_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows missing campaign ID or item ID. Group by `(customer_id, campaign.id, product_item_id)`: sum impressions, clicks, spend, conversions; keep the first title.
2. Ghosts: summed impressions == 0. No sort.

**Result**

- **warn:** at least one ghost. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} products in active Shopping campaigns received zero impressions over the last 30 days. Either Merchant Center disapproved them, the product group's bid is too low to enter the auction, or they lose every auction they're eligible for." Table (first 30): account, campaign, item ID, title. Note that products absent from the report entirely can't be detected here; they need a Merchant Center coverage check.
- **Action:** For each product, check Merchant Center for disapprovals first (most common cause), then verify the product group it sits in has a non-default bid, then check Auction Insights for the relevant query category. If the answer is "we're losing on rank", raise the bid for that product group.

## Shopping impression share

- **ID:** `shopping-impression-share-rank`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** On every meaningfully funded Shopping campaign, the 30-day impression share lost to rank stays below `maxLostRankPct`. When it doesn't, the lever isn't bidding alone: it's feed quality, title relevance and product approval. Unlike Search, Shopping rank loss is mostly about the feed, not Quality Score.
- **Settings:** `maxLostRankPct` = 25 (flag campaigns whose lost IS (rank) exceeds this percent); `minCampaignSpend` = 100 (skip campaigns spending less than this over 30 days).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  metrics.search_rank_lost_impression_share,
  metrics.search_absolute_top_impression_share,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by `(customer_id, campaign.id)`: sum spend; for the two share fields take the plain mean over the campaign's rows (the query returns one row per campaign for the window, so this is just the window value; if your MCP returns per-day rows, the mean of the daily values is what the engine used).
2. Skip campaigns with spend `< minCampaignSpend`. Lost rank % = mean lost rank × 100; abs-top % = mean abs-top × 100. Flag where lost rank % `> maxLostRankPct`.
3. Sort by lost rank % descending.

**Result**

- **warn:** at least one flagged campaign. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Shopping campaigns lost more than {maxLostRankPct}% of impressions on Ad Rank over 30 days. Shopping rank is mostly feed quality plus bid; the fix is rarely just raising the bid." Table (first 20): account, campaign, lost IS rank % (1 decimal), absolute top IS % (context), spend.
- **Action:** For each campaign, first check Merchant Center for product disapprovals (a single popular SKU dropping out lowers Ad Rank). Then look at title relevance for the top-loss queries: Google ranks Shopping listings on how well the feed text matches the query. Only after those, raise the product-group bid.

## Lin–Rodnitzky efficiency ratio (Shopping)

- **ID:** `shopping-lin-rodnitzky`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Total cost divided by converting-product cost sits between 1.5 and 2.0: mostly funding products that convert, with enough exposure on new SKUs that haven't built a track record. Below 1.5 the catalog is bid too conservatively (only winners run). Above 2.5 too much spend goes to dead-weight products. This is the Lin–Rodnitzky ratio applied at product level instead of search-term level.
- **Settings:** `minTotalProducts` = 50 (skip accounts with fewer products served in the window; minimum 1). Classification bands are fixed: below 1.5 too conservative (opportunity), 1.5 to below 2.0 well-managed (ok), 2.0 to below 2.5 too aggressive (warn), 2.5 and above mismanaged (warn).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  segments.product_item_id, segments.product_title,
  metrics.cost_micros, metrics.conversions
FROM shopping_performance_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows with no item ID. Group by `(customer_id, product_item_id)` (across campaigns): sum cost and conversions.
2. Per `customer_id`: total cost = sum of product cost; converting cost = sum of cost of products with conversions > 0; product count = number of products.
3. Skip accounts with product count `< minTotalProducts` or converting cost <= 0. Ratio = total cost / converting cost (2 decimals); converting share = converting cost / total cost × 100 (0 decimals).
4. Sort by ratio descending. Aggressive = ratio >= 2.0; conservative = ratio < 1.5.

**Result**

- **warn:** at least one aggressive account; the observation is titled by the worst account's band ("too aggressive" for 2.0–2.5, "mismanaged" for 2.5+). **opportunity:** at least one conservative account (reported alongside the warn when both exist). **ok:** otherwise, including all accounts in 1.5–2.0.
- **unknown:** the query errored on every account.
- **Report:** Aggressive: "{n} account(s) have a Shopping L/R ratio at or above 2.0: total Shopping spend is at least double the spend on converting products. Worst account is at {ratio} ({converting share}% of spend on converters)." Conservative: "{n} account(s) have a Shopping L/R ratio below 1.5: almost all spend is on converting SKUs, so new or recovering products get no exposure. Likely under-bidding the long tail." Each table (first 20): account, ratio, total cost, converting cost, converting share %, product count.
- **Action:** Aggressive: segment products by 30-day performance, pause or zero-bid the long tail of zero-conversion, high-spend SKUs and keep converting ones funded; re-check in 2 weeks, target 1.5–2.0. Conservative: raise bids or move the long tail into a separate campaign with broader bids; the target range is 1.5–2.0, and below it you trade testing surface for short-term efficiency.

## High-spend non-converting products

- **ID:** `shopping-high-spend-no-conv`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No single product spends meaningful money without paying back. The threshold is relative to each campaign's own average CPA, so luxury and commodity Shopping accounts both get a fair read.
- **Settings:** `cpaMultiplier` = 2 (flag products whose 30-day cost exceeds this multiple of their campaign's CPA with zero conversions; minimum 1); `minSpend` = 25 (skip products spending less than this over 30 days).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, segments.product_item_id, segments.product_title,
  metrics.cost_micros, metrics.clicks, metrics.conversions
FROM shopping_performance_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows missing campaign ID or item ID. Group by `(customer_id, campaign.id, product_item_id)`: sum cost, clicks, conversions; keep the first title.
2. Campaign baseline: group the product table by `(customer_id, campaign.id)`, campaign CPA = sum cost / sum conversions (treat as no baseline when conversions are 0).
3. Skip products with conversions > 0 or cost `< minSpend`, and products whose campaign has no baseline. Flag where cost `> campaign CPA × cpaMultiplier`. Record CPA ratio = cost / campaign CPA (1 decimal).
4. Sort by cost descending; total = sum of offender cost.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} products spent more than {cpaMultiplier}× their campaign's average CPA over 30 days with zero conversions, about {total} on listings the rest of the campaign already paid back. Either the product is mispriced for its category, the listing has a quality issue, or the landing page is broken." Table (first 30): account, campaign, item ID, title, cost, campaign CPA, CPA ratio.
- **Action:** For each product, open the listing and compare it against converting peers in the same campaign. If price is off, fix the feed; if the listing is fine, click through to the landing page and verify the post-click experience matches what the results page showed. As a backstop, exclude the product (custom label plus supplemental feed) until the underlying issue is fixed.

## Zero-click products

- **ID:** `shopping-zero-click-products`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every served product earns some clicks in proportion to its impressions. Products with hundreds of 30-day impressions and zero clicks compete in the auction but lose every click: the listing itself is the problem, not bidding or feed eligibility.
- **Settings:** `minImpressions` = 200 (only flag products with at least this many 30-day impressions; minimum 1).

**Queries**

```sql
SELECT customer.descriptive_name,
  campaign.id, campaign.name, segments.product_item_id, segments.product_title,
  metrics.impressions, metrics.clicks
FROM shopping_performance_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows missing campaign ID or item ID. Group by `(customer_id, campaign.id, product_item_id)`: sum impressions and clicks; keep the first title.
2. Offenders: impressions `>= minImpressions` AND clicks == 0. Sort by impressions descending.

**Result**

- **warn:** at least one offender. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} products had at least {minImpressions} impressions over the last 30 days and zero clicks. The listing shows but loses every click decision, usually a title, image, price or rating gap against competing listings." Table (first 30): account, campaign, item ID, title, impressions.
- **Action:** Open the product listing in Merchant Center and compare it with the top competing listings for the same query. Fixes in order of cost: rewrite the title to lead with the most-searched specs, put the lead image on a clean background, get reviews flowing if the product has none, then check price competitiveness.

## Shopping product concentration

- **ID:** `shopping-product-concentration`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Shopping spend is reasonably distributed across the active catalog: the top 5 products take less than `maxConcentrationPct` of campaign spend. Above that, the campaign is hostage to a few SKUs and benefits from segmenting them out.
- **Settings:** `maxConcentrationPct` = 70 (flag when the top N products take more than this percent of spend); `topN` = 5 (how many top-spending products count; minimum 1); `minCampaignSpend` = 200 (skip campaigns spending less than this over 30 days).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, segments.product_item_id,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM shopping_performance_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows missing campaign ID or item ID. Group by `(customer_id, campaign.id, product_item_id)`: sum cost.
2. Per `(customer_id, campaign.id)`: total = sum of product cost; skip when total `< minCampaignSpend`. Sort products by cost descending; top-N spend = sum of the first `topN`. Share = top-N spend / total × 100.
3. Flag where share `> maxConcentrationPct` AND the campaign has more than `topN` products. Sort by share descending.

**Result**

- **opportunity:** at least one flagged campaign. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} Shopping campaigns have more than {maxConcentrationPct}% of 30-day spend going to just {topN} products. Healthy when those SKUs have ROAS headroom and inventory; fragile when one goes out of stock or gets disapproved." Table (first 20): account, campaign, top-N share % (1 decimal), campaign spend, top products (= topN).
- **Action:** Decide whether the top-spending SKUs are strategic (you want to push them) or accidental (the long tail isn't getting served). If strategic, segment them into their own campaign with a higher tROAS target. If accidental, raise bids on the rest of the catalog or restructure product groups so the long tail can compete.

## Product ROAS outliers

- **ID:** `shopping-product-roas-outliers`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** No converting product posts a ROAS dramatically lower than the rest of its campaign's distribution. The threshold is the campaign's own median minus N MADs, so each campaign is judged against its own product mix.
- **Settings:** `madThreshold` = 2.0 (flag products this many MADs below the campaign median ROAS; minimum 0.1); `minProducts` = 5 (minimum converting products per campaign; minimum 3); `minSpend` = 25 (skip products spending less than this over 30 days).

**Queries**

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, segments.product_item_id, segments.product_title,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM shopping_performance_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SHOPPING'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows missing campaign ID or item ID. Group by `(customer_id, campaign.id, product_item_id)`: sum cost, conversions, conversion value; keep the first title.
2. Per `(customer_id, campaign.id)`: converters = products with conversions > 0 AND cost > 0 AND value > 0. Skip when fewer than `minProducts` converters.
3. ROAS = value / cost per converter. Median = middle value (mean of the two middle values for an even count); MAD = median of `|roas − median|`. Skip the campaign when median <= 0 or MAD <= 0.
4. Cutoff = median − `madThreshold` × MAD. Flag converters with cost `>= minSpend` and ROAS `< cutoff`; record MADs below = (median − ROAS) / MAD (1 decimal).
5. Sort by cost descending.

**Result**

- **warn:** at least one flagged product. **ok:** otherwise.
- **unknown:** the query errored on every account.
- **Report:** "{n} products post a ROAS more than {madThreshold} MADs below their campaign's median despite converting. They earn, but at a rate that drags the campaign's efficiency, usually a margin or pricing problem: high-AOV products absorbing budget that could go to higher-ROAS peers." Table (first 30): account, campaign, item ID, title, ROAS, campaign median ROAS, MADs below, cost.
- **Action:** For each product, check margin against the campaign's median-ROAS peers. If it is genuinely lower-margin, segment it into its own campaign with a separate budget and tROAS target. If it should match the others, the listing or feed quality is the issue: rewrite the title and check landing-page conversion.
