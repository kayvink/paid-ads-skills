---
name: google-ads-ad-disapprovals
description: Find disapproved and limited Google Ads ads and Performance Max assets in active campaigns, group them by policy reason, and recommend the fix for each. Use when the user asks about disapproved ads, policy violations, ads under review, limited approval, trademark restrictions, or why an ad or PMax asset isn't serving. When a whole campaign has stopped serving use google-ads-campaigns-not-spending instead.
---

# Ad Disapprovals

> Find ads with policy violations or disapprovals and surface them with explanations.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

List every active ad that Google is refusing to serve or serving on a reduced surface, and every disapproved or limited asset inside an active Performance Max asset group. For each, name the policy reason and the fix, and rank them so the user fixes the ones that cost delivery first.

A disapproved ad serves zero impressions: every click that would have gone through it is lost. A limited ad burns reach on a reduced surface (trademark, alcohol, financial restrictions). Performance Max has no ad-level disapproval, only per-asset, so a PMax problem is invisible to an ad-level check: PMax keeps serving on whatever assets are left, but each missing creative variant is one fewer thing the optimiser can test, and over time that caps how good performance can get.

## Scope

- **Ads** (`ad_group_ad`): ENABLED ads inside ENABLED campaigns. Disapprovals inside paused or removed campaigns aren't actionable and are left out.
- **PMax assets** (`asset_group_asset`): ENABLED asset links in ENABLED asset groups of ENABLED Performance Max campaigns.
- Healthy looks like: every active ad is `APPROVED` and serving at full reach, and no asset in any active PMax asset group is disapproved or limited. Healthy accounts keep both at zero.

This skill recommends only. The user edits the ads, requests review or files an appeal in Google Ads.

## Inputs you need

1. **Business context:** `wiki/company.md`. Regulated verticals (alcohol, gambling, financial services, healthcare, pharmacy) collect restricted approvals as a matter of course; that changes which `APPROVED_LIMITED` rows are worth acting on.
2. **Memory:** `ads/google/memory/MEMORY.md`. Look for acknowledged restrictions ("trademark-limited ads in the competitor campaign are accepted") and don't re-flag them.
3. **Recent findings:** `ads/google/findings/` from the last 14 days. If an open finding from this skill already lists the same ads, append an update rather than a new file.
4. **Live data:** the queries below, for each account in scope. The status queries take no date range (they read current state); the impact query uses the 30 days ending yesterday as an explicit `BETWEEN` range.

## Step 1: Ads that are disapproved, limited or area-of-interest only

**Query A: problem ads**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name, campaign.status,
  ad_group.id, ad_group.name,
  ad_group_ad.ad.id,
  ad_group_ad.ad.name,
  ad_group_ad.ad.type,
  ad_group_ad.status,
  ad_group_ad.policy_summary.approval_status,
  ad_group_ad.policy_summary.review_status,
  ad_group_ad.policy_summary.policy_topic_entries
FROM ad_group_ad
WHERE ad_group_ad.policy_summary.approval_status IN ('DISAPPROVED', 'APPROVED_LIMITED', 'AREA_OF_INTEREST_ONLY')
  AND ad_group_ad.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

**Query B: all active ads** (the denominator for the approved share)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.status,
  ad_group.id,
  ad_group_ad.ad.id
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

`policy_topic_entries` is a repeated field: each entry carries a `topic` (the policy name, for example "Trademarks in ad text" or "Destination not working") and a `type` (`PROHIBITED`, `LIMITED`, `AREA_OF_INTEREST_ONLY`, ...). If the MCP rejects the field or returns it flattened, check it with `get_resource_metadata` and fall back to reporting the approval status alone; say in the finding that the policy reason has to be read in the Google Ads UI.

Use Python to classify, keyed on `(customer_id, ad_group_ad.ad.id)`:

- Split query A by `approval_status` into three lists: `DISAPPROVED`, `APPROVED_LIMITED`, `AREA_OF_INTEREST_ONLY`.
- Per account: `total_ads = len(query B rows)`, `problem_ads = len(query A rows)`, `approved_share = (total_ads - problem_ads) / total_ads * 100` rounded to a whole percent (100% when `total_ads` is 0).
- Explode `policy_topic_entries` so each row is one (ad, topic, type); group by `(customer_id, topic)` and count distinct ads, sorted descending. This is the "common reasons" table: one landing-page or trademark issue usually explains dozens of disapprovals.
- Per ad group, using query B grouped by `(customer_id, ad_group.id)`: count enabled ads and how many of them are `DISAPPROVED`. An ad group where every enabled ad is disapproved serves nothing at all; list those ad groups separately in the general improvements, because the fix there is urgent rather than per-ad.
- Print at most 50 ads per status list, with the count of the rest.

## Step 2: Disapproved or limited assets in active PMax asset groups

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  asset_group.id, asset_group.name,
  asset.id, asset.name, asset.type,
  asset.policy_summary.review_status,
  asset.policy_summary.approval_status,
  asset.policy_summary.policy_topic_entries,
  asset_group_asset.field_type
