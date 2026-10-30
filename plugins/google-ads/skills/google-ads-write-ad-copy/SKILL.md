---
name: google-ads-write-ad-copy
description: Write new or refreshed Google Ads responsive search ad copy (up to 15 headlines of 30 characters and 4 descriptions of 90) and Performance Max asset group text (headlines, long headlines, descriptions) from the ad group's keywords and converting search terms, the landing page, the brand voice in wiki/company.md and the performance labels and ad strength of the existing assets, with character validation, keyword coverage, duplicate checks, an angle mix, pinning guidance and test variants. Use when the user asks to write or rewrite ads, refresh tired or low-rated RSA assets, improve ad strength, draft copy for a new ad group or launch, or write PMax headlines and descriptions. To diagnose keyword, ad and landing page misalignment first use google-ads-audit-ad-relevance; for Display, YouTube and Demand Gen creatives use google-ads-audit-creative-lp-consistency; to design the test itself use google-ads-plan-tests.
---

# Write ad copy

> Write responsive search ad and Performance Max text that covers the ad group's real queries, says what the landing page delivers, and replaces the assets Google rates lowest.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The copy brief template is in `references/ad-copy-brief-template.md`.

## Goal

For each ad group (or asset group) in scope, produce a ready-to-paste asset set: up to 15 headlines and 4 descriptions for an RSA, or the full text set for a PMax asset group, with every line validated for length, covering the keywords that carry the spend, spread across distinct angles, and grounded in claims the landing page supports. In refresh mode, say exactly which existing assets to keep, which to replace and why, and set up the new version as a test rather than a blind swap.

## Scope

- **Search:** responsive search ads (headlines, descriptions, display paths).
- **Performance Max:** asset group text only (headlines, long headlines, descriptions, business name). Images and video are out of scope.
- **Not covered:** Display, Video and Demand Gen creatives (`google-ads-audit-creative-lp-consistency`), sitelinks and other assets, and fixing the landing page itself.
- **Read-only:** the skill drafts copy; the user adds it in Google Ads.

## Modes

- **New:** a new ad group, campaign or launch with no ads yet. Inputs are keywords (planned or live), the landing page and the brand voice. Skip the performance steps.
- **Refresh:** an existing ad group whose RSA has Poor or Average ad strength, `LOW` assets, or copy that hasn't changed in months. The existing assets and their labels drive what gets replaced.
- **PMax:** an asset group's text set, new or refreshed, with the PMax limits.

Ask which mode applies when the user doesn't say; default to Refresh when the ad group already has an RSA.

## Inputs you need

1. **Brand voice and claims:** `wiki/company.md`: product, audience, tone, words the brand uses and avoids, proof points (customer counts, ratings, awards), offers, and anything the business must not claim. If the file has no voice section, ask three questions (how do you talk to customers, what can we prove, what must we never say) and offer to add the answers to `wiki/company.md`.
2. **Taxonomy and motion:** `ads/taxonomy.md`: which motion the campaign serves. Copy for an acquisition campaign sells a first step (start free, see pricing); copy for a demand campaign sells the meeting or the trial. A campaign that tries to say both does neither well.
3. **Brand terms:** `ads/google/index.md`. Brand-term copy belongs in brand campaigns; in non-brand ad groups the brand name appears once at most.
4. **Memory:** `ads/google/memory/MEMORY.md`: banned phrases, legal disclaimers, acknowledged choices ("we always pin the price headline").
5. **Recent findings:** `ads/google/findings/` from the last 30 days, especially `google-ads-audit-ad-relevance` (keywords with missing stems, Below Average ad relevance) and earlier runs of this skill (a refresh started two weeks ago is still learning).
6. **Landing page content:** fetch each final URL in scope with your web fetch tool and extract the title, H1, H2s, prices, offers, proof (reviews, ratings, customer logos, guarantees) and the primary call to action. If a page can't be fetched, ask the user for the key claims and mark the copy "LP not verified".
7. **Live data:** the queries below, for each account in scope, over the 30 days ending yesterday (90 days for low-volume ad groups under 100 clicks in 30 days).

