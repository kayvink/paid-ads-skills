---
name: google-ads-check-naming-convention
description: Deep audit of Google Ads campaign, ad group, asset group and ad names against a declared naming schema or best-practice defaults, covering critical-field coverage, structural hygiene (delimiters, casing, collisions, length) and scalability gaps, with per-format detail tables and a proposed schema when none exists. Use when the user asks to audit or design a naming convention, set up `ads/taxonomy.md`, or check whether names support reporting. For a quick spend-weighted consistency check use google-ads-audit-naming-convention.
---

# Check naming convention

> Audit campaign / ad-group / ad naming against best practices for reporting and clean data analysis — coverage of critical fields, structural hygiene, schema consistency.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

For each channel, ensure the fields needed for reporting and optimisation are available and populated. Preferred: dedicated schema columns. Fallback: encoded in names. Validate structural hygiene (order, delimiters, casing, character use) and consistency of application.

The declared taxonomy and the workspace settings are the standard to test against, not evidence that naming is correct. Always pull live names and verify the active account entities directly.

## Scope

Google Ads only. Meta, LinkedIn and TikTok follow the same framework; the per-channel creative-level expectations below are documented so the same schema can be applied when those channels are audited.

## Creative-level entity by campaign type

Different formats have different "creative containers." The naming check has to target the right entity per format:

| Campaign type | Creative-level entity | Queryable as |
|---|---|---|
| Search (incl. DSA) | Ad | `ad_group_ad` |
| Display | Ad | `ad_group_ad` |
| Video | Ad | `ad_group_ad` |
| Demand Gen | Ad | `ad_group_ad` |
| **Performance Max** | **Asset group** | `asset_group` |
| **Shopping** | **Ad group** (carries inventory segmentation) | `ad_group` |

**Rule: campaign-level names stay broad regardless of format** — Platform, Channel, Objective, Geo. Variant / creative / theme info goes *one level below*:
- Ad name for traditional formats
- Asset group name for PMax
- Ad group name for Shopping

Don't encode creative specifics in campaign names even when the format "feels" like it should. Campaign-level reporting stays comparable across formats; the narrower cuts live one level down.

## Inputs you need

1. **Schema declaration:** read `ads/taxonomy.md`. If the user has declared a naming schema (required fields, order, delimiter, casing), use it as the target. If the file is missing, empty or a placeholder, use the best-practice defaults below.
2. **Account memory:** read `ads/google/memory/MEMORY.md`. Scan for prior acknowledgments (for example "Geo not required in names") and read the individual memory files for full context.
3. **Business context:** read `wiki/company.md` to calibrate recommendations to scale and sophistication.
4. **Brand terms and groupings:** read `brand_terms` from `ads/google/index.md` and the campaign groups in `ads/taxonomy.md`; step 5 checks whether live names still support them.
5. **Live entities, loaded lazily by channel type.** Don't fire every query upfront: inspect which channel types are actually in the account first, then pull only the relevant follow-ups. Run each query for every account in scope over the last 30 days ending yesterday, written as an explicit `BETWEEN` range.

### Step 4a: Campaign inventory first

Pull a campaign-level summary to see which channel types are present:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  campaign.status,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use Python to list the distinct `campaign.advertising_channel_type` values per account and decide which of 4b/4c/4d to run. **Skip any step whose channel type isn't present**: wasted calls and empty results pollute output.

### Step 4b: Traditional ads (only if Search / Display / Video / Demand Gen present)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  ad_group.id, ad_group.name,
  ad_group_ad.ad.id, ad_group_ad.ad.name,
  metrics.cost_micros
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'DISPLAY', 'VIDEO', 'DEMAND_GEN')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Responsive search ads often have no ad name (the field is empty). That is normal for Search and is not a blank-name violation unless the declared schema requires ad names on Search.

### Step 4c: Performance Max asset groups (only if PMax present)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  asset_group.id, asset_group.name, asset_group.status,
  metrics.cost_micros
FROM asset_group
WHERE campaign.advertising_channel_type = 'PERFORMANCE_MAX'
  AND campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

### Step 4d: Shopping ad groups (only if Shopping present)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name, ad_group.status,
  metrics.cost_micros
