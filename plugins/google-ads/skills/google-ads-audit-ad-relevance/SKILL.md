---
name: google-ads-audit-ad-relevance
description: Audit whether Google Ads keywords, responsive search ad copy and landing pages are aligned for the highest-spend non-brand Search ad groups, scoring copy and destination relevance per keyword and reading Quality Score components (ad relevance, landing page experience, expected CTR) and mobile landing page speed. Use when the user asks about low Quality Scores, ad relevance, message match on Search, or whether ads and landing pages fit the keywords. For Display, YouTube and Demand Gen creatives use google-ads-audit-creative-lp-consistency.
---

# Audit ad relevance

> Are keywords, RSA ad copy, and landing pages aligned to drive relevance and conversions?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

For the highest-spend non-brand ad groups, do the keywords match the RSA headlines/descriptions, and do the landing pages reflect the keyword intent?

## Data required

Run for each account in scope; use a 30-day window ending yesterday. Conversions follow the primary conversion action rule in conventions section 3.

```sql
-- Keywords with spend, conversions and Quality Score components
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  ad_group_criterion.quality_info.quality_score,
  ad_group_criterion.quality_info.creative_quality_score,
  ad_group_criterion.quality_info.post_click_quality_score,
  ad_group_criterion.quality_info.search_predicted_ctr,
  metrics.impressions, metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM keyword_view
WHERE ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`creative_quality_score` is Ad Relevance, `post_click_quality_score` is Landing Page Experience and `search_predicted_ctr` is Expected CTR; each is `BELOW_AVERAGE`, `AVERAGE` or `ABOVE_AVERAGE`. Quality Score is null for keywords without enough impressions.

```sql
-- Responsive search ads with their copy and final URL
SELECT customer.descriptive_name,
  campaign.id, ad_group.id, ad_group_ad.ad.id,
  ad_group_ad.ad.responsive_search_ad.headlines,
  ad_group_ad.ad.responsive_search_ad.descriptions,
  ad_group_ad.ad.final_urls,
  metrics.clicks, metrics.impressions
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Headlines and descriptions come back as lists of text assets; take each item's `text`.

```sql
-- Landing page speed and mobile friendliness
SELECT customer.descriptive_name,
  landing_page_view.unexpanded_final_url,
  metrics.speed_score, metrics.mobile_friendly_clicks_percentage,
  metrics.clicks
FROM landing_page_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
```

Also read:
- `brand_terms` from `ads/google/index.md` (a keyword is brand when it contains any brand term, case-insensitive);
- target ROAS or CPA per campaign group from `ads/google/rules/*.md`, falling back to the campaign's own bidding target (`campaign.target_roas.target_roas`, `campaign.maximize_conversion_value.target_roas`) when the rules don't set one;
- landing page content for the final URLs in scope: fetch each page with your web fetch tool and extract the page title, meta title, H1, H2s and body text. If a page can't be fetched, fall back to the URL-path heuristic in step 4.

## Method

Use Python for every step. Join keywords to ads on `(customer_id, campaign.id, ad_group.id)`.

### 1. Scope to non-brand, high-spend ad groups

- Drop brand keywords and ad groups (keywords matching `brand_terms`; an ad group is brand when most of its spend is on brand keywords).
- Select ad groups covering the top 80% of non-brand spend: sum spend per `(customer_id, ad_group.id)`, sort descending, and keep ad groups until the cumulative share reaches 80%.
- Unit of analysis = ad group.

### 2. Select the active RSA per ad group

Pick the RSA with the most clicks (fallback: impressions). Extract all headlines and descriptions. Record the final URL, stripped of query parameters to get scheme, host and path only (`urllib.parse.urlsplit`).

### 3. Score ad copy relevance (keyword to RSA)

For each keyword in the ad group, check whether its stem appears in:
- At least 1 headline AND at least 1 description = **Strong**
- Headline OR description but not both = **Moderate**
- Neither = **Poor**