## Phase 1: Pull the data

**Query A: keywords with spend and conversions**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
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

**Query B: top converting search terms per ad group**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  ad_group.id,
  search_term_view.search_term,
  metrics.clicks, metrics.cost_micros,
  metrics.conversions, metrics.conversions_value
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
  AND metrics.conversions > 0
```

Converting search terms are the buyer's own words: they are the best source of headline language, better than the keyword list.

**Query C: the RSAs, their strength and paths**

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  ad_group_ad.ad.id,
  ad_group_ad.status,
  ad_group_ad.ad_strength,
  ad_group_ad.action_items,
  ad_group_ad.ad.final_urls,
  ad_group_ad.ad.responsive_search_ad.path1,
  ad_group_ad.ad.responsive_search_ad.path2,
  metrics.impressions, metrics.clicks, metrics.conversions
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`ad_group_ad.action_items` lists Google's ad strength suggestions; if the field is rejected, drop it and confirm with `get_resource_metadata` on `ad_group_ad`.

**Query D: every asset in those RSAs, with its performance label and pin**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  ad_group.id,
  ad_group_ad.ad.id,
  asset.id,
  asset.text_asset.text,
  ad_group_ad_asset_view.field_type,
  ad_group_ad_asset_view.performance_label,
  ad_group_ad_asset_view.pinned_field,
  ad_group_ad_asset_view.enabled
FROM ad_group_ad_asset_view
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND ad_group_ad_asset_view.enabled = TRUE
  AND ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION')
```

`performance_label` is `BEST`, `GOOD`, `LOW`, `LEARNING`, `PENDING` or `UNKNOWN`. Labels compare an asset with the other assets in the same ad, not with other ads. Some API versions also return impressions and clicks on this view; check with `get_resource_metadata` before relying on them, and treat the label as the primary signal.

**Query E (PMax mode): asset group text, labels and strength**

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  asset_group.id, asset_group.name,
  asset_group.ad_strength,
  asset_group.final_urls,
  asset.id,
  asset.text_asset.text,
  asset_group_asset.field_type,
  asset_group_asset.performance_label,
  asset_group_asset.status
FROM asset_group_asset
WHERE campaign.status = 'ENABLED'
  AND asset_group.status = 'ENABLED'
  AND asset_group_asset.status = 'ENABLED'
  AND asset_group_asset.field_type IN ('HEADLINE', 'LONG_HEADLINE', 'DESCRIPTION', 'BUSINESS_NAME')
