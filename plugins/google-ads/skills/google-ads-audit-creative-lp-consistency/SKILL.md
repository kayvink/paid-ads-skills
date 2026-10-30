---
name: google-ads-audit-creative-lp-consistency
description: Audit whether the highest-spend Google Ads creatives on Display, YouTube (Video) and Demand Gen deliver on their promise at the landing page, checking offer, CTA and theme match and using high CTR with low conversion rate as the signal of a disconnect. Use when the user asks about message match, bait-and-switch risk, generic landing pages for specific creatives, or why Display or YouTube clicks don't convert. For Search keywords, RSA copy and Quality Score use google-ads-audit-ad-relevance.
---

# Audit creative-to-landing-page consistency

> Are ad creative messages and offers aligned with landing page content on Display, YouTube, and Demand Gen?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

For the highest-spend creatives on non-search channels, does the landing page deliver on the promise made in the ad — same offer, same CTA, same theme?

## Data required

Run for each account in scope; use a 30-day window ending yesterday. Conversions follow the primary conversion action rule in conventions section 3.

```sql
-- Creatives on Display, Video and Demand Gen with their text and final URL
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  ad_group.id, ad_group.name,
  ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.responsive_display_ad.headlines,
  ad_group_ad.ad.responsive_display_ad.long_headline,
  ad_group_ad.ad.responsive_display_ad.descriptions,
  ad_group_ad.ad.responsive_display_ad.call_to_action_text,
  ad_group_ad.ad.demand_gen_multi_asset_ad.headlines,
  ad_group_ad.ad.demand_gen_multi_asset_ad.descriptions,
  ad_group_ad.ad.demand_gen_multi_asset_ad.call_to_action_text,
  ad_group_ad.ad.video_responsive_ad.headlines,
  ad_group_ad.ad.video_responsive_ad.long_headlines,
  ad_group_ad.ad.video_responsive_ad.descriptions,
  ad_group_ad.ad.video_responsive_ad.call_to_actions,
  metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('DISPLAY', 'VIDEO', 'DEMAND_GEN')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Ad-format field names differ between API versions (for example older versions call Demand Gen ads `discovery_multi_asset_ad`). If a field is rejected, check it with `get_resource_metadata` on `ad_group_ad` and drop or rename it. Text fields come back as lists of text assets; take each item's `text`. Image-only and video-only creatives may carry no text: describe them from `ad_group_ad.ad.name` and mark the offer and CTA checks as "creative text not available".

For Video campaigns, add the view rate field your API version exposes (`metrics.video_trueview_view_rate` on recent versions, `metrics.video_view_rate` on older ones) to read VTR next to CTR.

Landing page content: for each distinct final URL in scope, fetch the page with your web fetch tool and extract the page title, H1, visible offer text (discounts, free trial, prices, deadlines) and the primary CTA (the main button or form above the fold). If a page can't be fetched, say so for that row and judge theme alignment from the URL path only.

## Method

Use Python for the selection and the engagement math; the message-match judgement is yours, recorded per creative.

### 1. Scope to high-spend creatives

Focus on creatives covering the top 80% of spend within Display, YouTube and Demand Gen campaigns. In Python, sum spend per `(customer_id, ad_group_ad.ad.id)` within each channel type, sort descending, and keep creatives until the cumulative share of that channel's spend reaches 80%. Compute each creative's CTR = clicks / impressions and CVR = conversions / clicks from the sums.

### 2. Check message match

For each creative-to-LP pair, evaluate three dimensions:

**Offer alignment:** If the ad mentions a specific offer ("50% off," "free trial," "limited time"), is that offer visible on the landing page? Missing = Critical mismatch.

**CTA alignment:** If the ad CTA is "Sign up free," does the LP feature a signup form above the fold? Mismatched CTA = Moderate mismatch.

**Theme alignment:** If the ad is about a specific product or topic, does the LP address that topic — or is it a generic homepage/category page? Generic LP for specific creative = Moderate mismatch. A final URL whose path is `/` or a top-level category is generic.

Record per creative: the hook/offer from the ad text, a one-line LP content summary, and a consistency rating: **Strong** (all three dimensions align), **Weak** (one or more Moderate mismatches), **None** (offer missing on the LP).

### 3. Cross-reference engagement

Creatives with strong CTR/VTR but weak conversion rate are the highest-priority mismatches. The ad is compelling enough to generate clicks, but the LP isn't delivering — the gap between click-through and conversion signals a disconnect.

In Python, compare each creative with the other in-scope creatives of the same channel type: flag "high CTR, low CVR" when its CTR (or VTR for Video) is above the channel median and its CVR is below the channel median. Print CTR and CVR next to the medians.

### 4. Identify structural opportunities

- Multiple high-spend creatives driving to the same generic LP: recommend dedicated LPs per creative theme/offer. In Python, group in-scope creatives by stripped final URL and list URLs that receive two or more creatives with different themes.
- LP matches but creative CTR is weak: recommend new creative variants that better reflect the LP's value proposition.
- LP inconsistent with multiple creative angles: recommend splitting campaigns by theme/LP.

### 5. Classify findings

- **Critical:** ad promise/offer not found on the LP (bait-and-switch effect). High user trust risk, wasted spend on clicks that can't convert.
- **Moderate:** LP thematically related but too generic (homepage, broad category page). Conversion rate suffers from friction between specific ad and broad page.
- **Low:** strong alignment, minor improvements possible.

## Interpretation guide

- Offer mismatches are the most damaging. A user who clicks "50% off running shoes" and lands on a page with no visible discount bounces immediately. This wastes the click cost and damages brand trust.
- Generic LPs (homepage, category) for specific creatives are the most common issue on Display and YouTube. The fix — dedicated LPs or at least deep-linked category pages — is high-effort but high-return.
- High CTR + low CVR is the diagnostic signal. When the ad works but the page doesn't convert, the disconnect is almost always creative-to-LP mismatch.
- Low-spend creatives with mismatches are low priority — fix high-spend first.

## Output

One finding: `category: creative`, `kind: audit`. Fill the standard body with:

1. **Coverage check:** % of high-spend creatives (and of their spend) with Strong alignment | % with mismatches.
2. **Consistency table** (sorted by spend desc): account | campaign | channel | creative hook/offer | spend % | LP content summary | consistency (Strong / Weak / None) | CTR vs CVR | priority | recommendation (New LP / Creative Variant / Restructure / No Action).
3. **Opportunity summary:** count and spend share of mismatched creatives, and an estimated conversion uplift from fixing the top mismatches. Compute it in Python as the extra conversions if each mismatched creative's clicks converted at the median CVR of the Strong-aligned creatives in the same channel, and state that assumption next to the number. Skip the estimate when a channel has no Strong-aligned creatives.
4. **Wrap-up:** worst mismatches, biggest LP gaps, quick wins.