In Python: lowercase the keyword, strip match-type symbols (`+`, `"`, `[`, `]`), drop stop words and brand terms, and stem each remaining token (a Snowball stemmer if `nltk` is available, otherwise strip common suffixes such as `-ing`, `-es`, `-s`). Stem the headline and description text the same way. A keyword "appears" in a text when every one of its remaining token stems is present in that text. Score the ad group as the spend-weighted mix of its keyword scores and keep the per-keyword list for the diagnosis.

### 4. Score destination relevance (keyword to landing page)

If LP content is available, check whether the keyword stem appears in:
- Page title, H1, or body prominently = **Strong**
- Present but not prominent = **Moderate**
- Absent = **Poor**

Treat "prominent" as present in the title, meta title, H1 or an H2, and "present" as only in the body text. Use the same stemming as step 3.

If LP content is not accessible, use the URL-path heuristic (does the path contain keyword-related terms: split the path on `/`, `-` and `_` and stem the tokens) and mark the result as "heuristic."

### 5. Check Quality Score signals

Compute each ad group's Quality Score as the impression-weighted mean of its keywords' Quality Scores (keywords with a null score excluded), and its Ad Relevance and LP Experience as the component rating on the most impressions.

For ad groups with QS <= 4, or Ad Relevance / LP Experience = "Below Average":
- If Ad Relevance is below average: the ad copy doesn't match keyword intent.
- If LP Experience is below average: the landing page doesn't satisfy the query.
- If both are below: the ad group has a fundamental alignment problem.
- If both are average/above but performance is still poor: likely a page UX or offer issue, not a relevance issue.

### 6. Assign action gates

Only recommend action if any of:
- QS <= 4 or Ad Relevance / LP Experience = "Below Average"
- Ad Copy relevance = Poor or Destination relevance = Poor
- ROAS below target (if targets are available): ad group ROAS = conversion value / spend
- Mobile speed score <= 5/10 or mobile-friendly click rate < 70% (`metrics.speed_score` and `metrics.mobile_friendly_clicks_percentage` from the landing page view, joined on the stripped final URL)

If none is triggered: "No Action (performing)" — relevance is adequate.

### 7. Classify findings

- **Critical:** QS <= 4 on a high-spend ad group, or ad copy + destination both Poor.
- **Moderate:** one dimension Poor, or QS 5-6 with a Below Average component.
- **Low:** minor alignment gaps on lower-spend ad groups, or borderline quality scores.

Apply the minimum-data rule in `references/priority-tiers.md`: below the event threshold, mark the finding as directional.

## Interpretation guide

- Ad copy relevance is the fastest fix — adding keyword stems to RSA headlines often lifts Ad Relevance within days.
- LP relevance takes longer to fix (requires page changes) but has higher impact on conversion rate.
- QS <= 4 means Google is actively penalising the ad group's auction position. Every impression costs more than it should.
- When QS components are Average/Above but performance is poor, the issue is likely on-page (UX, load speed, offer clarity), not relevance. Don't chase relevance fixes when relevance is already adequate.

## Output

One finding: `category: creative`, `kind: audit`. Fill the standard body with:

1. **Issue map** (top 25 by priority, sorted by priority tier then spend share): account | campaign | ad group | spend % | conversions | QS / AdRel / LPExp | ad copy relevance | destination relevance | category (Ad Copy issue / Destination issue / Both / Aligned) | priority.
2. **Ad copy diagnosis** (for Poor / Both categories): ad group header with spend and QS | current RSA headlines and descriptions | keywords with missing stems (top 10 by spend) | decision (Rewrite / Split ad group / No Action).
3. **Destination diagnosis** (for Poor / Both categories): ad group header | final URL | LP title/H1 or URL-path tokens (say which) | keywords with destination gaps | decision (New LP / Adjust LP / No Action).
4. **Actions table:** account | campaign | ad group | final URL | QS / AdRel / LPExp | category | priority | decision | reason.
5. **Wrap-up:** count of ad groups with relevance issues, % of spend affected, top fixes.
