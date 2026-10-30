---
name: google-ads-check-utm-tagging
description: Audit Google Ads UTM tagging for attribution fitness by resolving the effective UTMs each ad, asset group and sitelink sends on click (final URL, tracking template, final URL suffix and custom parameters across account, campaign, ad group and ad levels) and checking them against a declared UTM schema or best-practice defaults. Use when the user asks whether UTMs are set up correctly, why GA4 or a CRM shows untagged or fragmented Google traffic, whether auto-tagging is enough, or to define a UTM schema in `ads/taxonomy.md`.
---

# Check UTM tagging

> Audit UTM tagging for attribution fitness — coverage, consistency with the declared schema, and effective tags per ad (resolved through the precedence chain).

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

For each live entity, determine the **effective UTMs** that fire on click (after walking the precedence chain), then check against the declared UTM schema or best-practice defaults. Flag missing, mismatched, fragmented, or legacy tagging.

Settings and taxonomy are the target to verify, not proof that tracking works. Always inspect live URL settings and compute the effective UTMs before making a claim.

## Scope

Google Ads (platform side). Meta, LinkedIn, TikTok and DSPs are documented below so the same schema can be applied when those channels are audited. Clickstream-side verification (what GA4 or a CDP actually received) is a separate exercise that needs access to those tools.

## How UTM resolution works (Google Ads)

UTMs on a click are assembled from **four sources**, layered with precedence:

1. **Final URL** (`ad.final_urls`, `asset_group.final_urls`, `asset.final_urls` for sitelinks): may have UTMs baked in.
2. **Tracking URL template** (`customer` → `campaign` → `ad_group` → `ad`): legacy pattern `{lpurl}?utm_source=...`. More specific level overrides less specific.
3. **Final URL Suffix** (`customer` → `campaign` → `ad_group` → `ad`): modern preferred, a parameter string Google appends to the final URL. More specific overrides less specific.
4. **URL custom parameters** (`{_foo}` placeholders resolved by `url_custom_parameters`): substitution inside templates/suffixes.

**Effective UTMs per entity = walk account → campaign → ad group → ad and take the most specific `final_url_suffix` + any UTMs in the final URL itself.** Don't flag an ad as "missing UTMs" when the account-level suffix is covering it.

Rule of thumb for output: `final_url_suffix` is the modern mechanism. `tracking_url_template` with `{lpurl}?utm_...` works but is legacy — flag as "migrate to suffix."

## Where UTMs live per channel

| Channel | Field(s) to check | Notes |
|---|---|---|
| **Google Ads** (Search / Display / Video / Demand Gen) | `ad_group_ad.ad.final_urls`, `.final_url_suffix`, `.tracking_url_template`, + campaign and account levels | Precedence chain resolves effective value |
| **Google Ads Performance Max** | `asset_group.final_urls`, `.final_url_suffix`, `.tracking_url_template` | Asset group is the PMax creative container |
| **Google Ads Shopping** | Campaign-level `final_url_suffix` / `tracking_url_template` only | Product URLs come from the Merchant Center feed, not inspectable via the Google Ads API |
| **Google Ads Sitelinks** | `asset.final_urls`, `.final_url_suffix`, `.tracking_url_template` (where `asset.type = 'SITELINK'`) | Own URLs per sitelink, easy to miss |
| Meta (FB/IG) | Ad-level "URL Parameters" field | Outside this skill |
| LinkedIn | Ad-level destination URL | Outside this skill |
| TikTok | Tracking template or destination URL | Outside this skill |
| DSP (DV360, TTD) | Tracking template or click URL | Outside this skill |

## Inputs you need

1. **Schema declaration:** read `ads/taxonomy.md`. If a UTM schema section exists, use it as the target. If the file is missing, empty or a placeholder, use the best-practice defaults.
2. **Account memory:** read `ads/google/memory/MEMORY.md`. Scan for relevant prior acknowledgments (e.g. "auto-tagging is sufficient") and read the individual files for full context.
3. **Business context:** read `wiki/company.md`, specifically: does the business have non-Google data destinations (CDP, CRM, BI tool) that need UTMs as primary attribution? If yes, auto-tagging alone is insufficient. If the file doesn't say, ask when the user is present; otherwise state the assumption.
4. **Live entities, loaded lazily by channel type.** Run each query for every account in scope; metric queries use the last 30 days ending yesterday, written as an explicit `BETWEEN` range.

### Step 4a: Account-level URL settings

```sql
SELECT
  customer.id,
  customer.descriptive_name,
  customer.currency_code,
  customer.auto_tagging_enabled,
  customer.final_url_suffix,
  customer.tracking_url_template
FROM customer
```

