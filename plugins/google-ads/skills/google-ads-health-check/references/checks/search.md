# Search checks

These checks cover Search campaigns (`campaign.advertising_channel_type = 'SEARCH'`), their ad groups, keywords, search terms and audiences. A few also look at Shopping and Performance Max campaigns where the setting is shared (extensions, negative coverage), and a few read every channel because the original engine did (noted in the entry). Shared setup for every check in this file:

- **Accounts.** Run each query once per account in scope. Add a `customer_id` column when you load each result and use `(customer_id, entity_id)` as the key for every join and group-by. Report accounts by `customer.descriptive_name`, money in each account's `customer.currency_code`.
- **Window.** "Last 30 days" means the 30 days ending yesterday, written as `segments.date BETWEEN '<start>' AND '<end>'`. The queries leave `segments.date` out of `SELECT`, so the API returns one row per entity summed over the window. Still group and sum per entity in Python, so the result is the same if your MCP returns per-day rows.
- **Conversions.** These checks use `metrics.conversions` (all primary conversion actions), as the engine did. They do not filter to `primary_conversion_action`.
- **Unknown.** Unless an entry says otherwise, a check is **unknown** only when its queries fail on every account and return no rows; report the error per account. When some accounts fail, run the logic on the rest and name the failed accounts in the result. Zero rows with no errors is **ok** (nothing matched), but say that no matching entities were found.
- **Status rollup.** A check can emit several observations; its status is the worst kind among them: fail > warn > opportunity > ok. An `info` observation still leaves the status at **ok**, but include its numbers in the report.
- **Settings.** Defaults below are the engine's. If `ads/google/health/<id>.md` or `ads/google/rules/` records a different value the user chose, use that.

## Missing RSAs

- **ID:** `missing-rsa`
- **Category:** creative · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Every active Search ad group has at least 1 enabled Responsive Search Ad. ETAs are gone and DSAs are their own format, so an RSA-less ad group is a non-serving ad group.
- **Settings:** none.

**Queries**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  ad_group_ad.ad.id,
  ad_group_ad.ad.type,
  ad_group_ad.status
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. Group rows by `(customer_id, ad_group.id)`. For each ad group count rows where `ad_group_ad.ad.type` (upper-cased) is `RESPONSIVE_SEARCH_AD`. `EXPANDED_TEXT_AD` and `DYNAMIC_SEARCH_AD` do not count.
2. Offenders are ad groups with an RSA count of 0.
3. The query only sees ad groups that have at least one enabled ad, so an ad group with no enabled ads at all is not caught (same as the engine).

**Result**

- **fail:** at least one offending ad group. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N active Search ad groups have zero Responsive Search Ads enabled. Without an RSA the ad group can't serve, and every impression-share metric will be zero." Table: account, campaign, ad group. Cap 50 rows.
- **Action:** Open each ad group and create a Responsive Search Ad with 10 to 15 headlines and 3 to 4 descriptions to reach Good or Excellent ad strength. If the ad group is intentionally inactive, pause it instead of leaving an empty active ad group.

## RSA ad strength

- **ID:** `ad-strength-rsa`
- **Category:** creative · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each active RSA rates at least Good ad strength. Weaker ads serve less and cost more per click.
- **Settings:** `minStrength` = GOOD (flag any RSA below this: POOR, AVERAGE, GOOD, EXCELLENT); `maxOffending` = 0 (pass if weak RSAs are at or below this count).

**Queries**

```sql
SELECT
  customer.descriptive_name,
  campaign.name,
  campaign.status,
  ad_group.name,
  ad_group_ad.ad.id,
  ad_group_ad.ad_strength
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
  AND campaign.status = 'ENABLED'
```

There is no channel filter: any enabled RSA in an enabled campaign counts.

**Analyse with Python**

1. Rank strengths: `PENDING`, `UNSPECIFIED`, `UNKNOWN`, `NO_ADS` = 0; `POOR` = 1; `AVERAGE` = 2; `GOOD` = 3; `EXCELLENT` = 4. Any other value ranks 0. The minimum rank is the rank of `minStrength` upper-cased, or 3 if it isn't a known value.
2. Count the distribution of EXCELLENT, GOOD, AVERAGE, POOR across all rows.
3. Offending ads are rows whose rank is below the minimum rank. Pending and unrated ads count as offending.
4. Share = round(offending / total RSAs × 100), 0 when there are no rows.

**Result**

- **warn:** offending count > `maxOffending`. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N of M responsive search ads (X%) are below `<minStrength>` ad strength. Weaker ads get shown less and cost more per click; even small strength upgrades typically lift ROI." Table: account, ad ID, strength, ad group, campaign. Cap 20 rows. Also print the distribution (total, excellent, good, average, poor).
- **Action:** Open each ad and work through the ad strength suggestions, or add more headline and description variants. Aim for 10 or more headlines and 3 to 4 descriptions, each covering a distinct angle (features, benefits, social proof, urgency).

## Ad extension coverage

- **ID:** `ad-extensions`
- **Category:** creative · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each campaign has 4+ sitelinks, 4+ callouts, and 1+ structured snippet. Extensions cost nothing and lift CTR.
- **Settings:** `minSitelinks` = 4 (minimum SITELINK assets per campaign); `minCallouts` = 4 (minimum CALLOUT assets); `minStructuredSnippets` = 1 (minimum STRUCTURED_SNIPPET assets).

**Queries**

Query A, campaigns in scope:

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING', 'PERFORMANCE_MAX')
```

Query B, campaign-level assets:

```sql
SELECT
  campaign.id,
  campaign.status,
  campaign_asset.asset,
  campaign_asset.field_type,
  campaign_asset.status
FROM campaign_asset
WHERE campaign_asset.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

**Analyse with Python**

1. From Query B, count rows per `(customer_id, campaign.id)` by `campaign_asset.field_type` (upper-cased): `SITELINK`, `CALLOUT`, `STRUCTURED_SNIPPET`. Only campaign-level links count; account-level and ad-group-level assets are not included (same as the engine).
2. For each campaign in Query A, look up its counts (0 when absent). It is offending when sitelinks < `minSitelinks`, callouts < `minCallouts`, or snippets < `minStructuredSnippets`. Record which minimums it misses, as `sitelinks<4`, `callouts<4`, `structured_snippets<1`.
3. For context, average the sitelink, callout and snippet counts over every campaign in Query B (any channel) that meets all three minimums; 0 when none does.
4. Covered = Query A campaigns minus offending ones.

