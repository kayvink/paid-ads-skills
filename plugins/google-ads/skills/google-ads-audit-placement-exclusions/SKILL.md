---
name: google-ads-audit-placement-exclusions
description: Audit where Google Ads Display, YouTube (Video), Demand Gen and Performance Max ads actually served, flagging brand-unsafe placements, placements that waste spend against the CPA target, mobile app leakage, and gaps in account-level and shared placement exclusion lists, with the right exclusion level for each. Use when the user asks about placements, brand safety, junk sites or apps, mobile app spend, or placement exclusion lists. For category, network and device-level spend use google-ads-audit-channel-performance.
---

# Audit placement exclusions

> Are placements brand-safe and high-performing, or is spend leaking to low-quality inventory?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

Which Display, YouTube, and Demand Gen placements are wasting budget on unsafe or underperforming inventory, and does the account have adequate exclusion lists?

## Data required

Run for each account in scope; use a 30-day window ending yesterday. Conversions follow the primary conversion action rule in conventions section 3.

```sql
-- Placement performance on Display, Video and Demand Gen
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  detail_placement_view.placement, detail_placement_view.display_name,
  detail_placement_view.placement_type, detail_placement_view.target_url,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM detail_placement_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'DEMAND_GEN')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`placement_type` is `WEBSITE`, `MOBILE_APPLICATION`, `YOUTUBE_VIDEO`, `YOUTUBE_CHANNEL` or `GOOGLE_PRODUCTS`. Use `group_placement_view` instead when you want domain or channel roll-ups rather than individual pages and videos.

```sql
-- PMax placements (impressions only)
SELECT customer.descriptive_name,
  campaign.id, campaign.name,
  performance_max_placement_view.display_name,
  performance_max_placement_view.placement,
  performance_max_placement_view.placement_type,
  performance_max_placement_view.target_url,
  metrics.impressions
FROM performance_max_placement_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

This view reports impressions only, no cost or conversions; use it for the brand safety scan, not the performance scan.

```sql
-- Campaign targets
SELECT customer.descriptive_name, campaign.id, campaign.name,
  campaign.bidding_strategy_type,
  campaign.target_cpa.target_cpa_micros,
  campaign.maximize_conversions.target_cpa_micros,
  campaign.target_roas.target_roas,
  campaign.maximize_conversion_value.target_roas
FROM campaign
WHERE campaign.status = 'ENABLED'
```

Prefer the target CPA or ROAS for the campaign's group in `ads/google/rules/*.md`; fall back to the campaign's bidding target; when neither exists, compare with the campaign's own average CPA and say so.

```sql
-- Account-level exclusions (placements, channels, apps, app categories, content labels)
SELECT customer.descriptive_name,
  customer_negative_criterion.type,
  customer_negative_criterion.placement.url,
  customer_negative_criterion.youtube_channel.channel_id,
  customer_negative_criterion.youtube_video.video_id,
  customer_negative_criterion.mobile_application.app_id,
  customer_negative_criterion.mobile_app_category.mobile_app_category_constant,
  customer_negative_criterion.content_label.type
FROM customer_negative_criterion
```

```sql
-- Shared placement exclusion lists and where they're applied
SELECT shared_set.id, shared_set.name, shared_set.member_count, shared_set.status
FROM shared_set
WHERE shared_set.type = 'NEGATIVE_PLACEMENTS'
  AND shared_set.status = 'ENABLED'
```

```sql
SELECT campaign.id, campaign.name, shared_set.id, shared_set.name
FROM campaign_shared_set
WHERE shared_set.type = 'NEGATIVE_PLACEMENTS'
  AND campaign_shared_set.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

```sql
-- Campaign-level placement exclusions
SELECT campaign.id, campaign.name, campaign_criterion.type,
  campaign_criterion.placement.url, campaign_criterion.youtube_channel.channel_id,
  campaign_criterion.mobile_app_category.mobile_app_category_constant
FROM campaign_criterion
WHERE campaign_criterion.negative = TRUE
  AND campaign_criterion.type IN ('PLACEMENT', 'YOUTUBE_CHANNEL', 'YOUTUBE_VIDEO', 'MOBILE_APPLICATION', 'MOBILE_APP_CATEGORY')
  AND campaign.status = 'ENABLED'