```

## Phase 2: Scope and diagnose

Use Python for every step. Load each result with a `customer_id` column, set `cost = cost_micros / 1e6`, and key ad groups on `(customer_id, ad_group.id)`.

1. **Pick the ad groups.** When the user names ad groups, use those. Otherwise, in Refresh mode, rank non-brand ad groups by 30-day spend and keep those that meet any of: an enabled RSA at `POOR` or `AVERAGE` strength (health-check `ad-strength-rsa`), two or more `LOW` assets, or a `google-ads-audit-ad-relevance` finding with Poor ad copy relevance. Cap at 10 ad groups per run; list the rest.
2. **The keywords that matter.** Per ad group, sort keywords by spend and keep those covering 80% of the ad group's spend (cap 10). Add the top 10 converting search terms by conversions from Query B. Strip match-type symbols, lowercase, and drop brand terms in non-brand ad groups.
3. **Stem them.** Use the same stemming as `google-ads-audit-ad-relevance`: drop stop words, stem each token (Snowball stemmer from `nltk` when available, otherwise strip `-ing`, `-es`, `-s`). A keyword's stem set is its set of token stems; a text covers the keyword when every stem is present in it.
4. **Diagnose the current RSA** (Refresh mode). For the RSA with the most impressions per ad group, print:
   - ad strength and Google's action items;
   - asset counts by label (`BEST`, `GOOD`, `LOW`, `LEARNING`/`PENDING`/`UNKNOWN`);
   - keyword coverage: the share of the important keywords covered by at least one headline;
   - angle mix: tag each existing headline with one angle (Step 1 of Phase 3) and count them; one angle holding more than half the headlines is "overused";
   - pins: how many headlines and descriptions are pinned, and to which positions.

## Phase 3: Write the copy

Fill `references/ad-copy-brief-template.md` for each ad group first (motion, audience, the query language, the landing page's claims, proof, offer, CTA, words to avoid), show it to the user, and write from it. Use only claims the landing page or `wiki/company.md` supports.

### Step 1: Angle mix for an RSA

Aim for 15 headlines spread across these angles (a target, not a quota; drop an angle the business can't support rather than inventing it):

| Angle | Headlines | What it does | Example (Acme project software) |
|---|---|---|---|
| Keyword | 3-5 | Repeats the query in buyer language, so the ad looks like the answer | Project Planning Software |
| Benefit | 3-4 | The outcome the buyer gets, not the feature | Ship Projects On Time |
| Proof | 2-3 | Why believe it: numbers, ratings, customers the page shows | Rated 4.8 By 2,000 Teams |
| Offer | 2 | Price, trial, discount, guarantee, as on the page | Free 14-Day Trial |
| CTA | 2 | The next step, matching the page's main button | Start Planning Today |
| Brand | 1 | The brand name, once, in non-brand ad groups | Acme Project Planner |

Descriptions (4): one benefit plus CTA, one proof plus CTA, one offer with its condition, one that answers the buyer's main objection (switching cost, setup time, price). Each description must read on its own, because Google may show any two in any order.

Headlines must also read on their own and in any combination: no headline that only makes sense after another one, and no repetition of the same claim in different words.

### Step 2: Style and policy

- Follow the voice in `wiki/company.md`. Title Case or sentence case consistently across the set, whichever the brand uses.
- No exclamation marks in headlines, at most one in the descriptions; no all-caps words other than acronyms; no repeated punctuation or decorative symbols; no phone numbers in ad text (use call assets).
- Superlatives ("best", "#1", "cheapest") need third-party proof shown on the landing page; without it, rewrite as a specific claim.
- Prices, discounts and trial terms must match the landing page exactly. A mismatch is both a policy risk and the fastest way to lose the click after you paid for it.
- Keyword insertion (`{KeyWord:Default}`) only in tightly themed ad groups, and the default text must fit the limit on its own.

### Step 3: PMax asset group text

Same angle logic, different slots and limits:

| Field | Count | Max characters | Notes |
|---|---|---|---|
| Headline | 3-15 | 30 | Same angles as RSA headlines; include the asset group's search themes |
| Long headline | 1-5 | 90 | A complete benefit plus proof statement; often shown alone on Display and YouTube |
| Description | 2-5 | 90 | At least one of 60 characters or fewer |
| Business name | 1 | 25 | The brand as customers know it |

PMax serves the same text across Search, Display, YouTube and Discover, so avoid lines that only make sense next to a search query ("Looking For X?"). For search theme fit, run `google-ads-audit-pmax-search-themes`.

### Step 4: Pinning guidance

Pin sparingly. Every pin cuts the combinations Google can test and usually lowers ad strength.

- Pin only for a hard requirement: a legal disclaimer, a regulated claim, or a brand rule recorded in memory.
- When position 1 must carry a keyword or the brand, pin two or three alternatives to it rather than one, so the slot still rotates.
- Don't pin descriptions unless a disclaimer requires it.
- In refresh mode, if the current RSA pins more than 3 headlines and isn't under a recorded requirement, recommend unpinning all but the required ones.

## Phase 4: Validate in Python

Run every candidate line through these checks and print the result table; fix and re-run until everything passes.

1. **Length.** Google counts most characters as 1 and wide characters (CJK, full-width forms) as 2. Use `unicodedata.east_asian_width(ch) in ('W', 'F')` → 2, else 1. For keyword insertion, count the default text. Limits: RSA headline 30, description 90, path 15 each; PMax headline 30, long headline 90, description 90 (one at 60 or fewer), business name 25. Print length and remaining characters per line; any line over the limit fails.
2. **Counts.** RSA: 3-15 headlines, 2-4 descriptions. PMax: as the table above. Recommend the full 15 and 4 unless the ad group is too narrow to support distinct lines.
3. **Keyword-stem coverage.** For each important keyword (Phase 2 step 2), count the headlines that cover it. Targets: every keyword from the top 80% of spend in at least 1 headline, and the top 3 keywords in at least 2 headlines each; at least 1 description covers the top keyword. Print a keyword × coverage table and the coverage share. Also flag any headline set where more than 8 of 15 headlines carry a keyword: that leaves too few lines for the other angles.
4. **Duplicates and near-duplicates.** Normalise each line (lowercase, strip punctuation, collapse whitespace). Exact duplicates fail. For every pair within the same field, compute `difflib.SequenceMatcher(None, a, b).ratio()` and the Jaccard overlap of their stem sets; a pair with ratio ≥ 0.8 or Jaccard ≥ 0.8 is a near-duplicate: keep one, rewrite the other on a different angle. Compare new lines against the kept existing assets too.
5. **Angle balance.** Count lines per angle tag; flag any angle above half of the headlines or any missing angle the brief marked as available.
6. **Claims check.** For each proof, offer and price line, confirm the claim string (numbers, percentages, price) appears in the landing page text or `wiki/company.md`; print unmatched claims for the user to confirm or drop.

## Phase 5: Decide what to replace (Refresh mode)

Rank the existing assets by label: `BEST` = 3, `GOOD` = 2, `LOW` = 0; `LEARNING`, `PENDING` and `UNKNOWN` = no rating yet. Then, per RSA:

| Existing asset | Decision |
|---|---|
| `BEST` | Keep. Use its angle and wording as the pattern for new lines. |
| `GOOD` | Keep, unless it is a near-duplicate of a `BEST` asset or it is the line that makes an angle overused. |
| `LOW` | Replace, starting with these. Write the replacement on an angle the RSA lacks, not a reworded copy of the same line. |
| No rating yet | Leave it. An asset needs time and impressions before its label means anything. |
| Pinned and `LOW` | Check whether the pin is a recorded requirement; if not, unpin before judging the line. |

Replace no more than about a third of an RSA's assets in one round, so the next labels still compare new lines against proven ones.

How to apply it: the cleanest read is to keep the current RSA running and add the refreshed version as a second RSA in the same ad group (an ad group can hold up to 3 enabled RSAs), then compare them over the same dates. Editing the existing RSA instead is faster but blurs the before and after. Say which the user chose in the finding.

## Phase 6: Test variants

Turn the choices the data can't settle into test candidates for `google-ads-plan-tests` (if it isn't installed, list them in the finding and suggest a 50/50 ad variation or a second RSA with a fixed end date):

| Test | Control | Variant | Hypothesis | Primary metric |
|---|---|---|---|---|
| Offer-led vs proof-led | current RSA | refreshed RSA with offer headlines replacing 3 LOW lines | The free trial lifts CVR more than ratings do for this query set | conversions per impression |
| Pinned vs unpinned position 1 | keyword headline pinned | no pins | Unpinning raises ad strength without losing CTR | CTR, then CVR |

Conversions per impression (CTR × CVR) is the fairest primary metric for copy: it rewards ads that earn the click and the conversion, not one at the expense of the other.

## Severity

- `high`: an ad group in the top 20% of non-brand spend with `POOR` ad strength, or an offer or price line that contradicts the landing page.
- `medium`: `AVERAGE` strength, two or more `LOW` assets, keyword coverage below 50% of the important keywords, or more than 3 unrequired pins.
- `low`: one `LOW` asset, a single overused angle, or a near-duplicate pair.

## Output

One finding: `category: creative`, `kind: recommendation`.

**Wrap-up example:** *"Drafted refreshed RSAs for 4 non-brand ad groups covering €8.4k of 30-day spend. Each keeps its BEST and GOOD assets, replaces 3-4 LOW headlines with offer and proof lines from the landing page, and raises keyword coverage from 40% to 90%. Suggested as a second RSA per ad group, with an offer-led vs proof-led test for google-ads-plan-tests."*

**General improvements**, for example:
- "6 of 9 RSAs pin headlines to position 1 without a recorded reason; unpinning lets Google test the full set."
- "'Best project tool' appears in 5 ad groups but no landing page shows third-party proof; replaced with 'Rated 4.8 By 2,000 Teams', which the pricing page shows."

**Recommendations:** one table per ad group, ready to paste:

| account | campaign | ad_group | field | text | chars | angle | keywords_covered | pin | action | replaces |
|---|---|---|---|---|---|---|---|---|---|---|
| Acme FR | Non-Brand Generic FR | Planning Software | headline | Project Planning Software | 25 | keyword | project planning software | none | add | "Great Tool For Teams" (LOW) |
| Acme FR | Non-Brand Generic FR | Planning Software | headline | Free 14-Day Trial | 17 | offer | | none | add | |
| Acme FR | Non-Brand Generic FR | Planning Software | headline | Rated 4.8 By 2,000 Teams | 24 | proof | | none | keep | |

**Details tables:**

*Diagnosis per ad group*

| account | campaign | ad_group | spend_30d | ad_strength | best | good | low | unrated | pins | coverage_before | coverage_after | overused_angle | severity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

*Validation*

| ad_group | lines | over_limit | duplicates | near_duplicates | coverage | unmatched_claims | result |
|---|---|---|---|---|---|---|---|

*Test candidates* (the Phase 6 table)

**Pending example**
- title: *Refreshed RSA copy for 4 non-brand ad groups replacing 14 LOW-rated assets*
- summary: *Covers €8.4k of 30-day spend. Keyword coverage rises from 40% to 90%, every line within limits, no near-duplicates; 2 test candidates for google-ads-plan-tests.*

**OK example**
- title: *RSA copy in good shape; every top-spend ad group Good or Excellent with no LOW assets*
- summary: *Checked 12 non-brand ad groups covering 80% of spend: ad strength Good or better, no LOW assets, keyword coverage above 80%, pins only where memory records a requirement.*
- The body lists the ad groups checked and the coverage and label counts behind the pass.

## Workspace writes (when the user confirms)

- The user approves the copy → write `ads/google/strategy/ad-copy/<campaign-slug>.md` with the brief and the final asset table per ad group, dated, so the next refresh starts from it. On a later run, add a dated section rather than overwriting.
- The user approves a test → hand the test candidates to `google-ads-plan-tests`, which writes `ads/google/strategy/test-plan.md`; don't write the test plan from this skill.
- The user states a copy rule ("never say cheap", "always pin the disclaimer") → write a memory file under `ads/google/memory/` and add a line to `MEMORY.md`.
- The brand voice was gathered by questions → propose the voice section for `wiki/company.md` and write it on confirmation.

## Evidence rule

Every replacement names the asset, its label and the reason; every new line gives its length, angle and the source of its claim:

> *"Replace 'Great Tool For Teams' (headline, LOW, unpinned) in Planning Software, Non-Brand Generic FR: LOW label, and the RSA has 6 of 15 headlines on the benefit angle and none on the offer. New: 'Free 14-Day Trial' (17 chars, offer), claim matched on the landing page pricing section."*

Never state a claim, number or price the landing page or `wiki/company.md` doesn't support, and never predict the ad strength or CTR the new copy will reach.