**Result**

- **warn:** at least one offending campaign. — **ok:** otherwise.
- **unknown:** both queries fail on every account with no rows.
- **Report:** "N of M campaigns are below the recommended ad-extension counts. Campaigns that meet the bar average X sitelinks, Y callouts and Z snippets." Table: account, campaign, sitelinks, callouts, structured snippets, missing. Cap 20 rows. Also print covered campaigns "C of M".
- **Action:** For each campaign, add the missing asset types: 4+ sitelinks (deep links to key pages), 4+ callouts (short value props), at least 1 structured snippet (a list like "Service categories: ..."). Reuse across campaigns where it makes sense.

## Keyword expansion candidates

- **ID:** `keyword-expansion-candidates`
- **Category:** growth · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Converting search terms are reviewed weekly and the strongest are promoted to keywords (usually exact match in a tightly themed ad group), so Smart Bidding learns on intent you've endorsed instead of inferring from broad-match drift. This is the upside counterpart of `search-terms-waste`.
- **Settings:** `minConversions` = 3 (minimum 30-day conversions; values below 1 become 1); `minSpend` = 0 (optional 30-day spend floor in account currency; 0 disables it).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  search_term_view.search_term,
  search_term_view.status,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.status = 'ENABLED'
```

No channel filter (as in the engine).

**Analyse with Python**

1. Drop rows with an empty search term. Group by `(customer_id, search_term, campaign, ad group)` and sum cost (`cost_micros / 1e6`), clicks, conversions and conversion value. Mark the group as already a keyword if any of its rows has `search_term_view.status` in `ADDED` or `ADDED_EXCLUDED`.
2. Candidates: not already a keyword, conversions ≥ `minConversions`, cost ≥ `minSpend`. Sort by conversions, highest first.
3. Totals over all candidates: conversions and conversion value.

**Result**

- **opportunity:** at least one candidate. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N search terms drove at least `minConversions` conversions over the last 30 days but aren't yet keywords: about X conversions (Y in value) currently happening on broad-match inference. Promoting them to exact-match keywords gives Smart Bidding cleaner intent to learn from." Table: account, search term, campaign, ad group, conversions (1 decimal), spend, clicks. Cap 20 rows.
- **Action:** For each term, decide which ad group it fits and add it as an exact-match keyword (or phrase, if the variants matter). Group similar terms into a tightly themed ad group with matching ad copy. Re-check in 2 weeks: the new keywords should claim most of the volume from broad match.

## Search network leak

- **ID:** `network-leak-on-search`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each Search campaign serves only on Google Search results. The Display Network is opt-in for a reason: banner inventory has nothing in common with Search intent and quietly burns budget. Search Partners can be net-positive but should be turned on consciously, monitored, and turned off when they underperform.
- **Settings:** none.

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.network_settings.target_search_network,
  campaign.network_settings.target_content_network,
  campaign.network_settings.target_partner_search_network,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

`target_search_network` is the "Include Google search partners" setting; `target_content_network` is "Include Google Display Network".

**Analyse with Python**

1. Group by `(customer_id, campaign.id)`, sum cost, keep the two booleans from the first row.
2. Display leaks: campaigns with `target_content_network = true`, sorted by spend, highest first. Sum their total campaign spend.
3. Partners on: campaigns with `target_search_network = true`, sorted by spend.

**Result**

- **warn:** at least one Display leak. — **opportunity:** at least one campaign with Search Partners on. — **ok:** neither. Both observations can appear together; the status is the worse one.
- **unknown:** shared rule.
- **Report (Display):** "N Search campaigns have the Display Network turned on. It routes part of every Search budget onto banner inventory that has nothing in common with Search intent; it's the most common silent waste pattern in Google Ads." Table: account, campaign, 30-day spend. Cap 20. Print the summed spend of those campaigns.
- **Action (Display):** In each campaign's Settings, Networks, uncheck "Include Google Display Network". If you want Display reach, run a separate Display campaign with its own budget and creative; never blend it into Search.
- **Report (Partners):** "N Search campaigns are serving on Search Partners. This isn't automatically wrong, but it's an unmeasured assumption until you compare CPA on partners against Google Search." Table: account, campaign, 30-day spend. Cap 20.
- **Action (Partners):** Segment each campaign by network and compare CPA and ROAS on Search partners against Google search (the `search-partner-roas` check does this). If partner CPA is meaningfully worse (about 20% or more), uncheck "Include Google search partners"; if it's neutral or better, keep it on and re-check quarterly.

## Search term waste

- **ID:** `search-terms-waste`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No single search query burns meaningful money without converting. Once a query has paid its way for 30 days with nothing to show, it's added as a negative. Reviewed weekly, this steadily improves CPA without touching a bid.
- **Settings:** `minWastedCost` = 50 (only flag terms whose 30-day spend is at least this, account currency); `excludeStatuses` = `ADDED_EXCLUDED,EXCLUDED` (`search_term_view.status` values to skip, typically already-negated terms).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.status,
  ad_group.id,
  ad_group.name,
  search_term_view.search_term,
  search_term_view.status,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.status = 'ENABLED'
```

No channel filter (as in the engine).

**Analyse with Python**

1. Drop rows with an empty search term. Group by `(customer_id, search_term, campaign, ad group)`; sum cost, clicks, conversions. Mark the group as already negated if any row's status (upper-cased) is in `excludeStatuses`.
2. Offenders: not already negated, cost ≥ `minWastedCost`, conversions exactly 0. Sort by cost, highest first.
3. Total search-term spend = sum of cost over all groups (including negated ones). Wasted spend = sum over offenders. Wasted share = round(wasted / total × 100), 0 when total is 0.

**Result**

- **warn:** at least one offender. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N search terms spent at least `minWastedCost` in the last 30 days without a single conversion: about X (Y% of all search-term spend). These are direct negative-keyword candidates." Table: account, search term, campaign, ad group, cost, clicks. Cap 20. Print wasted spend, wasted term count, wasted share. With several accounts, give spend per account in its own currency.
- **Action:** Review each term in the Search terms report, decide whether it's salvageable (intent is right, ad copy is wrong) or genuine waste, and add the wasted ones as negative keywords, phrase or exact match, scoped to the ad group or a shared list as appropriate. Aim to do this weekly.

## Search brand leak