FROM asset_group_asset
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND asset_group_asset.status = 'ENABLED'
```

Use Python to keep only offending rows: upper-case both status fields, then keep a row when `review_status == 'DISAPPROVED'` OR `approval_status in {'DISAPPROVED', 'AREA_OF_INTEREST_ONLY'}`. Note the asymmetry with step 1: for assets, `AREA_OF_INTEREST_ONLY` counts as an offending asset, not an informational one. Then:

- Count offending assets per `asset.type` (IMAGE, TEXT, VIDEO, ...), sorted descending, and print it as `IMAGE: 4, TEXT: 2` style.
- Group by `(customer_id, campaign.id, asset_group.id)` and count offending assets, so the user knows which asset groups to open.
- Explode `policy_topic_entries` as in step 1 for the reasons.
- Print at most 20 assets, with the count of the rest.

Many asset names are empty for text assets. Show `asset_group_asset.field_type` (HEADLINE, DESCRIPTION, LOGO, MARKETING_IMAGE, YOUTUBE_VIDEO, ...) so the user can find the asset.

## Step 3: Impact, for ranking

Disapproved ads have no recent metrics of their own, so rank by what the campaign stands to lose. Run this only for campaigns that appear in steps 1 or 2:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  metrics.cost_micros,
  metrics.impressions,
  metrics.conversions
FROM campaign
WHERE campaign.id IN (<affected_campaign_ids>)
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use Python to sum `cost` and `conversions` per `(customer_id, campaign.id)` over the window, join onto the problem lists on the same key, and use campaign spend as the tiebreaker after severity.

## Step 4: Fix guidance per status

| Status | What it means | Fix |
|---|---|---|
| Ad `DISAPPROVED` | Serving zero impressions | Open the ad in Google Ads, read the policy reason, fix the underlying issue (landing page, copy, trademark), and request review. |
| Ad `APPROVED_LIMITED` | Serving, but on a reduced surface (trademark, alcohol or financial restrictions) | Review the policy reason. Either adjust the creative to lift the restriction, or accept the reduced delivery footprint. |
| Ad `AREA_OF_INTEREST_ONLY` | Serves only to users interested in the targeted region, not users physically there | Usually fine, but worth knowing. Flag only if the business serves people on location (local services, physical stores). |
| PMax asset disapproved or limited | That creative variant won't serve | In Google Ads: Campaigns, the affected PMax campaign, Asset groups, open each listed asset group and look for the red status icon on individual assets. Replace or fix them. Common causes: image with a text overlay, headline with disallowed punctuation, video with a policy issue, logo too small. |

Map the policy topic to the concrete fix where the topic makes it obvious: "Destination not working" or "Destination mismatch" is a landing page problem (one fix clears every ad pointing at that URL), trademark topics need a trademark authorisation or copy change, "Editorial" and "Punctuation" topics need a copy edit.

## Interpretation rules

- **Severity:**
  - `high`: an ad `DISAPPROVED`, or an asset disapproved or limited in an active PMax asset group.
  - `medium`: an ad `APPROVED_LIMITED`.
  - `low`: an ad `AREA_OF_INTEREST_ONLY`.
- Sort by severity, then by campaign spend.
- An ad group with every enabled ad disapproved is dark. Call it out first, whatever its spend.
- Respect memory: acknowledged restrictions are listed in the per-account summary as "accepted" and kept out of the recommendations.
- `review_status = REVIEW_IN_PROGRESS` or `UNDER_APPEAL` on a disapproved ad means the user may already be acting; say so in the row instead of recommending another review request.
- If query A or B fails for some accounts, name them; never report "no disapprovals" for a subset.

## Output

One finding: `category: creative`, `kind: audit`.

**Wrap-up example:** *"14 of 212 active ads are disapproved (93% approved), 11 of them for one landing page that returns an error; 3 PMax images are disapproved in 2 asset groups."*

**General improvements**, for example:
- "Ad group 'Spring sale' in Non-Brand Generic FR has all 3 enabled ads disapproved and serves nothing."
- "11 of 14 disapprovals share the topic 'Destination not working' on the same final URL: fixing the page and requesting one review clears them all."

**Recommendations:**

| account | campaign | ad_group_or_asset_group | ad_or_asset | status | policy_topic | fix |
|---|---|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | Spring sale | RSA 4821 | DISAPPROVED | Destination not working | Fix the landing page, then request review |

**Details:**

*Common reasons*

| account | policy_topic | type | ads_or_assets_affected | campaigns_affected |
|---|---|---|---|---|

*Ads*

| account | campaign | ad_group | ad_id | ad_type | approval_status | review_status | policy_topics | campaign_spend_30d | severity |
|---|---|---|---|---|---|---|---|---|---|

*PMax assets*

| account | campaign | asset_group | field_type | asset_type | asset_name_or_id | review_status | approval_status | policy_topics | severity |
|---|---|---|---|---|---|---|---|---|---|

**Pending example**
- title: *14 disapproved ads and 3 disapproved PMax images across 2 accounts*
- summary: *93% of 212 active ads approved. 11 disapprovals share one broken landing page; one ad group in Non-Brand Generic FR serves nothing. 3 PMax images fail on text overlay.*

**OK example**
- title: *All active ads and PMax assets approved*
- summary: *Checked 212 enabled ads in enabled campaigns and 146 assets in 9 active PMax asset groups across 2 accounts: none disapproved, limited or area-of-interest only.*
- The body states what was checked (ad and asset counts per account, the statuses tested) and that both lists came back empty.

## Workspace writes (when the user confirms)

- The user accepts a restriction ("the trademark limit on competitor ads is fine") → write a memory file under `ads/google/memory/` naming the campaign, the policy topic and the reason, and add a line to `MEMORY.md`.

## Evidence rule

Every flagged ad or asset names the account, campaign, ad group or asset group, the ad ID or asset, the status, the policy topic, and the rule it matched:

> *"Acme FR, Non-Brand Generic FR, ad group Spring sale: RSA 4821 is DISAPPROVED (topic 'Destination not working'). It is one of 3 enabled ads in the ad group, all disapproved, so the ad group serves nothing. Campaign spend €1,840 in the last 30 days. Severity high."*
