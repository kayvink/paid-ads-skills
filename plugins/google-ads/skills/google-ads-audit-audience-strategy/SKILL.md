---
name: google-ads-audit-audience-strategy
description: Audit how a Google Ads account uses audiences on YouTube (Video), Display, Demand Gen and Performance Max, covering first-party lists and their size, the split between prospecting and retargeting campaigns, channel-appropriate audience signals, segment-level CPA and ROAS against the campaign average, retargeting lookback windows, frequency caps, budget share and audience overlap. Use when the user asks about remarketing, customer match, audience targeting, prospecting versus retargeting balance, or whether audience segments are worth their spend.
---

# Audit audience strategy

> Are audiences used strategically across YouTube, Display, and Demand Gen — with proper first-party data, clear prospecting vs retargeting separation, and minimal wasteful overlap?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

Does the account have first-party audiences deployed, a clear structural split between prospecting and retargeting, and audience-level performance that justifies current allocation?

## Data required

Run for each account in scope; use a 30-day window ending yesterday. Conversions follow the primary conversion action rule in conventions section 3.

```sql
-- Campaigns in scope with spend, results and frequency caps
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.status,
  campaign.advertising_channel_type, campaign.frequency_caps,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('VIDEO', 'DISPLAY', 'DEMAND_GEN', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- First-party and other audience lists: type, size, lookback
SELECT customer.descriptive_name,
  user_list.id, user_list.name, user_list.type,
  user_list.size_for_display, user_list.size_for_search,
  user_list.membership_status, user_list.membership_life_span
FROM user_list
WHERE user_list.membership_status = 'OPEN'
```

`user_list.type` is one of `REMARKETING`, `RULE_BASED` (website and app visitor rules, YouTube viewers), `CRM_BASED` (customer lists), `LOGICAL` (combinations), `EXTERNAL_REMARKETING`, `SIMILAR`. Lists imported from GA4 appear among these with a GA4-style name; use the name to tell them apart from pixel lists. `membership_life_span` is the lookback in days.

```sql
-- Audience segments attached at ad group level, with performance
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.criterion_id, ad_group_criterion.type,
  ad_group_criterion.display_name, ad_group_criterion.negative,
  ad_group_criterion.user_list.user_list,
  ad_group_criterion.user_interest.user_interest_category,
  metrics.cost_micros, metrics.impressions, metrics.conversions, metrics.conversions_value
FROM ad_group_audience_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Audience segments attached at campaign level, with performance
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  campaign_criterion.criterion_id, campaign_criterion.type,
  campaign_criterion.display_name, campaign_criterion.negative,
  campaign_criterion.user_list.user_list,
  metrics.cost_micros, metrics.impressions, metrics.conversions, metrics.conversions_value
FROM campaign_audience_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Interest taxonomy, to tell affinity from in-market segments
SELECT user_interest.user_interest_id, user_interest.name, user_interest.taxonomy_type
FROM user_interest
WHERE user_interest.taxonomy_type IN ('AFFINITY', 'IN_MARKET')
```

Join on the ID at the end of `ad_group_criterion.user_interest.user_interest_category`. Custom segments come back as `type = 'CUSTOM_AUDIENCE'`, combined segments as `COMBINED_AUDIENCE`.

```sql
-- PMax audience signals (count only; selecting the signal payload is rejected)
SELECT asset_group_signal.asset_group
FROM asset_group_signal
```

Count rows per asset group resource name; join to `asset_group.resource_name` from an `asset_group` query on enabled PMax campaigns. PMax doesn't report performance per audience, so step 4 doesn't apply to it.

**Frequency, where available.** Reach and frequency metrics (`metrics.unique_users`, `metrics.average_impression_frequency_per_user`) exist on the `campaign` resource for Display and Video in recent API versions, with restrictions on the segments they combine with. Check them with `get_resource_metadata` before relying on them; when they're unavailable, report frequency caps only.

Also read `wiki/company.md` for the vertical (it sets the lookback benchmark in step 5) and `ads/taxonomy.md` for campaign groups that mark prospecting and retargeting.

## Method

Use Python for every step. Map each audience criterion's `user_list` resource name to its `user_list.type` and size by the trailing ID, and each interest criterion to `AFFINITY` or `IN_MARKET`. Call a list **first-party (1P)** when its type is `REMARKETING`, `RULE_BASED`, `CRM_BASED`, `LOGICAL` or `EXTERNAL_REMARKETING`; `SIMILAR` lists are not 1P.

### 1. First-party data audit

Check for presence of first-party audience lists across the account:
- CRM lists (uploaded customer data)
- GA4 lists (traffic-based segments)
- Site remarketing lists (pixel-based website visitors)
- High-value segments: past purchasers, cart abandoners, high-LTV customers (find them by list name, for example "purchas", "buyer", "cart", "checkout", "customer", "ltv", "vip")

Use the larger of `size_for_display` and `size_for_search` as the list size.

| Finding | Priority |
|---------|----------|
| No 1P lists present anywhere | Critical |
| 1P lists present but < 1,000 members | Moderate — evaluate eligibility, expand data collection |
| 1P lists present, >= 1,000 members | Healthy — proceed to strategy audit |
| High-value segments (purchasers, cart abandoners) missing | Moderate — recommend adding segmented lists |

### 2. Prospecting vs retargeting structure