- **ID:** `search-brand-leak`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Zero brand queries land in non-brand campaigns. A dedicated brand Search campaign captures every branded search; non-brand campaigns have brand terms excluded as exact-match negatives. Brand traffic is reported separately so non-brand performance is the real efficiency signal, not flattered by cheap brand conversions.
- **Settings:** `minLeakedClicks` = 5 (only flag leaks with at least this many 30-day clicks).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  ad_group.name,
  search_term_view.search_term,
  search_term_view.status,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM search_term_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. Read `brand_terms` from `ads/google/index.md`. If the list is missing or empty, stop: the check is unknown (see Result). In a conversation you can propose a list per conventions section 3 and rerun once the user confirms it.
2. **Brand campaign.** A campaign is brand when its name matches any brand term with non-alphanumeric boundaries, case-insensitive: for each term, `re.search(r"(^|[^A-Za-z0-9])" + re.escape(term.strip()) + r"([^A-Za-z0-9]|$)", name, re.I)`. Skip rows from brand campaigns.
3. **Brand query.** A search term is brand when it matches `re.compile(r"\b(" + "|".join(re.escape(t.strip()) for t in terms if t.strip()) + r")\b", re.I)`. Skip non-brand terms.
4. Skip rows with an empty account, term or campaign name. Group the remaining rows by `(customer_id, campaign name, search term)`; keep the ad group name from the first row; sum spend, clicks, conversions, conversion value.
5. Leaks: groups with clicks ≥ `minLeakedClicks`. Sort by spend, highest first.
6. Totals: leaked spend, leaked clicks, distinct campaigns, distinct accounts.

**Result**

- **warn:** at least one leak. — **ok:** otherwise.
- **unknown:** shared rule, or `brand_terms` is not set ("Missing brand terms: add `brand_terms` to `ads/google/index.md` to enable brand-leak detection").
- **Report:** "N brand queries hit C non-brand Search campaigns across A accounts: about X clicks and Y of spend in the last 30 days. Brand traffic should live in a dedicated brand campaign so non-brand performance reads cleanly and bidding strategies don't learn on cheap brand conversions." Table: account, search term, campaign, ad group, spend, clicks, conversions (1 decimal). Cap 30. Say how many brand terms were used.
- **Action:** For each leak: (a) confirm a dedicated brand Search campaign exists (create one if not); (b) add the brand term as an exact-match (or phrase-match where appropriate) negative on the non-brand campaign, at campaign level, not only ad-group level; (c) re-check next week. Goal is zero leaks.

## N-gram waste

- **ID:** `n-gram-analysis`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No recurring word or two-word phrase in your search terms is responsible for a meaningful slice of zero-conversion spend. What's left after stop words and short tokens are the words an experienced account manager would already have negated. Run weekly and add the top offenders as phrase or exact negatives.
- **Settings:** `minCost` = 50 (aggregated 30-day cost an n-gram needs before it's flagged); `minTermFrequency` = 5 (minimum number of search-term rows the n-gram appears in; values below 1 become 1).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  ad_group.id,
  search_term_view.search_term,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.status = 'ENABLED'
```

No channel filter. `campaign.id` and `ad_group.id` are selected only so per-day rows can be summed back to one row per term per ad group; the engine's unit is that row.

**Analyse with Python**

1. Sum to one row per `(customer_id, campaign.id, ad_group.id, search_term)`. Drop empty terms.
2. Tokenise each term: lower-case; replace every character that isn't a letter, digit, whitespace, `'` or `-` with a space (`re.sub(r"[^\w\s'-]|_", " ", text.lower())`); split on whitespace; drop tokens of length 1 or less and the stop words `a, an, the, and, or, of, for, to, in, on, at, by, is, are, with, from, as, it, be`.
3. Unigrams = the distinct tokens. Bigrams = each pair of adjacent tokens in the filtered token list (`"tok_i tok_i+1"`), deduplicated within the term.
4. For each `(customer_id, size, ngram)`, add the row's full cost, clicks and conversions and add 1 to term frequency. A row contributes to every distinct n-gram it contains, and the same text in two ad groups counts twice.
5. Offenders: cost ≥ `minCost`, conversions exactly 0, term frequency ≥ `minTermFrequency`. Sort by cost, highest first.

**Result**