FROM ad_group
WHERE campaign.advertising_channel_type = 'SHOPPING'
  AND campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use Python to build one entity table per level (campaign, ad group, asset group, ad) with columns `customer_id, account, level, entity_id, name, parent ids, spend`, where `spend` is the sum of `cost_micros / 1e6` per `(customer_id, entity_id)`. Every later step runs on these tables.

## Critical fields to check for

Across all entities, coverage of:

- **Funnel stage** (awareness / consideration / conversion / retention)
- **Audience** (cold, retargeting, lookalike, existing customers, etc.)
- **Creative Variant** (for testing — usually only at the creative level)
- **Objective** (traffic, conversions, reach, engagement)
- **Geo** (country, region)
- **Date / Version** (for time-limited or iterative campaigns)
- **Language / Placement**

Where each field belongs depends on format — see the per-format tables below.

## Validation cascade

Apply in order:

1. **Prefer schema columns over name parsing.** If the platform exposes a field, use the column and don't require it to also appear in the name. Geo is in the campaign's location targeting (`campaign_criterion` rows with `type = 'LOCATION'`, with `campaign.geo_target_type_setting` saying presence or interest); Objective is inferable from `campaign.bidding_strategy_type`.
2. **For fields without columns, check name encoding.** Creative Variant, Funnel and Audience-theme are typically only in names at the right level.
3. **If a schema is declared in `ads/taxonomy.md`, validate against it.** Required fields appear in declared order with the declared delimiter; casing matches the declared convention.
4. **If no schema is declared, validate against the best-practice defaults (below).** Flag the absence of a declared schema itself as an improvement opportunity.
5. **Cross-reference `ads/google/memory/MEMORY.md`.** If the user has explicitly acknowledged the absence of a field, do NOT re-flag it.

## Structural hygiene rules

Check every name (campaign, ad group, asset group, ad) for:

- **Consistent field order** across entities in the same account
- **Consistent delimiter**: prefer `_`. Flag accounts that mix `-` and `_` within names.
- **No spaces**
- **No special characters**: `&`, `%`, `/`, `,`, etc.
- **Consistent casing**: e.g. all `UPPER_SNAKE` (`PRO_RET_VID01`), not mixed with `Pro-ret_vid01`
- **No collisions**: the same name used for different IDs is a reporting hazard
- **Not excessively long**: flag names > 150 chars
- **Not blank**: ad-level / asset-group / ad-group names that are empty strings break all name-based reporting

Use Python to apply these per level and per account:

- **Delimiters:** for each name, count occurrences of `_`, `-`, `|`, `/` and spaces. The account's dominant delimiter at a level is the one used by the most names (weighted by count of names, not spend). Flag a name as `wrong delimiter` when its most frequent delimiter differs from the dominant one or from the declared one, and as mixed when it uses both `_` and `-`.
- **Spaces and special characters:** flag `contains spaces` when `" " in name.strip()`, and leading/trailing spaces when `name != name.strip()`. Flag special characters with the regex `[&%/,()]` (drop `/` from the regex when `/` is the declared delimiter).
- **Casing:** split on the dominant delimiter and classify each name by its letter tokens: `upper` when every token is `token.isupper()`, `lower` when every token is `token.islower()`, `title` when every token is `token.istitle()`, else `mixed`. Ignore tokens without letters. The dominant casing is the most common class; flag names in another class or in `mixed` as `inconsistent casing`.
- **Field order and count:** split on the dominant delimiter and record the token count. Flag names whose count differs from the level's modal count. When a schema is declared, map tokens to fields by position and check each token against the field's declared allowed values (if any). When no schema is declared, find recognisable tokens (country or language codes, channel codes such as `SRCH`, `PMAX`, `DISP`, `VID`, funnel words such as `AWARE`, `CONS`, `CONV`, `RET`) and flag names where such a token sits in a different position than in the dominant pattern (`field order mismatch`).
- **Length:** flag `len(name) > 150` as `too long`.
- **Blank:** flag `name.strip() == ""` as `blank name` (except Search RSAs, see step 4b).
- **Collisions:** group by `(customer_id, level, name)` and flag any group with more than one distinct entity ID (`collision with <other entity>`).
- **Spend at stake:** for every issue type, print the count of entities and the sum of their 30-day spend, plus the share of the level's total spend.

