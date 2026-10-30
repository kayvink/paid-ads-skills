---
name: google-ads-audit-channel-performance
description: Macro-level audit of where Google Ads Display, YouTube (Video), Demand Gen and Performance Max spend goes by category (content vertical or topic, placement type such as app versus web versus YouTube, ad network and device including connected TV), flagging categories with CPA well above the campaign average, brand-unsafe categories and device inefficiencies. Use when the user asks where non-search spend is going, about mobile app or connected TV performance, device splits, or category-level waste. For individual placements and exclusion lists use google-ads-audit-placement-exclusions.
---

# Audit channel-level performance

> Is spend across placement categories efficient, relevant, and brand-safe?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

At the macro level — YouTube verticals, Display site categories, app categories, device types — where is spend going, and which categories are underperforming or unsafe?

## Data required

Run for each account in scope; use a 30-day window ending yesterday. Conversions follow the primary conversion action rule in conventions section 3.

The Google Ads API doesn't expose a content vertical for automatic placements. Build the category view from what it does expose: device, ad network, placement type, and topics where the account targets them. When the user wants verticals beyond that, classify the top placements by name yourself and say the grouping is a judgement.

```sql
-- Spend by campaign, device and network
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  segments.device, segments.ad_network_type,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'DEMAND_GEN', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`segments.device` is `DESKTOP`, `MOBILE`, `TABLET`, `CONNECTED_TV` or `OTHER`. `segments.ad_network_type` separates Display network (`CONTENT`), `YOUTUBE`, `SEARCH`, `SEARCH_PARTNERS` and `MIXED` (PMax reports most of its traffic as `MIXED`). Exchange-level detail for Display isn't available in the API.

```sql
-- Spend by placement type (web, app, YouTube) on Display, Video and Demand Gen
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  detail_placement_view.placement_type, detail_placement_view.display_name,
  metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM detail_placement_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'DEMAND_GEN')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`MOBILE_APPLICATION` rows are the mobile app category; `MOBILE` device rows without app placements are mobile web.

```sql
-- Topic (content vertical) performance, where topic targeting is used
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group_criterion.topic.path,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM topic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

An empty result means the account doesn't target topics; say verticals weren't available rather than treating it as clean.

```sql
-- PMax placement insights (impressions only)
SELECT customer.descriptive_name, campaign.id, campaign.name,
  performance_max_placement_view.placement_type, performance_max_placement_view.display_name,
  metrics.impressions
FROM performance_max_placement_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Targets: prefer the target CPA or ROAS for the campaign's group in `ads/google/rules/*.md`, falling back to the campaign's bidding target (`campaign.target_cpa.target_cpa_micros`, `campaign.maximize_conversions.target_cpa_micros`, `campaign.target_roas.target_roas`, `campaign.maximize_conversion_value.target_roas`).

## Method

Use Python for every step: sum each query's rows per `(customer_id, campaign.id, category)` where category is the device, network, placement type or topic path, then derive CPA = cost / conversions, ROAS = value / cost and CPM = cost / impressions × 1,000 from the sums.

### 1. Map spend by category

For each campaign type (Display, YouTube, Demand Gen, PMax), break down spend by:
- Content vertical / site category (topic path where available; placement type otherwise)
- Device type (desktop, mobile web, mobile app, tablet, connected TV)
- Exchange / network (for Display: the ad network type the API exposes)

Print each category's share of its campaign type's spend, top categories first.

### 2. Compare category performance

For each category:
- CPA/ROAS vs campaign average: `cpa_ratio = category_cpa / campaign_cpa` from the same campaign's totals
- Spend share (% of campaign spend)

Flag categories where CPA >= 1.5x campaign average or ROAS materially below target. A category with spend and zero conversions in a campaign that converts has an undefined CPA: list it as "no conversions" with its spend.

### 3. Brand safety at category level

Flag inherently problematic categories regardless of performance:
- Kids' content
- Explicit / adult
- Conspiracy / extremism
- Made-for-advertising (MFA) sites
- Low-quality mobile gaming apps

Match topic paths and placement display names against these categories in Python (a keyword pass on the text, reviewed by hand), and include the PMax placement insights by impressions.

### 4. Device performance split

Check device-level performance for material inefficiency:
- Mobile app spend with weak ROAS (common on Display and PMax)
- Connected TV with high CPM but low conversion attribution
- Desktop vs mobile performance gap: compare CPA and CVR (conversions / clicks) per device within each campaign type

### 5. Prioritise findings

| Priority | Criteria |
|----------|---------|
| Critical | Brand safety category, OR category CPA >= 2x average with material spend |
| Moderate | Category CPA 1.5-2x average, OR device split showing clear inefficiency |
| Low | Minor category underperformance, low-spend categories |

Apply the minimum-data rule in `references/priority-tiers.md`: below the event threshold, mark the result as directional.

## Interpretation guide

- Category-level analysis reveals structural allocation problems that placement-level analysis misses. A single bad placement is a tactical fix; an entire category underperforming is a strategic one.
- Mobile app inventory is the most common category-level waste on Display. Google includes it by default, and most advertisers see 30-80% higher CPA from in-app placements vs web.
- PMax category insights are limited. The audit can flag overall device splits and gross category performance, but granular exclusion control is restricted.
- YouTube vertical performance varies by advertiser. Entertainment/music categories typically have high reach but low intent; educational/how-to categories often convert better for B2B.

## Output

One finding: `category: budget`, `kind: audit`. Fill the standard body with:

1. **Spend distribution:** category breakdown per campaign type (top categories by spend %).
2. **Category performance table** (sorted by absolute variance from average): account | campaign | category/device | spend % | CPA/ROAS vs avg | status (Efficient / Inefficient / Unsafe) | priority | recommendation (Exclude / Cap / Scale / Monitor).
3. **Brand safety flags** (if any): category | campaigns | spend | action.
4. **Device summary:** device split per campaign type | performance by device | recommendations (for example a device bid adjustment or excluding app categories).
5. **Wrap-up:** biggest category waste, brand safety issues, device inefficiencies, estimated savings. Compute savings in Python as the spend on categories flagged Exclude, and state that it assumes the excluded spend isn't replaced by equally weak inventory.