- **warn:** at least one offending n-gram. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N unigrams and bigrams appear in `minTermFrequency`+ search terms with `minCost`+ aggregated 30-day spend and zero conversions: roughly X in total. A single phrase-match negative on each often removes more waste than handpicking individual terms." Table: account, n-gram, size (1-gram or 2-gram), cost, clicks, term frequency. Cap 30. Note that one high-volume term can lift several n-grams at once; the frequency floor is what stops one outlier from inventing a pattern.
- **Action:** Review each n-gram. For ones that are clearly off-intent (for example `free`, `cheap`, `crack`, a competitor's brand) add a phrase or exact negative, usually phrase. For ambiguous ones (a generic verb that is sometimes valid) handle them per term with `search-terms-waste` instead.

## Negative keyword conflicts

- **ID:** `negative-keyword-conflicts`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No active positive keyword is completely blocked by a negative in the same ad group or campaign. The classic mistake is adding a defensive negative ("free", "jobs") and forgetting that a recently added positive contains it: the positive stays enabled but never serves. Run this with every negative-list update.
- **Settings:** none.

**Queries**

Query A, positive keywords:

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

Query B, ad-group negatives:

```sql
SELECT
  campaign.id,
  ad_group.id,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = TRUE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

Query C, campaign negatives:

```sql
SELECT
  campaign.id,
  campaign_criterion.criterion_id,
  campaign_criterion.keyword.text,
  campaign_criterion.keyword.match_type
FROM campaign_criterion
WHERE campaign_criterion.type = 'KEYWORD'
  AND campaign_criterion.negative = TRUE
  AND campaign.status = 'ENABLED'
```

Shared negative lists are not checked (same as the engine).

**Analyse with Python**

1. Keep only rows whose match type is `EXACT`, `PHRASE` or `BROAD`. Normalise text: lower-case, replace characters other than letters, digits, whitespace, `'` and `-` with a space, trim, collapse runs of spaces. Tokens = the normalised text split on spaces.
2. Index Query B negatives by `(customer_id, ad_group.id)` and Query C negatives by `(customer_id, campaign.id)`.
3. For each positive, check its ad-group negatives first, then its campaign negatives, and stop at the first negative that blocks it (one conflict per positive). A negative blocks a positive when:
   - **EXACT negative:** the positive is EXACT and the normalised texts are identical. Never for PHRASE or BROAD positives.
   - **PHRASE negative:** the normalised texts are identical (any positive match type), or the positive is EXACT or PHRASE and its normalised text contains the negative's normalised text as a substring (plain string containment, as in the engine).
   - **BROAD negative:** the negative has at least one token, the positive is EXACT or PHRASE, and every negative token is in the positive's token set. BROAD positives are never flagged against BROAD negatives (too many false positives).

**Result**

- **warn:** at least one conflict. — **ok:** otherwise.
- **unknown:** all three queries fail on every account with no rows.
- **Report:** "N active positive keywords are fully blocked by an ad-group or campaign-level negative: they're enabled, but every query they could match is excluded by a negative in the same scope." Table: account, campaign, ad group, positive text, positive match type, blocked by (negative text), negative match type, scope (AD_GROUP or CAMPAIGN). Cap 30.
- **Action:** For each row decide: (a) the negative is right and the positive is the mistake, so pause or remove the positive; or (b) the positive is right and the negative is too broad, so tighten the negative (often by switching from broad to phrase, or narrowing its words).

## High CPC outliers

- **ID:** `high-cpc-outliers`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** No active keyword's CPC sits well above the rest of its ad group without converting. When an outlier converts, the bidder is doing its job; when it doesn't, it's paying premium prices for traffic that never pays back.
- **Settings:** `madThreshold` = 2.5 (how many MADs above the ad group's median CPC a keyword must be; minimum 0.1); `minClicks` = 20 (skip keywords below this click count; minimum 1).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.name,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  metrics.average_cpc,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions
FROM keyword_view
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Sum to one row per `(customer_id, ad_group.id, criterion_id)`: cost (`cost_micros / 1e6`), clicks, conversions. CPC = cost / clicks (this equals `metrics.average_cpc / 1e6` over the window; 0 when clicks are 0).
2. Per `(customer_id, ad_group.id)`, take the CPCs of keywords with clicks > 0 and CPC > 0. Skip the ad group when fewer than 3 keywords qualify.
3. Median = middle value (mean of the two middle values for an even count). MAD = median of `|cpc - median|`. Skip the ad group when median ≤ 0 or MAD ≤ 0 (no spread to flag against).
4. Cutoff = median + `madThreshold` × MAD. Flag every keyword in the ad group with clicks ≥ `minClicks`, conversions exactly 0 and CPC > cutoff. MADs above median = (CPC − median) / MAD, 1 decimal.
5. Sort offenders by cost, highest first.

**Result**

- **warn:** at least one offender. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N keywords paid CPCs far above their ad group's normal range over 30 days with zero conversions: about X of premium-priced traffic that didn't pay back." Table: account, campaign, ad group, keyword, match type, average CPC, median CPC, MADs above median, clicks, cost. Cap 30.
- **Action:** Check the search terms for each keyword. Off-intent queries become negatives and the match type gets tightened. On-intent queries that don't convert mean the problem is downstream (landing page, value proposition): pause the keyword while you fix it, or lower its bid cap on a bid-based strategy.

## Search Partner ROAS

- **ID:** `search-partner-roas`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** On every Search campaign with Search Partners enabled, partner CPA stays within 20% of Google Search CPA. When partner CPA is materially worse (often 50%+ on accounts that haven't audited it), the lift is negative and partners should be turned off.
- **Settings:** `minPartnerClicks` = 50 (skip campaigns where partners produced fewer clicks; minimum 1); `maxRatio` = 1.2 (flag when partner CPA exceeds Google CPA by more than this multiple; minimum 1).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  segments.ad_network_type,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND campaign.network_settings.target_search_network = TRUE
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. A row is partner traffic when `segments.ad_network_type` (upper-cased) is `SEARCH_PARTNERS`; every other value counts as Google Search.
2. Per `(customer_id, campaign.id)` sum partner cost, partner clicks, partner conversions, Google cost and Google conversions.
3. Skip campaigns with partner clicks < `minPartnerClicks`. Partner CPA = partner cost / partner conversions; Google CPA = Google cost / Google conversions. Skip when either side has 0 conversions.
4. Ratio = partner CPA / Google CPA. Flag when ratio > `maxRatio`. Sort by ratio, highest first.

**Result**

- **warn:** at least one flagged campaign. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N Search campaigns have Search Partners CPA more than `maxRatio`× Google Search CPA over 30 days: about X of partner spend converting worse than Google itself." Table: account, campaign, partner CPA, Google CPA, ratio (2 decimals), partner spend. Cap 20.
- **Action:** In each campaign's Settings, Networks, uncheck "Include Google search partners". To keep partners on, lower a portfolio bid cap to hold partner CPC down, or accept the worse CPA as the cost of extra reach. Re-check monthly; partner performance shifts.

## Ad group underperformers

- **ID:** `ad-group-underperformer`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each ad group either converts near the account-average CPA or hasn't yet spent past the threshold.
- **Settings:** `cpaMultiplier` = 2 (flag ad groups whose CPA is above this × account average; minimum 1); `zeroConvMinSpend` = 50 (flag ad groups with 0 conversions and at least this spend; 0 disables the zero-conversion test).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.status,
  ad_group.id,
  ad_group.name,
  metrics.cost_micros,
  metrics.conversions
FROM ad_group
WHERE ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

No channel filter: the engine evaluates enabled ad groups of every campaign type, and the account average includes them all.

**Analyse with Python**

1. Per `(customer_id, ad_group.id)` sum spend and conversions. Per `customer_id` sum spend and conversions over all ad groups; account CPA = spend / conversions (none when conversions are 0).
2. For each ad group, first test zero conversions: conversions exactly 0, `zeroConvMinSpend` > 0 and spend ≥ `zeroConvMinSpend` → zero-conversion offender (reason "spend X / 0 conversions"). If it matched, don't test it further.
3. Otherwise test high CPA: ad group CPA = spend / conversions exists, account CPA exists, CPA > account CPA × `cpaMultiplier` and spend > `zeroConvMinSpend` → high-CPA offender (reason "CPA X > `cpaMultiplier`× account avg Y").
4. Sort both lists by spend, highest first.

**Result**

- **fail:** at least one zero-conversion offender. — **warn:** at least one high-CPA offender. — **ok:** neither. Both can appear; the status is the worse.
- **unknown:** shared rule.
- **Report (zero conversions):** "N ad groups spent at least `zeroConvMinSpend` in the last 30 days without a single conversion: about X in total." Table: account, ad group, campaign, spend. Cap 20.
- **Action (zero conversions):** Pause each ad group or diagnose it (broken landing page, mismatched creative, keywords with no clear intent). Move the budget to an ad group that is converting.
- **Report (high CPA):** "N ad groups pay more than `cpaMultiplier`× the account-average cost per conversion. They convert, but at a price that drags down overall efficiency." Table: account, ad group, campaign, spend, CPA. Cap 20.
- **Action (high CPA):** Tighten targeting (more specific keywords, better audiences), lift landing-page conversion rate, or reduce bids. If the ad group can't reach a reasonable CPA after 2 adjustments, consider pausing it.

## Account quality score

- **ID:** `quality-score`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Account-level impression-weighted Quality Score is 7 or above, and none of the three components (Ad relevance, Landing page experience, Expected CTR) is BELOW_AVERAGE on more than a fifth of impressions. Higher QS lowers CPC and lifts Ad Rank; it's a free efficiency lever once you know which component to fix.
- **Settings:** `minAccountWeightedQs` = 7 (flag accounts whose impression-weighted QS is below this); `maxBelowAvgPct` = 20 (flag a component when more than this percentage of impressions show it as BELOW_AVERAGE).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.quality_info.quality_score,
  ad_group_criterion.quality_info.creative_quality_score,
  ad_group_criterion.quality_info.post_click_quality_score,
  ad_group_criterion.quality_info.search_predicted_ctr,
  metrics.impressions,
  metrics.cost_micros
FROM keyword_view
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Sum impressions per `(customer_id, ad_group.id, criterion_id)` and keep the quality fields (they are current values, not per-day).
2. **Per account:** over keywords with a non-null quality score and impressions > 0, weighted QS = Σ(QS × impressions) / Σ impressions. Skip accounts where that impression sum is 0. Flag accounts with weighted QS < `minAccountWeightedQs`. Also record active keywords (keywords with a non-null QS) and the impression sum. Sort flagged accounts by weighted QS, lowest first.
3. **Per component, across all accounts together:** for keywords with impressions > 0, for each component (`creative_quality_score` = Ad relevance, `post_click_quality_score` = Landing page experience, `search_predicted_ctr` = Expected CTR) skip empty, `UNSPECIFIED` and `UNKNOWN` values; add impressions to the component total, and to its below-average total when the value is `BELOW_AVERAGE`. Below-average % = below / total × 100 (skip the component when the total is 0). Flag components with % > `maxBelowAvgPct`, sorted highest first.

**Result**

- **warn:** at least one flagged account, or at least one flagged component (two observations, can co-occur). — **ok:** otherwise.
- **unknown:** shared rule.
- **Report (accounts):** "N accounts have an impression-weighted Quality Score below `minAccountWeightedQs`. Lower QS means higher CPC for the same Ad Rank." Table: account, weighted QS (1 decimal), active keywords, impressions. Cap 20.
- **Action (accounts):** Sort the keywords by impressions × (10 − QS): that surfaces the keywords whose QS lift would have the biggest CPC impact. Read the component diagnostics on each and address the weakest lever.
- **Report (components):** "N of 3 Quality Score components show BELOW_AVERAGE on more than `maxBelowAvgPct`% of impressions: Ad relevance (X%), ..." Table: component, below-average % (1 decimal), fix.
- **Action (components):** one line per flagged component. Ad relevance: tighten ad copy to match the keyword's intent, pinning headlines to the search term where appropriate. Landing page experience: improve the landing page's content match, mobile speed and trust signals (Core Web Vitals matter here). Expected CTR: rewrite the ad to lift CTR with a clearer value proposition, a stronger call to action and more relevant headlines.

## Lin–Rodnitzky efficiency ratio

- **ID:** `lin-rodnitzky-ratio`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** The L/R ratio sits between 1.5 and 2.0: the account balances proven winners with enough room for discovery. Below 1.5 it's too conservative (missed growth on new search terms); 2.0 to 2.5 means too much budget leaks onto non-converting queries; above 2.5 the account needs a serious negatives sweep.
- **Settings:** `minTotalConversions` = 30 (skip accounts with fewer total search-term conversions in the window; the ratio is too noisy below this). Bands, fixed: < 1.5 too conservative, 1.5 to < 2.0 well-managed, 2.0 to < 2.5 too aggressive, ≥ 2.5 mismanaged.

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  ad_group.id,
  search_term_view.search_term,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.status = 'ENABLED'
```

No channel filter. `campaign.id` and `ad_group.id` keep the engine's row unit (one search term in one ad group).

**Analyse with Python**

1. Sum to one row per `(customer_id, campaign.id, ad_group.id, search_term)`.
2. Per account: total cost and conversions over all rows; converting cost and conversions over rows with conversions ≥ 1; term count = number of rows.
3. Skip accounts with total conversions < `minTotalConversions` or converting conversions ≤ 0. Total CPA = total cost / total conversions; converting CPA = converting cost / converting conversions; skip when converting CPA ≤ 0. Ratio = total CPA / converting CPA (2 decimals). Converting share = converting cost / total cost × 100 (0 decimals).
4. Sort accounts by ratio, highest first. Label each with its band.

**Result**

- **warn:** any account with ratio ≥ 2.5. — **opportunity:** an account with ratio 2.0 to < 2.5 (and none ≥ 2.5), or any account with ratio < 1.5. — **ok:** every measured account is 1.5 to < 2.0 (report it as an info observation with the numbers), or no account passes the conversion floor.
- **unknown:** shared rule.
- **Report (above band):** "N accounts have an L/R ratio above 2.0: average CPA across all search terms is more than 2× the CPA of converting terms. Above 2.5 the account is clearly spending on terms that never convert." Table: account, ratio, band, total cost, converting cost, converting share %, term count. Cap 20. Print the worst ratio.
- **Action (above band):** Run the `search-terms-waste` check and add the highest-cost zero-conversion terms as negatives. Re-measure in 2 weeks; the ratio should fall.
- **Report (below band):** "N accounts have an L/R ratio below 1.5: the account is too conservative. Match types are over-pinned, broad match is off, or negatives are over-pruned; few fresh search terms enter the converting set." Same table. Print the lowest ratio.
- **Action (below band):** In the Search terms report, look for new or promising terms; relax pinning or remove a too-aggressive negative if something obvious shows up.
- **Report (healthy):** "All N measured accounts sit between 1.5 and 2.0; no intervention needed." Same table.

## Close variant drift

- **ID:** `close-variant-drift`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Ad groups with exact-match keywords stay under 30% close-variant impression share. Above that, exact keywords are behaving like phrase match without per-phrase bid control: tighten with negatives or reclassify the keywords as phrase match.
- **Settings:** `maxCloseVariantPct` = 30 (flag ad groups where more than this percent of impressions came from search terms that match no exact keyword); `minImpressions` = 100 (skip ad groups below this impression floor; minimum 1).

**Queries**

Query A, exact keywords (no date range):

```sql
SELECT
  customer.descriptive_name,
  campaign.name,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

Query B, search terms, last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  campaign.name,
  ad_group.id,
  ad_group.name,
  search_term_view.search_term,
  metrics.impressions,
  metrics.clicks,
  metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

`ad_group_criterion` fields can't be selected from `search_term_view`, so the two are linked on `(customer_id, ad_group.id)`.

**Analyse with Python**

1. Normalise text: lower-case, replace characters other than letters, digits, whitespace, `'` and `-` with a space, trim, collapse spaces.
2. Per `(customer_id, ad_group.id)`, build the set of normalised texts of its `EXACT` keywords (skip empty text).
3. For each Query B row whose ad group has a non-empty exact set: add impressions to the ad group total, and to close-variant impressions when the normalised search term is not in the set. Ad groups without exact keywords are ignored.
4. Keep ad groups with total impressions ≥ `minImpressions`. Close-variant % = round(close-variant / total × 100) to a whole number; flag when it is > `maxCloseVariantPct`. Sort by that %, highest first.

**Result**

- **opportunity:** at least one flagged ad group. — **ok:** otherwise.
- **unknown:** both queries fail on every account with no rows.
- **Report:** "N ad groups with exact keywords have more than `maxCloseVariantPct`% of impressions from non-matching search terms; the keywords are behaving more like phrase match." Table: account, campaign, ad group, impressions, close-variant %. Cap 30. Print the worst %.
- **Action:** Review each ad group's close-variant search terms. Accept valid variants (typos, plurals, slight reorderings). Add off-intent variants as exact-match negatives. If a pattern emerges, switch the keywords to phrase match deliberately so the bidding semantics match what's happening.

## Ad group scale candidates

- **ID:** `ad-group-scale-candidate`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Efficient ad groups (CPA at or below account average) aren't capped by low impression share.
- **Settings:** `maxSearchImpressionShare` = 0.65 (only flag ad groups with search impression share below this, 0 to 1); `cpaMultiplier` = 1.0 (ad group CPA must be at or below this × account average; minimum 0.01); `minSpend` = 50 (ignore ad groups with less 30-day spend, account currency).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.status,
  ad_group.id,
  ad_group.name,
  metrics.cost_micros,
  metrics.conversions,
  metrics.search_impression_share
FROM ad_group
WHERE ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per `(customer_id, ad_group.id)` sum spend and conversions and collect the non-null `metrics.search_impression_share` values (a fraction 0 to 1). Per account sum spend and conversions over all Search ad groups; account CPA = spend / conversions.
2. Qualified ad groups: spend ≥ `minSpend`, conversions > 0, at least one impression-share value.
3. For each qualified ad group: CPA = spend / conversions. Skip when the account CPA is missing or CPA > account CPA × `cpaMultiplier`. Impression share = mean of its collected values (one value when rows are already summed over the window). Skip when impression share ≥ `maxSearchImpressionShare`.
4. Sort candidates by CPA, lowest first. Format money with 2 decimals below 100 and none from 100 up.

**Result**

- **opportunity:** at least one candidate. — **ok:** qualified ad groups exist but none is a candidate.
- **unknown:** shared rule; or no rows at all ("Checked N accounts and found no Search ad groups with activity in the last 30 days. This check only evaluates Search campaigns; accounts running only PMax, Shopping or Display won't show results here."); or rows exist but no ad group qualifies ("Found N Search ad groups, but none had enough recent data (at least `minSpend` spend, at least 1 conversion, reported impression share) to evaluate scaling headroom.").
- **Report:** "N Search ad groups convert at or below your average cost per conversion but show only `maxSearchImpressionShare` of the time or less. Raising budgets or bids would capture more volume at the same efficiency." Table: account, campaign, ad group, impression share (whole %), CPA, account average CPA, 30-day spend, conversions (1 decimal). Cap 20.
- **Action:** Raise the campaign budget or the ad group's bids (or raise the target CPA on Smart Bidding). Start with the lowest CPA: those have the most room to grow before diminishing returns.

## Audience targeting mode

- **ID:** `audience-targeting-mode`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Search ad groups with audiences attached use Observation mode, so audiences act as bid signals, not impression restrictions.
- **Settings:** none.

**Queries**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name,
  ad_group.targeting_setting.target_restrictions
FROM ad_group
WHERE ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. `target_restrictions` is a list of objects with a targeting dimension and a bid-only flag. Depending on the MCP it arrives as a list, a JSON string, or with camelCase keys (`targetingDimension`, `bidOnly`); handle all three, and treat anything unparseable as an empty list.
2. Flag ad groups with any restriction whose dimension (upper-cased) is `AUDIENCE` and whose bid-only flag is false. Proto JSON often omits a false boolean, so treat a missing bid-only flag on an AUDIENCE restriction as false (Targeting).

**Result**

- **warn:** at least one flagged ad group. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N active Search ad groups have audiences set to Targeting instead of Observation. Ads only serve to people in those audience lists; every other searcher is excluded." Table: account, campaign, ad group. Cap 50.
- **Action:** In each ad group's audience settings, edit the targeting setting and switch the audience dimension to Observation. Audiences then act as bid signals without restricting reach.

## Keyword cannibalisation

- **ID:** `keyword-cannibalisation`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each keyword sits in exactly one campaign so campaigns don't bid against each other.
- **Settings:** `maxOffending` = 0 (pass if duplicated keywords are at or below this count).

**Queries**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign.status,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. Skip rows with empty text. Key each row by `(customer_id, match type upper-cased, keyword text lower-cased)`. Cannibalisation is within one account only.
2. A key is duplicated when it appears in more than one distinct `campaign.id`. The same keyword in two ad groups of one campaign is not flagged.
3. Count unique keys, duplicated keys, and the distinct campaign names involved.

**Result**

- **warn:** duplicated keys > `maxOffending`. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N keywords sit in 2 or more Search campaigns with the same match type. Those campaigns bid against each other for the same search: you pay a higher CPC for clicks you would have got anyway, and Smart Bidding can't tell which campaign should own the conversion." Table: account, keyword, match type, campaigns (joined with " / "). Cap 20. Print unique keywords, duplicated keywords, affected campaigns.
- **Action:** Pick one campaign to own each duplicated keyword (usually the one with better historical performance) and pause or remove it from the others. Add it as a negative in the losing campaigns if you want a clean exclusion.

## Match type balance

- **ID:** `match-type-strategy`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each Search ad group has at least 1 exact or phrase keyword anchoring it. Pure broad-only loses intent control.
- **Settings:** `requireExactOrPhrase` = true (flag ad groups with no exact or phrase keywords at all); `maxBroadShare` = 1 (flag when broad / total keywords exceeds this fraction; 1 disables it, and in the engine a value of 0 also behaves as 1); `maxOffending` = 0 (pass if offending ad groups are at or below this count).

**Queries**

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign.status,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.keyword.match_type,
  ad_group_criterion.status
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. Per `(customer_id, ad_group.id)` count exact, phrase, broad and total keywords (total includes any other match type).
2. Reasons: `requireExactOrPhrase` and exact + phrase = 0 and broad > 0 → "no EXACT/PHRASE"; total > 0 and broad / total > `maxBroadShare` → "BROAD share X > max". An ad group with any reason is offending.

**Result**

- **warn:** offending ad groups > `maxOffending`. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N of M Search ad groups rely entirely on broad-match keywords or exceed your broad-share limit. Broad alone matches any loosely related search and tends to spend widely without converting as tightly." Table: account, ad group, campaign, broad, phrase, exact, reasons. Cap 20.
- **Action:** Add the top-converting searches from the Search terms report as exact-match keywords in each ad group. Keep broad match for discovery, but anchor every ad group with at least a few exact or phrase keywords you know work.

## Keyword status warnings

- **ID:** `kw-status-warnings`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each active keyword is approved and serving: no rarely served, low search volume, low Quality Score or below first page bid statuses.
- **Settings:** `maxOffending` = 0 (pass if warning keywords are at or below this count).

**Queries**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.name,
  campaign.status,
  ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.system_serving_status,
  ad_group_criterion.approval_status,
  ad_group_criterion.quality_info.quality_score,
  ad_group_criterion.position_estimates.first_page_cpc_micros,
  ad_group_criterion.effective_cpc_bid_micros
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. Offending keywords: `system_serving_status` (upper-cased) in `RARELY_SERVED`, `LOW_SEARCH_VOLUME`, `LOW_QUALITY_SCORE`, `BELOW_FIRST_PAGE_BID`, or `approval_status` = `DISAPPROVED`.
2. Split them: disapproved (approval status `DISAPPROVED`) and barely serving (the rest).
3. Current bid = `effective_cpc_bid_micros / 1e6`; first-page bid = `first_page_cpc_micros / 1e6` ("—" when 0 or missing).

**Result**

- Only when the total offending count > `maxOffending`: **fail** if any disapproved keyword; **warn** if any barely-serving keyword (both can appear; status is the worse). — **ok:** otherwise.
- **unknown:** shared rule.
- **Report (disapproved):** "N keywords are disapproved and can't serve at all, usually for a policy reason (restricted terms, trademark, or a landing-page issue)." Table: account, keyword, campaign, ad group. Cap 20.
- **Action (disapproved):** Open each keyword, read the policy reason, and either fix the underlying issue (rewrite the ad, update the landing page) or replace the keyword with a compliant variation.
- **Report (barely serving):** "N keywords are marked rarely served, low search volume, low Quality Score or below first page bid: they're in the account but aren't triggering ads in practice." Table: account, keyword, reason (serving status), QS, current bid, first-page bid, campaign, ad group. Cap 20.
- **Action (barely serving):** Pause the obvious low-volume ones, fix low QS by improving ad relevance, or raise bids on below-first-page-bid keywords that still have potential.

## Low quality keywords

- **ID:** `kw-quality-score-low`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Most keywords rate at least 5/10 in Quality Score; low-QS keywords cost more and serve less. When a keyword is dragged down, you know which component (ad relevance, landing page, expected CTR) is the bottleneck.
- **Settings:** `minQualityScore` = 5 (flag keywords below this, clamped to 1 to 10); `maxOffending` = 0 (pass if low-QS keywords are at or below this count).

**Queries**

```sql
SELECT
  customer.descriptive_name,
  campaign.name,
  campaign.status,
  ad_group.name,
  ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text,
  ad_group_criterion.quality_info.quality_score,
  ad_group_criterion.quality_info.creative_quality_score,
  ad_group_criterion.quality_info.post_click_quality_score,
  ad_group_criterion.quality_info.search_predicted_ctr,
  ad_group_criterion.system_serving_status
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

No channel filter (as in the engine); in practice only Search keywords carry a Quality Score.

**Analyse with Python**

1. Skip keywords with a null Quality Score. Missing component or serving-status values become `UNKNOWN`.
2. Dragging dimension: collect which of `creative_quality_score` (ad-relevance), `post_click_quality_score` (landing-page) and `search_predicted_ctr` (expected-ctr) equal `BELOW_AVERAGE`. None → `unknown`; one → that one; two or three → `multiple`.
3. Offending: QS < `minQualityScore`. Average QS = plain mean over all keywords with a QS (not impression-weighted).
4. Count offenders per dragging dimension. The dominant bucket is the largest of ad-relevance, landing-page, expected-ctr (ties keep that order); `multiple` and `unknown` never lead.

**Result**

- **warn:** offending count > `maxOffending`. — **ok:** otherwise.
- **unknown:** shared rule.
- **Report:** "N of M keywords score below `minQualityScore`/10. Account-average QS is X/10. Of those, A are dragged by ad relevance, B by landing-page experience, C by expected CTR, and D by more than one dimension." (Omit the second sentence when A + B + C + D is 0.) Table: account, keyword, QS, ad relevance, landing page, expected CTR, dragging, serving status, ad group, campaign. Cap 20.
- **Action:** "Start with the largest bucket, `<dominant>` (n keywords), and ..." followed by the bucket's fix: ad-relevance, rewrite ad copy to echo the keyword more directly; landing-page, improve the landing page (mobile speed, clarity, content match); expected-ctr, raise CTR with tighter ad-to-keyword pairing or stronger headlines. Each row carries its dragging dimension so the work goes to the right team (creative, landing page, or bids and CTR).

## Negative keyword coverage

- **ID:** `negative-kw-coverage`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each campaign has negative keywords blocking irrelevant queries (competitors, jobs, "free", "how to").
- **Settings:** `minPerCampaign` = 1 (campaign-level negative keywords plus attached shared sets, each shared set counting as 1); `requireSharedSet` = false (when true, campaigns with no shared set attached are flagged regardless of their count).

**Queries**

Query A, campaigns in scope:

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING', 'PERFORMANCE_MAX')
```

Query B, campaign negative keywords:

```sql
SELECT
  campaign.id,
  campaign.status,
  campaign_criterion.negative,
  campaign_criterion.type,
  campaign_criterion.keyword.text
FROM campaign_criterion
WHERE campaign_criterion.negative = TRUE
  AND campaign_criterion.type = 'KEYWORD'
  AND campaign.status = 'ENABLED'
```

Query C, attached shared sets:

```sql
SELECT
  campaign.id,
  campaign.status,
  campaign_shared_set.shared_set,
  campaign_shared_set.status
FROM campaign_shared_set
WHERE campaign_shared_set.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

Query C counts every attached shared set, whatever its type, as the engine did.

**Analyse with Python**

1. Count Query B rows per `(customer_id, campaign.id)` (negatives) and Query C rows per `(customer_id, campaign.id)` (shared sets).
2. For each Query A campaign: reasons are "total<`minPerCampaign`" when negatives + shared sets < `minPerCampaign`, and "no shared set" when `requireSharedSet` is true and shared sets = 0. Any reason makes it offending.
3. Context: average the campaign-level negative count over Query A campaigns whose negatives + shared sets ≥ `minPerCampaign` (rounded); total negatives = all Query B rows.

**Result**

- **warn:** at least one offending campaign. — **ok:** otherwise.
- **unknown:** all three queries fail on every account with no rows.
- **Report:** "N of M campaigns have fewer than `minPerCampaign` negative keywords (counting campaign-level negatives plus attached shared sets). Campaigns that do have negatives average X each." Table: account, campaign, negatives, shared sets. Cap 20. Print total negatives and covered campaigns "C of M".
- **Action:** Pull the Search terms report for each campaign and add the obvious irrelevant searches as negatives. An account-level shared negative list covers the common offenders (competitors, "free", "jobs"); per-campaign negatives handle the campaign's specifics.

## RLSA coverage

- **ID:** `rlsa-configured`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each Search campaign has at least 1 audience attached in observation mode (a remarketing or in-market list), which enables RLSA bid adjustments.
- **Settings:** `maxOffending` = 0 (pass if Search campaigns without audiences are at or below this count).

**Queries**

Query A, Search campaigns:

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

Query B, ad-group audience criteria:

```sql
SELECT
  campaign.id,
  campaign.status,
  ad_group.id,
  ad_group_criterion.type,
  ad_group_criterion.status,
  ad_group_criterion.user_list.user_list
FROM ad_group_criterion
WHERE ad_group_criterion.type IN ('USER_LIST', 'USER_INTEREST', 'CUSTOM_AUDIENCE')
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
```

**Analyse with Python**

1. The set of `(customer_id, campaign.id)` with at least one Query B row has audiences. Count Query B rows by type (`USER_LIST`, `USER_INTEREST`, `CUSTOM_AUDIENCE`).
2. Offending: Query A campaigns not in that set. The check looks only at ad-group-level audiences and doesn't test the mode; `audience-targeting-mode` covers Targeting versus Observation.

**Result**

- **opportunity:** offending campaigns > `maxOffending`. — **ok:** otherwise.
- **unknown:** both queries fail on every account with no rows.
- **Report:** "N of M Search campaigns have no audiences attached at all: you can't see how your most valuable segments (past buyers, site visitors) perform, and you can't bid higher for them." Table: account, campaign. Cap 20. Print total audience criteria, covered campaigns "C of M", and the count per type.
- **Action:** For each campaign, add your remarketing lists and relevant in-market audiences in Observation mode (not Targeting, which would restrict who sees the ads). Once data builds up, bid up for the segments that convert best.

## Ad group structure

- **ID:** `ad-group-structure`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Ad groups sit between roughly 5 and 30 keywords, themed tightly enough that one ad speaks to all of them. Too many keywords and ad relevance falls; too few with no impressions and the ad group is clutter.
- **Settings:** `maxKeywords` = 30 (more than this is flagged as too loosely themed); `minKeywords` = 5 (fewer than this, combined with low impressions, is flagged as over-fragmented); `lowImpressionThreshold` = 100 (30-day impressions below which a small ad group is flagged).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type,
  ad_group.id,
  ad_group.name,
  ad_group_criterion.criterion_id,
  metrics.impressions
FROM keyword_view
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.negative = FALSE
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type = 'SEARCH'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Skip rows missing the account, ad group or criterion ID. Per `(customer_id, ad_group.id)`: keyword count = distinct `criterion_id`; impressions = sum. Keywords with no rows in the window (the API may omit zero-activity rows) aren't counted, as in the engine.
2. Dilution: keyword count > `maxKeywords`. Otherwise fragmentation: keyword count < `minKeywords` and impressions < `lowImpressionThreshold`.
3. Sort dilution by keyword count, highest first; fragmentation by keyword count, lowest first.

**Result**

- **warn:** at least one diluted ad group. — **ok:** otherwise. Fragmented ad groups are an info observation: report them but they don't change the status.
- **unknown:** shared rule.
- **Report (dilution):** "N ad groups have more than `maxKeywords` enabled keywords. When one ad group covers too many themes, the ad copy can't speak to all of them; ad relevance drops and Quality Score follows." Table: account, campaign, ad group, keyword count, impressions. Cap 20.
- **Action (dilution):** Split the worst offenders into themed ad groups (or single-keyword ad groups for the highest-spend terms), match the ad copy to each theme, and re-check Quality Score in 2 to 3 weeks.
- **Report (fragmentation, info):** "N ad groups have fewer than `minKeywords` keywords and less than `lowImpressionThreshold` impressions over the last 30 days. They carry setup overhead (ads, negatives, bid strategy) without producing meaningful volume." Same table.
- **Action (fragmentation):** Decide whether each is a deliberate carve-out (high-value single-keyword groups, brand-only) or clutter. Merge the clutter into themed siblings; note the deliberate ones in the ad group name.