### Step 4b: Campaign-level overrides + channel inventory

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type,
  campaign.status,
  campaign.final_url_suffix,
  campaign.tracking_url_template,
  campaign.url_custom_parameters,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use Python to list the distinct `advertising_channel_type` values per account and decide which of 4c/4d/4e/4f to run.

### Step 4c: Traditional ads (only if Search / Display / Video / Demand Gen present)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  ad_group.id, ad_group.name,
  ad_group.final_url_suffix, ad_group.tracking_url_template,
  ad_group.url_custom_parameters,
  ad_group_ad.ad.id,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.final_url_suffix,
  ad_group_ad.ad.tracking_url_template,
  ad_group_ad.ad.url_custom_parameters,
  metrics.cost_micros
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'DISPLAY', 'VIDEO', 'DEMAND_GEN')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

### Step 4d: Performance Max asset groups (only if PMax present)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  asset_group.id, asset_group.name,
  asset_group.final_urls,
  asset_group.final_url_suffix,
  asset_group.tracking_url_template,
  metrics.cost_micros
FROM asset_group
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

### Step 4e: Sitelinks (only if any sitelinks exist in the account)

```sql
SELECT
  customer.descriptive_name,
  asset.id,
  asset.name,
  asset.sitelink_asset.link_text,
  asset.final_urls,
  asset.final_url_suffix,
  asset.tracking_url_template
FROM asset
WHERE asset.type = 'SITELINK'
```

To place each sitelink in a campaign (its inherited campaign settings and its spend), also pull the campaign links:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign_asset.asset,
  metrics.cost_micros
FROM campaign_asset
WHERE campaign_asset.field_type = 'SITELINK'
  AND campaign_asset.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`campaign_asset.asset` is a resource name ending in `/assets/<asset.id>`; join on that ID. Sitelinks linked at account or ad group level have no row here: resolve them against the account (or ad group) settings and leave spend blank.

### Step 4f: Shopping (only if Shopping present)

Shopping campaigns: check `campaign.final_url_suffix` / `campaign.tracking_url_template` from step 4b and explicitly note that **product feed URLs (from Merchant Center) are not verifiable via the Google Ads API**. Flag that as a known blind spot in the output.

## Computing the effective UTMs

Use Python to resolve every entity's effective UTMs:

1. **Index the levels.** Build lookups keyed by `customer_id` (step 4a), `(customer_id, campaign.id)` (4b), `(customer_id, ad_group.id)` (4c) for `final_url_suffix`, `tracking_url_template` and `url_custom_parameters`. Treat an empty string as "not set".
2. **Pick the most specific value.** Suffix = first non-empty of ad → ad group → campaign → customer (for PMax: asset group → campaign → customer; for sitelinks: asset → campaign → customer; for Shopping: campaign → customer). Same walk, separately, for the tracking template. Record which level supplied each, for the `issue_type` and the fix.
3. **Resolve custom parameters.** Custom parameters are a list of `{key, value}`; the most specific level that defines a key wins. Replace each `{_key}` in the chosen suffix and template with its value. Leave unresolved `{_key}` placeholders in place and flag them as `invalid_value`. Leave ValueTrack macros such as `{campaignid}` or `{keyword}` as literal strings.
4. **Parse the parameters.** Use `urllib.parse.urlsplit` and `parse_qsl(keep_blank_values=True)` on the first final URL (its query string), on the suffix (parse it as a query string), and on the part of the template after `{lpurl}?`. Keep only keys starting with `utm_`.
5. **Merge.** Effective UTMs = final-URL UTMs, overridden by suffix UTMs, overridden by template UTMs. When the same `utm_` key is set in more than one source with different values, record `double_encoding`.
6. **Print a coverage table** per account: entity count, entities with all of `utm_source`, `utm_medium`, `utm_campaign` present, and the same as a share of 30-day spend.

## Standard UTM taxonomy (best-practice defaults)

| Channel / Tactic | utm_source (standard) | Acceptable variations | utm_medium (standard) | Acceptable variations | utm_campaign | utm_content / utm_term |
|---|---|---|---|---|---|---|
| Google Search | `google` | `g` | `paid_search` | `cpc`, `ppc` | Campaign name | Keyword / creative ID |
| Google Display | `google` | `g` | `display` | `gdn`, `banner` | Campaign name | Placement / creative |
| Google Performance Max | `google` | `g` | `performance_max` | `pmax`, `p-max` | Campaign name | Asset group / creative |
| Meta (FB/IG) | `facebook` | `fb`, `instagram` | `paid_social` | `social`, `cpc` | Campaign name | Ad set / creative ID |
| LinkedIn | `linkedin` | `li` | `paid_social` | `social`, `cpc` | Campaign name | Ad set / creative ID |
| TikTok | `tiktok` | `tt` | `paid_social` | `social`, `cpc` | Campaign name | Ad set / creative ID |
| DSP (DV360, TTD) | `dv360` / vendor name | `displayvideo360`, DSP alias | `display` | `banner`, `programmatic` | Campaign name | Line item / creative |

