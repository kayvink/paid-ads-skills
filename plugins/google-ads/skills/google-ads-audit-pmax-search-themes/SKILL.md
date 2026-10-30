---
name: google-ads-audit-pmax-search-themes
description: Audit Google Ads Performance Max search themes per asset group, checking whether themes are present, whether they are too broad or too narrow, whether they match the asset group's headlines, descriptions and landing page, whether brand and non-brand themes are mixed, and whether the search term insights PMax actually matched reflect them. Use when the user asks about PMax search themes, PMax keyword guidance, or PMax drifting into irrelevant queries. For PMax search term waste and negatives use google-ads-check-search-terms.
---

# Audit PMax search themes

> Are PMax search themes present, aligned with assets, and consistent with landing pages?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

Do PMax campaigns have search themes configured, and are those themes aligned with the asset group's headlines, descriptions, and landing page content?

## Data required

Run for each account in scope; use a 30-day window ending yesterday.

```sql
-- PMax asset groups with spend and final URLs
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name,
  asset_group.id, asset_group.resource_name, asset_group.name, asset_group.final_urls,
  metrics.cost_micros, metrics.conversions
FROM asset_group
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Search themes per asset group
SELECT asset_group_signal.asset_group, asset_group_signal.search_theme.text
FROM asset_group_signal
```

Rows without a search theme are audience signals; drop them in Python (empty `search_theme.text`). If the field is rejected on your API version, check `asset_group_signal` with `get_resource_metadata`.

```sql
-- Asset group text assets
SELECT campaign.id, asset_group.id, asset_group_asset.field_type, asset.text_asset.text
FROM asset_group_asset
WHERE asset_group_asset.field_type IN ('HEADLINE', 'LONG_HEADLINE', 'DESCRIPTION')
  AND asset_group_asset.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
```

**Search term insights.** Pull category-level insights from `campaign_search_term_insight`, one query per PMax campaign, exactly as step 3b of `google-ads-check-search-terms` describes (a single-campaign filter is required, cost isn't available, and `id = "0"` is the uncategorised residual bucket):

```sql
SELECT campaign_search_term_insight.campaign_id,
  campaign_search_term_insight.id,
  campaign_search_term_insight.category_label,
  metrics.clicks, metrics.impressions, metrics.conversions
FROM campaign_search_term_insight
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign_search_term_insight.campaign_id = <campaign_id>
```

Landing page content: for each asset group's first final URL, fetch the page with your web fetch tool and extract the page title, H1 and the main body keywords. Also read `brand_terms` from `ads/google/index.md` and `wiki/company.md` for the product and service range.

## Method

Use Python to join themes and assets to asset groups on the asset group ID (the trailing part of `asset_group_signal.asset_group` and of `asset_group.resource_name`), and compute each asset group's share of PMax spend.

### 1. Presence check

For each PMax campaign, count asset groups with at least one search theme:

| Finding | Priority |
|---------|----------|
| No search themes on any asset group | Critical — PMax has no keyword guidance |
| Some asset groups with themes, some without | Moderate — inconsistent |
| All asset groups have themes | Healthy — proceed to alignment check |

### 2. Relevance check: themes to assets

For each asset group, compare search themes against headlines and descriptions:
- Are key theme terms reflected in at least one headline and one description? In Python, lowercase and stem each theme's tokens (drop stop words) and the asset text the same way; a theme is reflected in a text when all its token stems appear. Rate the asset group **Strong** when most themes are reflected in both a headline and a description, **Weak** when themes appear in only one of the two or only some themes appear, **None** when no theme appears.
- Are themes too broad (e.g., "shoes" for a running shoe brand)? One-word generic themes, or themes that name the whole category rather than what the business sells, read against `wiki/company.md`.
- Are themes too narrow (generating minimal impressions)? Search themes don't report their own impressions, so use the search term insights as the proxy: a theme no insight category shares a stem with, in a campaign with plenty of categorised traffic, is likely too narrow. Say this is a proxy.

### 3. Relevance check: themes to landing page

Compare search themes against LP content:
- Does the LP title, H1, or body prominently feature the theme terms? Rate Strong (in title or H1), Weak (body only), None (absent), with the same stemming.
- Are themes pointing to a generic homepage instead of a relevant product/category page? A final URL whose path is `/` is a homepage.

### 4. Query alignment check

Using the search term insights, assess whether actual search queries triggered by PMax match the declared themes. In Python, for each campaign, take the non-residual categories (`id != "0"`), mark a category aligned when its label shares a token stem with any theme of the campaign's asset groups, and compute the share of categorised clicks that are aligned. Also print the residual bucket's share of clicks. If irrelevant queries dominate (most categorised clicks unaligned), the themes aren't providing effective guidance. Insights are reported per campaign, not per asset group, so this check is at campaign level.

### 5. Theme quality assessment

| Issue | Recommendation |
|-------|---------------|
| Themes too broad | Tighten with mid/long-tail relevant phrases (e.g., "red trail running shoes" not "shoes") |
| Themes too narrow | Expand with higher-volume variants |
| Brand/non-brand mixing | Separate brand themes into brand asset groups |
| No themes at all | Add core non-brand intent terms covering the product/service range |

Brand / non-brand mixing, in Python: an asset group mixes when some of its themes contain a brand term and some don't.

### 6. Classify findings

- **Critical:** no search themes, or themes completely misaligned with assets and LPs.
- **Moderate:** themes present but overly broad/narrow, or partially aligned.
- **Low:** themes well-matched, minor optimisation opportunities.

## Interpretation guide

- Search themes are PMax's keyword equivalent — without them, PMax relies entirely on Google's automated signal interpretation, which can drift into irrelevant query territory.
- Broad themes waste the signal. "Shoes" matches thousands of irrelevant queries; "red trail running shoes women's" constrains PMax to high-intent traffic.
- Theme-to-LP alignment drives Quality Score signals within PMax. Misaligned themes raise CPC and lower conversion rates just like misaligned keywords in Search.
- Search term insights are PMax's limited transparency window. Use them to validate whether themes are doing their job.

## Output

One finding: `category: keywords`, `kind: audit`. Fill the standard body with:

1. **Coverage check:** % of PMax campaigns with search themes present | % of asset groups with themes.
2. **Theme table** (sorted by spend desc): account | campaign | asset group | spend % | themes present? | theme count | asset alignment (Strong / Weak / None) | LP alignment (Strong / Weak / None) | query alignment (if data available) | priority | recommendation.
3. **Recommendations:** themes to add, tighten, expand or move, per asset group, as a table the user can apply.
4. **Wrap-up:** campaigns missing themes, biggest alignment gaps, top theme additions.