## Best-practice defaults (when no schema declared)

### Campaign level (all formats)
`[Platform]_[Channel]_[Objective]_[Geo]`

Broad. Comparable across formats. No creative/variant info.

### Container level (one below campaign)

Purpose: segment by audience / theme / inventory.

| Campaign type | Container entity | Expected elements |
|---|---|---|
| Search | Ad group | Keyword theme, or audience code for RLSA |
| Display | Ad group | Audience code |
| Video | Ad group | Audience code, theme |
| Demand Gen | Ad group | Audience code, theme |
| **Performance Max** | **Asset group** | **Theme/Offer + Audience signal + Variant/Code** (this IS the creative level for PMax) |
| **Shopping** | **Ad group** | **Inventory segment** (Brand, Category, Featured SKU) |

### Creative level (where applicable)

Only formats with a separate creative level:

| Channel | Expected elements |
|---|---|
| Google Ads (Search / Display / Video / Demand Gen) | Format + Theme/Offer + Hook/CTA + Variant/Code |
| Meta (FB/IG) | Format + Angle/Hook + CTA + Creator/Variant/Code |
| LinkedIn | Format + Offer/Content + CTA + Variant/Code |
| TikTok | Hook/Angle + CTA + Format/Creator + Variant/Code |

**PMax and Shopping don't have a separate creative level.** Their creative/variant info lives in the container (asset group / ad group) name — see the table above.

Examples of good casing: `PRO_RET_VID01`, `GADS_SRCH_CONV_NL`, `META_AWARE_VIDEO_NEWS_HOOK01`.

## Scalable schema — aspirational completeness check

Beyond the minimum default shape, the schema to aim for as an account scales covers six fields:

`FunnelStage_Audience_Offer_CreativeVariant_Geo_Date`

- **FunnelStage**: awareness / consideration / conversion / retention
- **Audience**: cold, retargeting, lookalike, customer segment
- **Offer**: product line, promo, feature, landing-page angle
- **CreativeVariant**: specific ad/asset iteration code (e.g. `HOOK01`, `v2`)
- **Geo**: country or region
- **Date**: for time-limited or versioned rollouts

These distribute across the three levels — not all at one level. Campaign carries Platform/Channel/Objective/Geo; container (ad group / asset group) carries Audience and broad theme; creative (ad / asset group for PMax) carries Offer, CreativeVariant, and Date. What matters is that **across the levels, all six are discoverable**, either as a column or encoded in names.

**When any of these six fields is missing from both schema columns AND name encoding at every level, flag it as a scalability gap.** Not as an immediate blocker (the account may be fine today without it), but note: *"As you add more variants / markets / time-limited offers, missing [FIELD] will make segmentation in reporting harder to recover."*

Use Python to build a coverage matrix: rows are the six fields plus Objective and Language/Placement, columns are the levels, and each cell is `column`, the share of names (and of spend) where a token for that field was recognised, or `absent`. A field is a scalability gap when its row is `absent` everywhere.

## Modes

### No taxonomy declared (bootstrap)

1. Observe naming patterns and structural mechanics across the account.
2. Draft a proposed schema from what you see + best-practice defaults.
3. Write the proposal as the finding body: observations, proposed schema, clarifying questions that determine specifics (e.g. "Is FR country or language? For a French-speaking user in Belgium, which campaign?"), suggested next steps.

Do NOT emit structural verdicts ("funnel is unsupported") in bootstrap mode. You don't have ground truth yet. The output is observations + proposal + questions, not judgements.

### Taxonomy declared (verify)

1. Check compliance of live entities against the declared schema + structural hygiene rules.
2. Surface deviations and proposed fixes. Do NOT re-flag items previously acknowledged in `ads/google/memory/`.

If a campaign grouping in `ads/taxonomy.md` or the brand / non-brand split (`brand_terms` in `ads/google/index.md`) depends on campaign naming, verify that the live campaign names still support it. Groupings go stale when campaigns are renamed or new campaigns launch. Use Python to classify each live campaign by the grouping rule as written, and list campaigns that match no group or that the rule puts in a group their name or keywords contradict.