## Structural rules

- **All UTM values lowercase.** `Paid_Social` and `paid_social` fragment in reporting.
- `utm_source` = platform/vendor.
- `utm_medium` = channel type (paid_search / paid_social / display / performance_max).
- `utm_campaign` = campaign name (or close variant). **Never** the raw `{campaignid}` macro: that's a numeric ID, useless in reports.
- `utm_content` / `utm_term` = lowest-level differentiator (ad, keyword, creative, placement).
- No spaces in values (use `_`).
- No special characters that need URL-encoding.

## Validation cascade

Apply in order, in Python, to each entity's effective UTMs:

1. **Compute effective UTMs per entity** by walking the precedence chain (above). This is the value the actual click will send.
2. **Check presence.** Does the effective URL carry `utm_source`, `utm_medium`, `utm_campaign` at minimum? Missing any = critical.
3. **If a UTM schema is declared in `ads/taxonomy.md`**, validate against it (source/medium values, campaign matching rule, content/term expectations).
4. **If no schema is declared**, validate against the best-practice defaults above. Map the campaign's `advertising_channel_type` to the table row (`SEARCH` → Google Search, `DISPLAY` → Google Display, `PERFORMANCE_MAX` → Google Performance Max). A value equal to the standard passes; one in "acceptable variations" is `acceptable_variation`; anything else is `invalid_value`. Flag the absence of a declared schema itself as an improvement.
5. **Cross-reference `ads/google/memory/MEMORY.md`.** If the user has explicitly acknowledged an exception ("auto-tagging only is fine — we only use GA4"), do NOT re-flag it.

The per-value checks, in Python:
- `casing_fragmentation`: `value != value.lower()`, or the same lowercase value appears with different casings across entities in the account.
- `macro_campaign_id`: `utm_campaign` contains `{campaignid}`.
- `campaign_name_mismatch`: normalise both `utm_campaign` and `campaign.name` (lowercase, spaces to `_`) and flag when they differ and the declared schema doesn't define another rule.
- `legacy_template`: the effective tracking template starts with `{lpurl}` and carries `utm_` parameters.
- `gclid_only`: `customer.auto_tagging_enabled` is true, the effective URL has no `utm_` parameters, and `wiki/company.md` names a non-Google data destination.
- `sitelink_bypass`: a sitelink whose effective UTMs are missing or differ from the main ads of the campaign it is linked to.

Do not mark this clean because an account-level suffix exists. The suffix must resolve correctly on live campaigns, ads, asset groups, and sitelinks. If an entity with spend overrides or bypasses the account default, list that entity in the finding.

## Interpretation rules

| Finding | Severity |
|---|---|
| Missing UTMs (no source/medium/campaign in effective URL) | **Critical**: attribution gap |
| Auto-tagging (GCLID) as sole attribution, AND the business has a non-Google data destination | **Critical**: non-Google tools can't read GCLID |
| `utm_campaign={campaignid}` macro | **Critical**: numeric ID unusable in reports |
| Inconsistent casing across ads (`Paid_Social` vs `paid_social`) | **Fragmentation**: medium severity |
| Campaign name ≠ `utm_campaign` value | **Reconciliation**: medium |
| UTMs both in tracking template AND final URL suffix (conflict) | **Medium**: unpredictable behaviour |
| Legacy `{lpurl}?utm_...` tracking template pattern | **Low**: works, flag for migration to `final_url_suffix` |
| Acceptable variation (from taxonomy table) | **Soft flag**: "acceptable, recommend standardising" |
| Invalid / non-recognised value | **Correction required** |
| Sitelink URLs missing UTMs while main ad is tagged | **Medium**: often missed |

## Modes

### No UTM schema declared (bootstrap)

1. Observe current tagging state + auto-tagging configuration.
2. Draft a proposed UTM schema from what you see + best-practice defaults (the taxonomy table above).
3. Write the proposal as the finding body: observations, proposed schema (per channel), clarifying questions ("Do non-Google tools consume UTMs? What should utm_content carry — keyword / ad set / creative ID?"), suggested next steps.

Do NOT emit per-entity compliance verdicts in bootstrap mode — there's no target yet. Output is observations + proposal + questions.

### UTM schema declared (verify)

Run both output layers in one pass:
- **Schema level**: gaps in the declared schema itself vs best practice (e.g. "no utm_content rule declared").
- **Compliance level**: per-entity deviations from the declared schema.

Do NOT re-flag items previously acknowledged in `ads/google/memory/`.

## Output content