```

Also read `wiki/company.md` for brand restrictions (for example whether political content is off-limits) and `ads/google/memory/MEMORY.md` for placements the user has accepted.

## Method

Use Python to aggregate: sum the placement rows per `(customer_id, campaign.id, placement)` and, for recurrence, per `(customer_id, placement)` with a count of distinct campaigns. Derive CPA = cost / conversions and ROAS = value / cost from the sums.

### 1. Brand safety scan

Flag placements in unsafe categories regardless of performance:
- Kids' apps and channels
- Explicit or adult content
- Conspiracy / extremism / misinformation
- Political content (if brand restricts)
- Low-quality ad farms (sites with > 90% ad density)

These are always Critical: exclude account-wide.

Judge the category from the display name, placement and target URL; for borderline sites, fetch the page with your web fetch tool. Ad density can't be measured from the API, so call a site an ad farm only from what the page shows, and say it was a judgement. Do a first pass in Python with a keyword match on the display name and URL (the junk-placement list used by `google-ads-health-check` is a good start: "unblocked", "kids", "manga", "anime", "cheats", "hacks", "wallpaper", "ringtones", "coupons", "jokes", "memes", "quiz") and review every hit by hand before flagging it. Include the PMax placements in this scan.

### 2. Performance waste scan

For non-safety-flagged placements, evaluate performance:

| Priority | Criteria |
|----------|---------|
| Critical | Recurring across 2+ campaigns, high spend, CPA >= 1.5x target or 0 conversions |
| Moderate | Single campaign, meaningful spend, poor performance |
| Low | Low spend or borderline performance — monitor |

In Python, compute `cpa_vs_target = cpa / target_cpa` (or `roas / target_roas` for value campaigns) and the placement's share of its campaign's placement spend. Print each candidate's spend, share, campaign count, conversions and ratio, so "high" and "meaningful" spend are visible judgements rather than hidden ones. Apply the minimum-data rule in `references/priority-tiers.md` to zero-conversion calls on thin traffic.

### 3. Check exclusion list hygiene

From the exclusion queries:
- Do account-level exclusions or shared placement lists exist?
- Are they consistently applied across campaigns? In Python, compute the share of enabled Display, Video and Demand Gen campaigns each shared list is applied to.
- Do they cover known problematic categories (mobile game apps, MFA sites)? Check for mobile app category exclusions and content label exclusions.
- Is any flagged placement already excluded? Drop it from the recommendations and note it (exclusions apply going forward, so recent spend can predate them).

If the exclusion data can't be read (for example the queries fail for the account), note the caveat: "Account-level exclusion list data unavailable. Cross-check flagged placements against account-level lists before actioning."

### 4. Identify mobile app spend

Mobile apps frequently underperform on Display and PMax. Check:
- What share of spend goes to mobile app placements (`placement_type = 'MOBILE_APPLICATION'`)?
- Performance of app placements vs non-app placements: app CPA = app cost / app conversions, non-app CPA likewise, per campaign and in total.
- If app CPA >= 1.5x non-app average, recommend app category exclusion.

PMax app share can only be read in impressions.

### 5. Recommend exclusion level

- **Account level:** for brand safety issues and recurring poor performers across multiple campaigns.
- **Campaign level:** for campaign-specific poor performers that may work in other contexts.

## Interpretation guide

- Brand safety exclusions are non-negotiable regardless of performance metrics. A conversion from a kids' app or extremist channel is a liability, not a win.
- Mobile app placements are the most common source of Display waste. Google defaults to including them, and most advertisers see weak performance from in-app inventory.
- Recurring poor performers across campaigns indicate a systemic issue — the placement is in Google's default inventory and keeps getting served. Account-level exclusion solves it once.
- PMax placement insights are limited. Flag placement quality concerns but note that PMax offers less granular exclusion control than standalone Display/YouTube campaigns.

## Output

One finding: `category: structure`, `kind: audit`. Fill the standard body with:

1. **Coverage snapshot:** % of spend flagged (Critical / Moderate) | brand safety issues found? | exclusion lists present?
2. **Brand safety table** (if issues found): account | placement | category | campaign(s) | spend (or impressions for PMax) | priority | recommended exclusion level.
3. **Performance table** (sorted by spend desc): account | campaign | placement | spend (30d) | conversions | CPA vs target | recurring? | priority | recommended exclusion level.
4. **Mobile app summary** (if material): app spend % | app CPA vs non-app CPA | recommendation.
5. **Recommendations:** the exclusions to add, as a table the user can apply (account, level, list or campaign, placement or category, reason).
6. **Wrap-up:** safety issues, waste estimate (spend on flagged placements), top exclusion actions, caveat on list accessibility.
