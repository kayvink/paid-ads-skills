---
name: google-ads-audit-naming-convention
description: Quick spend-weighted check of whether Google Ads campaign, ad group and ad names are consistent, machine-parseable and complete enough for automated reporting, including delimiter, casing, collisions, field coverage and whether names still support the brand and non-brand split. Use when the user asks for a fast naming health check or during an account audit. For the full per-format audit with schema bootstrap, scalability gaps and taxonomy writes use google-ads-check-naming-convention.
---

# Audit naming convention

> Do campaign, ad group, and ad names include all critical data elements and follow consistent structural rules?

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Priorities follow `references/priority-tiers.md`.

## Question

Are naming conventions consistent, machine-parseable, and complete enough to support automated reporting, filtering, and analysis?

The workspace taxonomy defines the expected standard; it does not prove the live account follows it. Always inspect current live names before giving an all-clear.

## Data required

Run for each account in scope; use a 30-day window ending yesterday.

```sql
-- Campaigns with 30-day spend
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Ad groups with 30-day spend
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, ad_group.id, ad_group.name, metrics.cost_micros
FROM ad_group
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
-- Ads with 30-day spend
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
  metrics.cost_micros
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND ad_group_ad.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Also read the naming schema, if one is declared (expected fields, field order, delimiter), from `ads/taxonomy.md`, acknowledged exceptions from `ads/google/memory/MEMORY.md`, and `brand_terms` from `ads/google/index.md`.

Responsive search ads usually have no ad name; don't count an empty RSA name as a defect unless the declared schema asks for ad names on Search.

## Method

Use Python for every step: load each query into a DataFrame, compute `spend = cost_micros / 1e6` summed per `(customer_id, entity_id)`, and stack the three levels into one table with a `level` column.

### 1. Establish the expected schema

If a naming schema exists (in `ads/taxonomy.md` or memory), use it. If not, check against platform best practices:

**Campaign level:** [Platform][Channel][Objective][Geo]
**Ad group level:** Audience name/theme OR keyword themes
**Ad level (Google):** Format + Theme/Offer + Hook/CTA + Variant/Code

### 2. Check structural consistency

For each naming level (campaign, ad group, ad), check:
- **Delimiter consistency:** a single delimiter throughout (prefer `_`). Flag mixed delimiters (`-`, `|`, `/`, spaces). In Python, count each delimiter per name; the level's dominant delimiter is the one most names use most; flag names whose most-used delimiter differs or that use more than one.
- **Field ordering:** same sequence across all names at the same level. Split on the dominant delimiter; flag names whose token count differs from the level's modal count, or whose recognisable tokens (country codes, channel codes such as `SRCH` or `PMAX`, funnel words) sit in a different position than in the dominant pattern.
- **Casing:** consistent casing (all UPPER_SNAKE, all lower_snake, or all Title_Case). Classify each name by its letter tokens (`isupper`, `islower`, `istitle`, else mixed); flag names outside the dominant class.
- **Special characters:** flag names matching `[&%/,()]`, or where `name != name.strip()`.
- **Length:** flag names > 150 characters.
- **Collisions:** flag identical names with different IDs: group by `(customer_id, level, name)` and keep groups with more than one distinct ID.

Then compute the **consistency score** per level: the share of names that match the dominant delimiter, casing class and token count at the same time.

### 3. Check field coverage

For the 7 critical naming elements — Funnel, Audience, Creative Variant, Objective, Geo, Date/Version, Language/Placement — check:
- Is the field present in the name or in a separate column/label? Geo is always available as location targeting and Objective as the bidding strategy, so they don't have to be in names unless the schema says so.
- If encoded in the name, is the position consistent?
- Which fields are missing at which levels?

In Python, tag each token with the field it most likely encodes (country or language code → Geo, funnel words → Funnel, `RET`/`PRO`/`LAL`/`CRM` and similar → Audience, `V1`/`HOOK01`-style codes → Creative Variant, dates or `Q3`/`2026` → Date/Version) and print, per level, the share of names and of spend carrying each field.

### 4. Prioritise by spend

Weight findings by spend. A naming issue on a campaign spending 40% of the budget matters more than one on a campaign spending 0.5%. In Python, give every flagged entity its share of the account's 30-day spend and sort issues by that share.

### 5. Classify findings

- **Critical:** no discernible naming pattern (names are freeform), OR names collide (same name, different entities), OR critical fields missing on high-spend campaigns.
- **Moderate:** inconsistent delimiters or casing, missing non-critical fields, names > 150 chars.
- **Low:** minor inconsistencies on low-spend campaigns, cosmetic issues.

### 6. Check brand separation dependency

If reporting depends on a branded / non-branded campaign split, verify that live Search campaign names still support the brand classification. In Python, classify each live Search campaign as brand when its name contains "brand" or any term in `brand_terms` (case-insensitive), and compare with the campaign groups in `ads/taxonomy.md` when present. If the saved pattern misclassifies active campaigns, list those campaigns and recommend reviewing `brand_terms` and the groupings.

## Interpretation guide

- Freeform names break automated reporting and filtering. Every dashboard query, script, and health check that parses campaign names will misfire.
- Missing geo in the name forces manual lookup of location targeting settings. This slows every audit that needs market context.
- Delimiter inconsistency is the most common structural issue and the easiest to fix — a one-time rename pass resolves it account-wide.
- Name collisions (same name, different IDs) cause ambiguity in reports and can mask duplicate campaigns.

## Output

One finding: `category: structure`, `kind: audit`. Fill the standard body with:

1. **Structure summary:** delimiter used | casing convention | average field count | consistency score (% of names matching the dominant pattern), per level and account.
2. **Issues table** (sorted by spend desc): account | entity (campaign / ad group / ad) | name | spend (30d) | missing fields | structure issues | priority | recommended fix.
3. **Schema recommendations:** if no schema exists, propose one based on the dominant pattern; if a schema exists, list deviations.
4. **Brand classification check:** campaigns whose live names appear to disagree with the brand / non-brand classification.
5. **Wrap-up:** overall consistency assessment, highest-impact fixes, count of entities needing attention.

If cleanup is needed, include all affected live entities with spend and suggested fixes. If clean, write an `ok` finding that states the scope checked (levels, entity counts, window, schema used).