## Output content

One finding: `category: structure`, `kind: audit`, covering all accounts in scope. The standard body sections carry:

**Wrap-up:** overall schema compliance + biggest structural issue + spend impact.
Example: *"Schema is missing Audience + Funnel fields; 12 campaigns with mixed delimiters across €4.2k/mo of active spend."*

**Per-account summary** when more than one account is in scope: coverage % and top issue per account.

**General improvements:** schema-level findings. Examples:
- "Add Audience as a dedicated field — currently absent from names and no column populated"
- "Standardise delimiter to `_` — currently mixed `_` and `-`"
- "Introduce max-length rule (150 chars)"

**Scalability gaps:** flag missing fields from the aspirational `FunnelStage_Audience_Offer_CreativeVariant_Geo_Date` schema. Frame as future-proofing, not urgent errors — unless `memory/` acknowledges them as intentional, in which case skip.
- "Offer is not encoded anywhere today. As you roll out promos and product-line variants, reporting by offer won't be possible without backfill."
- "Date / version is missing. Fine for evergreen campaigns; will hurt when you run seasonal / time-limited pushes."

**Recommendations:** structural rules to add or adjust in the declared schema, plus a rename table the user can apply (account, level, entity, current name, proposed name, reason).

**Details tables**, split by entity shape (render only sections with issues; account name first, sorted by severity then spend, about 20 rows each with the rest summarised):

#### Traditional ads — Search / Display / Video / Demand Gen
| account | campaign_name | campaign_id | ad_group_name | ad_group_id | ad_name | ad_id | spend | severity | missing_fields | structure_issues | recommended_fix |
|---|---|---|---|---|---|---|---|---|---|---|---|

#### Performance Max — asset groups
| account | campaign_name | campaign_id | asset_group_name | asset_group_id | spend | severity | missing_fields | structure_issues | recommended_fix |
|---|---|---|---|---|---|---|---|---|---|

#### Shopping — ad groups
| account | campaign_name | campaign_id | ad_group_name | ad_group_id | spend | severity | missing_fields | structure_issues | recommended_fix |
|---|---|---|---|---|---|---|---|---|---|

`severity` values for this skill:
- `high`: blank names, collisions, critical field missing (breaks reporting)
- `medium`: mixed delimiters, casing inconsistency, field order wrong
- `low`: overly long names, scalability-gap-only fields missing

`structure_issues` examples: `"wrong delimiter"`, `"too long"`, `"contains spaces"`, `"inconsistent casing"`, `"field order mismatch"`, `"collision with campaign X"`, `"blank name"`.

**Suggested next steps**, for example running `google-ads-check-utm-tagging` once names are fixed, since `utm_campaign` usually carries the campaign name.

## Evidence-forcing rule

Every structural claim must cite a concrete name (campaign / ad group / asset group / ad) and the specific rule it violates. No "names look inconsistent" without "campaign X uses `-` while campaign Y uses `_`." If you can't cite evidence, you can't make the claim.

## Title and summary examples

**Pending (issues found):**
- title: *12 campaigns and 4 asset groups with schema gaps*
- summary: *Missing Funnel and Audience fields; 8 campaigns use mixed delimiters across €4.2k/mo of active spend.*

**OK (clean audit):**
- title: *All 24 campaigns and 6 asset groups compliant with the declared schema*
- summary: *Longest name 87 chars; delimiter consistent (_); casing uniform; no collisions. Checked against `ads/taxonomy.md` as of {date}.*
- The body describes what was checked (scope, entity counts, rubric, date range) and why it passed. Never empty.

## Workspace writes (when the user confirms)

- The user confirms or adjusts a schema → write the canonical schema to `ads/taxonomy.md`, replacing any placeholder.
- The user acknowledges an intentional exception → write a new file under `ads/google/memory/` (e.g. `geo-not-required.md`) with a date-stamped note, then add a one-liner to `MEMORY.md`. Example entry: "User confirmed Geo not required in names — single-market account (FR only)."

On an unattended run, don't write `ads/taxonomy.md` or memory; put the proposed schema and exceptions in the finding for the user to confirm.