Classify each campaign from its positive (non-negative) audience criteria at both levels: **retargeting** when every positive audience is a 1P list, **prospecting** when none is, **mixed** when it targets both 1P lists and broad audiences (affinity, in-market, custom, similar) together. Campaigns with no audience criteria are prospecting. Where the classification and the campaign name or `ads/taxonomy.md` group disagree, say so. Audiences added in observation mode only adjust bids; note when a campaign's 1P lists are observation-only, since they don't make it a retargeting campaign.

Assess whether campaigns have a clear operational split:

| Finding | Priority |
|---------|----------|
| Dedicated prospecting + dedicated retargeting campaigns | Healthy |
| Same campaign mixes broad audiences with 1P/remarketing | Critical — split into separate campaigns |
| Retargeting audiences mixed into prospecting lineup | Critical — separate immediately |
| Prospecting present but no retargeting at all | Critical — create dedicated retargeting |

### 3. Channel-appropriate audience signals

Verify each channel uses appropriate audience types:

| Channel | Expected audience types |
|---------|----------------------|
| YouTube | Affinities, custom intent, custom segments |
| Display | In-market, 1P, custom segments, similar |
| Demand Gen | In-market, 1P, custom segments, similar |
| PMax | 1P lists + audience signals as optimisation hints |

In Python, list the audience types each campaign uses (and, for PMax, the signal count per asset group). Flag channels relying solely on broad audiences with no layered signals, and PMax asset groups with no signal.

### 4. Audience performance analysis

For each audience segment with sufficient data (apply the minimum-data rule in `references/priority-tiers.md`; below the event threshold, mark the result as directional):
- Compute CPA/ROAS from the summed segment rows and compare to the campaign average (campaign totals from the campaign query).
- Outperformance: segment CPA >= 20% lower than average (or ROAS >= 20% higher). Scaling opportunity.
- Underperformance: segment CPA >= 20% higher than average (or ROAS >= 20% lower). Candidate for pause or removal.

In Python: `cpa_variance = segment_cpa / campaign_cpa - 1` and `roas_variance = segment_roas / campaign_roas - 1`; outperforming when `cpa_variance <= -0.20` (or `roas_variance >= 0.20`), underperforming when `cpa_variance >= 0.20` (or `roas_variance <= -0.20`). Use ROAS when the campaign optimises for value, CPA otherwise. Sum the spend of underperforming segments as the waste estimate.

### 5. Retargeting deep-dive

If retargeting exists, assess:
- **Segmentation:** are cart viewers, product viewers, and all-site-visitors separated? (Moderate if lumped into one list.)
- **Lookback windows:** appropriate for the vertical (30-60d e-commerce, 90d SaaS, 180d high-consideration), read from `membership_life_span`.
- **Frequency caps:** applied to prevent over-exposure (Moderate if missing; `campaign.frequency_caps` empty).
- **Budget share:** retargeting spend as % of total, account level and per channel.
  - 40-50%: borderline imbalance — short-term returns but no new customer growth.
  - > 60%: Moderate priority — rebalance toward prospecting.

### 6. Overlap detection

Assess audience overlap across campaigns:
- Multiple audiences with > 70% user overlap + no frequency cap: Moderate. The Google Ads API doesn't return user overlap between audiences; when the user can't supply it from Google Ads' audience tools, say it wasn't measured and use the next rule as the proxy.
- Same 1P list in 2+ campaigns without audience sculpting: Moderate. In Python, count distinct campaigns per positive 1P list and check whether the other campaigns exclude it (a negative criterion on the same list).
- Prospecting + retargeting mixed in a single campaign: Critical (covered in step 2).

### 7. Holistic account view

Roll up in Python:
- % of campaigns using 1P data
- % with a clear prospecting/retargeting split
- Prospecting vs retargeting spend ratio (account level + per channel)
- % flagged Critical or Moderate

## Interpretation guide

- No 1P data is the single biggest audience gap. Without it, campaigns rely entirely on Google's audience signals, losing the account's proprietary conversion intelligence.
- Mixed prospecting/retargeting in one campaign prevents clean measurement and budget control. The algorithm optimises for the easiest conversions (retargeting) and starves prospecting.
- Retargeting > 50% of spend indicates the account is harvesting existing demand without generating new demand. Sustainable growth requires prospecting investment.
- Outperforming audiences (>= 20% better) are scaling opportunities — increase budget or test in adjacent channels.
- Underperforming audiences (>= 20% worse) should be paused or narrowed, not left running with hope.

## Output

One finding: `category: structure`, `kind: audit`. Fill the standard body with:

1. **Coverage snapshot:** % using 1P data | % with prospecting/retargeting split | % flagged Critical/Moderate | account 1P readiness.
2. **Channel table** (sorted by priority): account | campaign | type | spend % | prospecting vs retargeting | 1P lists used? | audience split quality | frequency cap | priority | recommendation.
3. **Audience performance table:** account | campaign | audience segment | spend | conversions | CPA/ROAS vs avg (% variance) | status (Outperforming / Avg / Underperforming) | recommendation.
4. **Holistic summary:** prospecting/retargeting spend split (account + per channel), 1P gaps, estimated waste on underperforming audiences, scaling opportunities.
5. **Wrap-up:** 3-5 sentences on foundation gaps (1P, structure), biggest waste, biggest scaling opportunity.