One finding: `category: tracking`, `kind: audit`, covering all accounts in scope. The standard body sections carry:

**Wrap-up:** UTM coverage % + biggest attribution risk + spend impact.
Example: *"92% UTM coverage; auto-tagging-only on 22 ads worth €2.1k/mo of traffic your CRM can't attribute; 14 ads use `utm_campaign={campaignid}`."*

**Per-account summary** when more than one account is in scope: coverage % and top issue per account.

**General improvements:** schema-level findings. Examples:
- "Declare a utm_content rule — currently undeclared; 40% of ads set it ad hoc, causing fragmentation."
- "Migrate from `{lpurl}?utm_...` tracking templates to `final_url_suffix` — modern and precedence-aware."
- "Standardise utm_source to `google` — currently mixed `google` and `g`."

**Recommendations:** specific schema rules to add or adjust, plus a table of URL changes the user can apply (account, level, entity, field, current value, proposed value, reason). Prefer one fix at the highest level that covers the most entities (an account-level suffix) over many ad-level edits.

**Details tables**, split by entity shape (render only sections with issues; account name first, sorted by severity then spend, about 20 rows each with the rest summarised):

#### Traditional ads — Search / Display / Video / Demand Gen
| account | campaign_name | campaign_id | ad_group_name | ad_id | spend | severity | effective_utm_source | effective_utm_medium | effective_utm_campaign | issue_type | suggested_correction |
|---|---|---|---|---|---|---|---|---|---|---|---|

#### Performance Max — asset groups
| account | campaign_name | campaign_id | asset_group_name | asset_group_id | spend | severity | effective_utm_source | effective_utm_medium | effective_utm_campaign | issue_type | suggested_correction |
|---|---|---|---|---|---|---|---|---|---|---|---|

#### Sitelinks
| account | campaign_name | sitelink_text | asset_id | spend | severity | effective_utm_source | effective_utm_medium | effective_utm_campaign | issue_type | suggested_correction |
|---|---|---|---|---|---|---|---|---|---|---|

#### Shopping
Campaign-level tagging only:

| account | campaign_name | campaign_id | spend | severity | campaign.final_url_suffix | campaign.tracking_url_template | issue_type | suggested_correction |
|---|---|---|---|---|---|---|---|---|

Followed by: *"Product feed URLs (from Merchant Center) not verified — check Merchant Center directly."*

`severity` values for this skill:
- `high`: missing UTMs; GCLID-only attribution when non-Google data destinations exist
- `medium`: `utm_campaign={campaignid}` macro; casing fragmentation; campaign-name mismatch; double-encoding conflicts
- `low`: acceptable-variation source/medium values; sitelink bypass; legacy `{lpurl}` templates (works, recommend migration)

`issue_type` values: `missing`, `gclid_only`, `macro_campaign_id`, `casing_fragmentation`, `campaign_name_mismatch`, `double_encoding`, `legacy_template`, `acceptable_variation`, `invalid_value`, `sitelink_bypass`.

**Suggested next steps**, for example running `google-ads-check-naming-convention` when `utm_campaign` mismatches trace back to inconsistent campaign names.

## Evidence-forcing rule

Every flag must cite (a) the specific entity ID, (b) the exact field and value that failed, (c) the rule that was violated. No "ads look untagged" without "ad 123456789 on campaign ACME_SEARCH_FR has no final_url_suffix at any level; effective URL has no UTMs."

## Title and summary examples

**Pending (issues found):**
- title: *8% coverage gap and 14 ads with campaign-ID macros*
- summary: *Auto-tagging is the only attribution on 22 ads; utm_campaign={campaignid} leaves reports with numeric IDs across €2.1k/mo of traffic.*

**OK (clean audit):**
- title: *100% UTM coverage across 24 ads and 6 asset groups*
- summary: *All utm_source / utm_medium match the declared schema; final_url_suffix set at account level; no campaign-ID macros; sitelinks inherit correctly.*
- The body describes what was checked (scope, URL sources inspected at each level of the precedence chain, auto-tagging status, schema matched) and why it passed.

## Workspace writes (when the user confirms)

- The user declares or confirms a UTM schema → add or update a "UTM schema" section in `ads/taxonomy.md` covering utm_source values per channel, utm_medium values per channel, the utm_campaign rule, utm_content / utm_term expectations, and the casing convention.
- The user acknowledges an intentional exception → write a new file under `ads/google/memory/` (e.g. `auto-tagging-sufficient.md`) with a date-stamped note, then add a one-liner to `MEMORY.md`. Example entry: "User confirmed auto-tagging is sufficient — account uses GA4 only, no CDP/CRM requiring UTMs."

On an unattended run, don't write `ads/taxonomy.md` or memory; put the proposed schema and exceptions in the finding for the user to confirm.
