# Account checks

These checks look at the whole account rather than one campaign type: every account in scope (from `ads/google/index.md`), and every enabled campaign unless an entry narrows it with `campaign.advertising_channel_type`. Shared setup for this file:

- **Accounts.** Run each query once per account in scope and add a `customer_id` column to every row (conventions section 1). Every query below also selects `customer.descriptive_name`; report accounts by that name.
- **Channel group.** Where an entry reports a `channel` column, derive it from `campaign.advertising_channel_type`: `SEARCH` campaigns become `SEARCH_BRANDED` when `campaign.name` contains any term from `brand_terms` in `ads/google/index.md` (case-insensitive, the term bounded by a non-alphanumeric character or the start/end of the name), otherwise `SEARCH_NONBRANDED`; any other type passes through unchanged (`PERFORMANCE_MAX`, `SHOPPING`, ...). With no `brand_terms`, every Search campaign is `SEARCH_NONBRANDED`.
- **Date windows.** "Last 30 days" means the 30 days ending yesterday; "last 7 days" the 7 days ending yesterday. A query that filters on `segments.date` without selecting it returns one row per entity summed over the window; a query that selects `segments.date` returns one row per entity per day. Either way, group and sum in Python before applying thresholds.
- **Status.** A check can raise several observations; its status is the worst of them (fail > warn > opportunity). An info-only result is **ok**. A check is **unknown** when its queries error on every account and return no rows; when only some accounts fail, run the logic on the rest and name the failed accounts.
- **Money.** Report spend in each account's own currency. When an entry sums spend across accounts, sum per currency.

## Disapproved ads

- **ID:** `disapproved-ads`
- **Category:** approvals · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Every active ad is APPROVED and serving at full reach.
- **Settings:** none.

**Queries**

Query A (non-healthy ads):

```sql
SELECT customer.descriptive_name, campaign.name, campaign.status,
  ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
  ad_group_ad.policy_summary.approval_status
FROM ad_group_ad
WHERE ad_group_ad.policy_summary.approval_status IN ('DISAPPROVED', 'APPROVED_LIMITED', 'AREA_OF_INTEREST_ONLY')
  AND ad_group_ad.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

Query B (all active ads, for the denominator):

```sql
SELECT customer.descriptive_name, campaign.status, ad_group_ad.ad.id
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED' AND campaign.status = 'ENABLED'
```

**Analyse with Python**

1. `total_ads` = row count of Query B across all accounts. `flagged` = row count of Query A.
2. Split Query A by `approval_status` into `DISAPPROVED`, `APPROVED_LIMITED` and `AREA_OF_INTEREST_ONLY`.
3. `approved_share` = `(total_ads - flagged) / total_ads * 100`, rounded to a whole percent; `100%` when `total_ads` is 0.

**Result**

- **fail:** at least one `DISAPPROVED` ad. — **warn:** at least one `APPROVED_LIMITED` ad. — **info (status ok):** `AREA_OF_INTEREST_ONLY` ads only. — **ok:** none of these.
- **unknown:** both queries error on every account with no rows.
- **Report:** one table per observation (account, campaign, ad group, ad ID, ad name, approval status), capped at 50 rows each, with `total_ads` and `approved_share`. Wording: "N of `total_ads` active ad(s) are `DISAPPROVED` and serving zero impressions: every click that would have gone through them is lost." / "N of `total_ads` active ad(s) are `APPROVED_LIMITED`: they're serving, but on a reduced surface (e.g. trademark, alcohol, or financial restrictions)." / "N ad(s) are `AREA_OF_INTEREST_ONLY`: they only serve to users interested in the targeted region, not users physically there. Usually fine, but worth knowing."
- **Action:** Disapproved: open each ad in Google Ads, read the policy reason, fix the underlying issue (landing page, copy, trademark), and request review. Limited: review the policy reason in Google Ads; either adjust creative to lift the restriction or accept the reduced delivery footprint.

## Smart Bidding cold start

- **ID:** `smart-bidding-cold-start`
- **Category:** bidding · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Every campaign on a Smart Bidding strategy is producing at least 30 conversions per month, the rough floor where Smart Bidding's learning model has enough signal to optimize. Below that, the algorithm is essentially guessing, and CPA/ROAS targets won't hold.
- **Settings:** `minConvForSmartBidding` = 30 (conversions in 30 days below which a Smart Bidding campaign is cold); `minSpend` = 100 (skip campaigns spending less than this in 30 days, account currency).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  campaign.bidding_strategy_type, metrics.cost_micros, metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by (`customer_id`, `campaign.id`); sum `cost = cost_micros / 1e6` and `conversions`. Derive `channel` (see top of file).
2. Keep campaigns where `bidding_strategy_type` (upper-cased) is in `TARGET_CPA`, `TARGET_ROAS`, `MAXIMIZE_CONVERSIONS`, `MAXIMIZE_CONVERSION_VALUE`, AND `conversions < 30`, AND `cost >= 100`.
3. Sort ascending by conversions. `spend_under_cold_smart_bidding` = sum of their cost, per currency.

**Result**

- **warn:** at least one campaign passes step 2. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, campaign, channel, bidding strategy, conversions (1 decimal), spend; capped at 20, plus the count and the summed spend. Wording: "N campaign(s) are on Smart Bidding with fewer than 30 conversions over the last 30 days. About X of monthly spend is being optimized by an algorithm that doesn't have enough signal: targets won't hold and CPA can swing widely week to week."
- **Action:** For each campaign decide: (1) raise budget and broaden targeting to get to 30 or more conversions per 30 days, (2) merge with a sibling campaign to pool conversions, or (3) drop to Maximize Clicks while volume is too low and revisit Smart Bidding once conversions land. Don't wait it out on Smart Bidding under 30 conversions a month: it doesn't learn at that volume. See `references/learning-phase-thresholds.md`.

## Mixed-motion bidding

- **ID:** `single-campaign-multi-motion-bidding`
- **Category:** bidding · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each account has a tight set of primary conversion actions: either one motion (e.g. all purchases) or a small set with comparable values. When primary goals span multiple categories (lead + purchase + signup) or default values vary widely, Smart Bidding treats them as fungible and CPA targets break.
- **Settings:** `minPrimaryGoals` = 2 (skip accounts with fewer primary-for-goal actions); `minDistinctCategories` = 3 (flag at this many distinct categories); `maxValueCv` = 1.0 (flag when the coefficient of variation of default values reaches this).

**Queries**

```sql
SELECT customer.descriptive_name, conversion_action.id, conversion_action.name,
  conversion_action.category, conversion_action.primary_for_goal,
  conversion_action.value_settings.default_value, conversion_action.status
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
  AND conversion_action.primary_for_goal = TRUE
```

**Analyse with Python**

1. Group rows by `customer_id`. Per account: `primary_goals` = row count; `categories` = set of non-empty `category` values; `values` = list of `default_value` where the value is > 0.
2. Skip accounts with `primary_goals < 2`.
3. CV of `values` = population standard deviation (`np.std(values, ddof=0)`) / mean; 0 when the list is empty or the mean is 0.
4. Flag when `len(categories) >= 3` OR (`len(values) >= 2` AND `cv >= 1.0`). Build a reason string: "K distinct categories" and/or "value CV x.xx".
5. Sort by distinct category count, descending.

**Result**

- **warn:** at least one account flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, primary goals, distinct categories, category list (sorted), value CV (2 decimals), reason, and up to 5 sample actions (name, category, default value); capped at 20 accounts. Wording: "N account(s) have multiple primary conversion actions spanning 3 or more categories or values that vary widely (CV ≥ 1.0). Smart Bidding sums these into a single optimization target: a high-value purchase counts the same as a low-value lead, so CPA targets become meaningless."
- **Action:** Pick the dominant motion (usually purchase or revenue) and demote the other primary goals to secondary. If both motions matter, split into separate campaigns with single-goal Smart Bidding strategies. Use Target ROAS with revenue values rather than Target CPA across mixed motions. See `references/value-elicitation.md`.

## Smart bidding readiness

- **ID:** `smart-bidding-readiness`
- **Category:** bidding · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Campaigns with about 30 or more conversions a month are on Target CPA, Target ROAS, or Maximize Conversions.
- **Settings:** `minConversionsLast30d` = 30 (conversions in 30 days that make a campaign ready, about 1 a day).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name,
  campaign.bidding_strategy_type, segments.date, metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by (`customer_id`, `campaign.id`); sum `conversions` over the daily rows. Take `bidding_strategy_type` upper-cased.
2. Keep campaigns whose strategy is `MANUAL_CPC`, `ENHANCED_CPC` or `MAXIMIZE_CLICKS` AND summed conversions `>= 30`.

**Result**

- **opportunity:** at least one campaign kept. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, campaign, bidding strategy, conversions (2 decimals); capped at 20. Wording: "N campaign(s) are still on manual bidding but have enough recent conversion volume (30 or more in the last 30 days) for Google's algorithm to learn from. Switching usually lifts efficiency because the bidder can react to real-time intent signals you can't see manually."
- **Action:** For each campaign, open Settings → Bidding in Google Ads and switch to Target CPA (if you know your target cost per conversion) or Maximize Conversions. Expect a 1–2 week learning period where performance fluctuates; don't revert in a hurry. See `references/smart-bidding-mechanics.md`.

## Conversion flow

- **ID:** `conversions-flowing`
- **Category:** conversions · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Each account logs conversions every day; quiet days usually mean tracking broke.
- **Settings:** `minConversions` = 1 (fail an account that recorded fewer conversions than this yesterday).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, segments.date,
  metrics.conversions, metrics.all_conversions
FROM customer
WHERE segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by (`customer_id`, `segments.date`); sum `conversions` and `all_conversions`.
2. `yesterday` = the latest date present across all accounts' rows; prior dates = every other date present.
3. Per account: yesterday's conversions and all_conversions (0 if the account has no row for that date); `avg30d` = sum of the account's conversions on prior dates / number of prior dates (0 when there are none), 1 decimal.
4. Flag accounts with yesterday's `conversions < 1`. This uses `metrics.conversions` (the actions that count toward Conversions), not `all_conversions`.

**Result**

- **fail:** at least one account flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, yesterday's conversions, yesterday's all conversions, prior daily average; plus the mean of `avg30d` across flagged accounts as "x.x/day". Wording: "N account(s) logged fewer than 1 conversion yesterday. This usually means tracking broke: the tag stopped firing, or it was removed in a recent site release." An account that returns no rows at all in the window has no data to judge; list it separately as having no activity.
- **Action:** Open each account's Goals → Conversions in Google Ads, check the status of each conversion action, and run a test conversion to confirm the tag fires. If the website changed recently, revert or re-add the Google Ads tag.

## Primary event quality

- **ID:** `primary-event-quality`
- **Category:** conversions · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** The primary conversion action is the deepest funnel event that fires with enough volume for Smart Bidding to learn from. For B2B self-serve that's activation, for B2B sales-led a CRM-qualified MQL, for B2C subscription the initial subscribe, for ecommerce purchase with dynamic value. Shallow events like signup and form-fill are tracked as secondaries for reporting, not fed to the bidder.
- **Settings:** none. Needs the business's go-to-market motion, one of `b2c-ecommerce`, `b2c-subscription`, `b2b-self-serve`, `b2b-sales-led`, `b2b-hybrid`. Read it from `wiki/company.md` (business type). If the file doesn't state it clearly and the user is present, ask which of the five fits and offer to record it there.

**Queries**

Query A (primary actions):

```sql
SELECT customer.descriptive_name, conversion_action.id, conversion_action.name,
  conversion_action.category, conversion_action.primary_for_goal,
  conversion_action.value_settings.default_value
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
  AND conversion_action.primary_for_goal = TRUE
```

Query B (biddable campaign goals). If it errors, carry on with no rows from it:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name,
  campaign.bidding_strategy_type, campaign_conversion_goal.category,
  campaign_conversion_goal.biddable
FROM campaign_conversion_goal
WHERE campaign.status = 'ENABLED'
  AND campaign_conversion_goal.biddable = TRUE
```

**Analyse with Python**

Lookup tables per motion (categories upper-case; name patterns are case-insensitive `re.search`):

| Motion | Vanity categories | Vanity name pattern (only for category `DEFAULT`) | Expected categories | Expected name pattern |
|---|---|---|---|---|
| b2b-self-serve | SIGNUP, SUBMIT_LEAD_FORM, PAGE_VIEW, CONTACT, GET_DIRECTIONS | `\b(sign.?up\|register\|registration\|form.?fill\|form.?submit\|page.?view\|contact\|newsletter)\b` | PURCHASE | `\b(activat\|first.?action\|workspace\|paid.?conv\|key.?action\|onboard)\b` |
| b2b-sales-led | SUBMIT_LEAD_FORM, CONTACT, PAGE_VIEW, SIGNUP, GET_DIRECTIONS | `\b(form.?fill\|form.?submit\|contact.?form\|page.?view\|sign.?up\|register\|newsletter)\b` | PURCHASE | `\b(mql\|qualified\|sql\|opportunity\|pipeline)\b` |
| b2c-subscription | SIGNUP, PAGE_VIEW, GET_DIRECTIONS | `\b(sign.?up\|register\|free.?trial\|page.?view)\b` | SUBSCRIBE, PURCHASE | `\b(subscri\|paid\|convert\|purchase)\b` |
| b2c-ecommerce | ADD_TO_CART, PAGE_VIEW, BEGIN_CHECKOUT, GET_DIRECTIONS, SIGNUP | `\b(add.?to.?cart\|page.?view\|begin.?checkout\|view.?item\|sign.?up)\b` | PURCHASE | `\b(purchase\|order\|transact\|buy\|sale\|checkout.?complete)\b` |
| b2b-hybrid | PAGE_VIEW, GET_DIRECTIONS | `\b(page.?view)\b` | PURCHASE | `\b(mql\|qualified\|paid.?conv\|activat\|purchase)\b` |

(In the patterns, `\|` is the table-escaped `|`.)

Expected-primary descriptions for the action text: b2b-self-serve "an activation event (workspace created, first key action), not signup"; b2b-sales-led "a CRM-qualified lead event (MQL), not a raw form fill"; b2c-subscription "an initial subscription event, not a free signup"; b2c-ecommerce "a purchase event with dynamic value"; b2b-hybrid "two parallel primaries (self-serve activation + sales-led MQL) with distinguishable values".

1. Classify each Query A row: **expected** if its category is in the motion's expected categories OR its name matches the expected name pattern; else **vanity** if its category is in the vanity categories OR (category is `DEFAULT` AND the name matches the vanity name pattern); else unknown. Expected wins over vanity.
2. `has_expected_primary` = any row classified expected, across all accounts in scope together (as the engine does).
3. From Query B keep rows whose `bidding_strategy_type` is `TARGET_CPA`, `TARGET_ROAS`, `MAXIMIZE_CONVERSIONS` or `MAXIMIZE_CONVERSION_VALUE` AND whose `campaign_conversion_goal.category` is in the motion's vanity categories.

**Result**

- **fail:** at least one primary action classified vanity. — **warn:** no expected primary while Query A has rows; or at least one campaign from step 3. — **ok:** otherwise.
- **unknown:** the motion can't be determined ("No go-to-market motion recorded in `wiki/company.md`, so this check can't judge whether the primary events match the business model"), or Query A errors on every account.
- **Report:** vanity actions: account, action name, category; capped at 20. No-expected-primary: up to 10 primary actions (account, name, category, default value). Vanity campaigns: account, campaign, bidding strategy, vanity category; capped at 20. Wording: "N primary conversion action(s) are shallow funnel events that shouldn't drive bidding for a <motion> product. Smart Bidding is optimising toward volume (signups, form fills) instead of business outcomes."; "None of the primary conversion actions match what a <motion> product should optimise toward: <description>."; "N campaign(s) use conversion-based bidding but have vanity conversion categories set as biddable goals."
- **Action:** Vanity actions: demote them to secondary (reporting-only) and set the primary to <description>, in Goals → Conversions. No expected primary: create or promote the right primary event for the motion, then mark it primary. Vanity campaigns: open each campaign → Settings → Goals, remove the vanity category from biddable goals, and keep only the proper primary event biddable. See `references/conversion-anti-patterns.md`.

## Tracking template setup

- **ID:** `tracking-template-sanity`
- **Category:** conversions · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Either no `tracking_url_template` is configured (the modern path is `final_url_suffix`), or every template contains `{lpurl}`, `{escapedlpurl}`, or `{unescapedlpurl}` so the final URL is substituted in.
- **Settings:** none.

**Queries**

Query A:

```sql
SELECT customer.descriptive_name, customer.tracking_url_template, customer.final_url_suffix
FROM customer
```

Query B:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name, campaign.tracking_url_template
FROM campaign
WHERE campaign.status = 'ENABLED'
```

**Analyse with Python**

1. Token pattern: `re.compile(r"\{lpurl\}|\{escapedlpurl\}|\{unescapedlpurl\}|\{lpurl\+\}", re.I)`.
2. Account issues: Query A rows where `tracking_url_template` is non-empty after stripping whitespace AND the pattern doesn't match.
3. Campaign issues: Query B rows with the same condition on `campaign.tracking_url_template`. Empty templates pass.

**Result**

- **fail:** any account issue, or any campaign issue (two separate observations). — **ok:** otherwise.
- **unknown:** both queries error on every account with no rows.
- **Report:** account issues: account, template (all rows). Campaign issues: account, campaign, template; capped at 50. Wording: "N accounts have an account-level tracking template without the final-URL substitution token: every click on every campaign in these accounts lands on the tracker URL instead of the landing page." / "N active campaigns have a campaign-level tracking template without an `{lpurl}` token: every click sends users to the tracker URL instead of the landing page."
- **Action:** Account level: in Admin → Account settings → Tracking, remove the template, or fix it to include `{lpurl}` (e.g. `https://tracker.example.com/?u={lpurl}`); if tracking has moved to `final_url_suffix`, clear the template entirely. Campaign level: open each campaign → Settings → Campaign URL options, add `{lpurl}` to the template, or clear it if a suffix on the campaign or account is doing the tracking.

## UTM tagging

- **ID:** `utm-tagging`
- **Category:** conversions · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Either auto-tagging is on and the only data destination is GA4 (Google passes the GCLID end to end), or every active campaign's effective `final_url_suffix` carries `utm_source`, `utm_medium` and `utm_campaign`, with `utm_campaign` set to the campaign name (or a close variant), never a raw `{campaignid}` macro. Without one of those two states, non-Google reporting tools (BI, CRM, attribution) lose the source of every paid click.
- **Settings:** none. Scope is the campaign-level suffix mechanism only; the ad-level and sitelink-level walk belongs to the `google-ads-check-utm-tagging` skill.

**Queries**

Query A:

```sql
SELECT customer.descriptive_name, customer.id, customer.auto_tagging_enabled,
  customer.final_url_suffix, customer.tracking_url_template
FROM customer
```

Query B, last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
  campaign.final_url_suffix, campaign.tracking_url_template, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per account from Query A: `auto_tagging` = `customer.auto_tagging_enabled is True` (a missing field means off); `customer_suffix` = `customer.final_url_suffix` or "".
2. Group Query B by (`customer_id`, `campaign.id`), summing `cost`. Derive `channel`.
3. Effective suffix = the campaign's `final_url_suffix` if non-empty after stripping, else the account's `customer_suffix`.
4. `has_param(s, key)` = `re.search(rf"(^|[?&]){key}=", s, re.I)`. `missing` = the keys among `utm_source`, `utm_medium`, `utm_campaign` that fail.
5. `is_macro(s)`: take the first `re.search(r"utm_campaign=([^&]*)", s, re.I)`, URL-decode the value (`urllib.parse.unquote`), lower-case it, and test whether it contains `{campaignid}`, `{campaign_id}` or `{campaignname}`.
6. Per campaign, in order:
   - effective suffix empty AND account auto-tagging off → **no tagging at all**; stop here for this campaign.
   - effective suffix non-empty AND `missing` non-empty → **missing core UTM**.
   - effective suffix non-empty AND `is_macro` → **macro utm_campaign** (a campaign can be in both of the last two).
   - effective suffix empty with auto-tagging on → passes.
7. Sum cost per bucket (per currency).

**Result**

- **fail:** any campaign with no tagging at all. — **warn:** any campaign missing core UTM parameters, or any macro `utm_campaign` (separate observations). — **ok:** otherwise.
- **unknown:** both queries error on every account with no rows.
- **Report:** per bucket: account, campaign, channel, effective suffix, missing keys, cost (30 days); capped at 20 each, with the count and summed spend. Wording: "N active campaign(s) (~X/30d) have no `final_url_suffix` at any level and auto-tagging is off: every click reaches the landing page with no source attribution at all." / "N active campaign(s) (~X/30d) have a `final_url_suffix`, but it's missing one or more of `utm_source`, `utm_medium`, `utm_campaign`. Reporting tools that read those see a blank or fall back to a default." / "N active campaign(s) set `utm_campaign` to a macro such as `{campaignid}`. Reports end up with rows like `utm_campaign=8459217301`, a numeric ID that can't be joined to a human-readable taxonomy."
- **Action:** No tagging: either turn on auto-tagging (Admin → Account settings → Auto-tagging), the simplest fix if GA4 is the only destination, or set a `final_url_suffix` at account or campaign level, starting with `utm_source=google&utm_medium=cpc&utm_campaign=<campaign name>`. Missing keys: extend each campaign's suffix (Settings → Campaign URL options) so all three keys are set; standard defaults `utm_source=google`, `utm_medium=cpc` (or `paid_search` / `pmax` / `display` to fit), `utm_campaign=<campaign name>` or the schema in `ads/taxonomy.md`. Macro: replace the macro with the campaign's name in the suffix; most teams want the campaign name, not the ID, in downstream reporting.

## Conversion action config

- **ID:** `conversion-action-health`
- **Category:** conversions · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Each conversion action records exactly what it should: leads count once per visitor, sales count every transaction, and the action the bidder optimizes toward is the one you report on. Enhanced Conversions is on for any account that takes leads or sells online, recovering the conversions iOS/Safari privacy strips out.
- **Settings:** `leadCategories` = `DEFAULT,SUBMIT_LEAD_FORM,SIGNUP,BOOK_APPOINTMENT,REQUEST_QUOTE,GET_DIRECTIONS,CONTACT` (categories that should count one per click; split on commas, strip, upper-case).

**Queries**

Query A (all actions):

```sql
SELECT customer.descriptive_name, conversion_action.id, conversion_action.name,
  conversion_action.status, conversion_action.type, conversion_action.category,
  conversion_action.counting_type, conversion_action.primary_for_goal,
  conversion_action.include_in_conversions_metric
FROM conversion_action
```

Query B:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled
FROM customer
```

Query C (which campaigns each action fired in), last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name,
  segments.conversion_action, metrics.all_conversions, metrics.all_conversions_value
FROM campaign
WHERE segments.date BETWEEN '<start>' AND '<end>'
  AND metrics.all_conversions > 0
```

Query D (campaign spend), same window:

```sql
SELECT customer.descriptive_name, campaign.id, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Upper-case `status`, `type`, `category`, `counting_type`; booleans default to False when missing.
2. Impact per action: from Query C take the action ID as the last `/` segment of `segments.conversion_action`; group by (`customer_id`, action ID): `conversions_30d` = sum of `all_conversions`, `value_30d` = sum of `all_conversions_value`, `campaigns` = set of `campaign.id`. From Query D, `cost` per (`customer_id`, `campaign.id`) = sum of `cost_micros / 1e6`. `spend_exposed` = sum of cost over the action's campaigns. `firing` = `conversions_30d > 0`, else `dormant`.
3. **Over-counting:** enabled actions with `category` in `leadCategories` AND `counting_type == "MANY_PER_CLICK"`. Attach conversions, spend exposed (with currency), dependent campaign count, firing/dormant. Sort firing first, then spend exposed descending.
4. **Multiple primaries:** enabled actions with `primary_for_goal`; group by (`customer_id`, `category`); keep groups with more than 1 action. Per group: the action names, the firing ones (or "(none firing)"), `firing_count`.
5. **Enhanced Conversions off:** per account, count enabled actions with category in `leadCategories`; flag accounts with a count > 0 where `enhanced_conversions_for_leads_enabled` is not True.
6. **Excluded from Conversions:** enabled actions with `include_in_conversions_metric` False. Same impact columns. Sort firing first, then conversions descending.
7. For steps 3 and 6, sum spend exposed of firing rows per currency.

**Result**

- **fail:** over-counting with at least one firing action. — **warn:** over-counting with all actions dormant; any multiple-primary group; any account with Enhanced Conversions off; excluded actions with at least one firing. — **opportunity:** excluded actions, all dormant. — **ok:** none of the four.
- **unknown:** Queries A and B error on every account with no rows.
- **Report:** one table per observation, capped at 20 rows: over-counting and excluded (account, action, category, counting type where relevant, conversions 30d, spend exposed, dependent campaigns, firing/dormant), multiple primaries (account, category, primary actions, firing action(s), firing count), Enhanced Conversions (account, lead action count). Wording: over-counting with firing: "F of N misconfigured lead-gen action(s) are actively firing across ~C campaign-action pair(s) (C = summed dependent campaigns of the firing rows); the bidder is optimizing toward inflated numbers on the live ones", plus "(D additional action(s) are misconfigured but dormant: no conversions in 30 days.)" when D > 0; all dormant: "N lead-gen conversion action(s) are misconfigured, but none have fired in 30 days: bookkeeping cleanup, not an active inflation problem." Multiple primaries: "N goal categories have more than one action marked primary. Smart Bidding optimizes for the sum of all primaries within a category, double-weighting whatever overlaps", plus "S of these have only one primary actually firing; the others are silent duplicates and can be demoted with no behaviour change" when S > 0. Enhanced Conversions: "N account(s) take lead-form conversions without Enhanced Conversions for Leads. It typically recovers 5–15% of lost conversions on iOS/Safari traffic." Excluded with firing: "F of N excluded action(s) are actively firing: Smart Bidding sees the spend but not the conversions" (plus the dormant count); all dormant: "N action(s) excluded from the Conversions column, but none are firing: likely deprecated actions that can be archived."
- **Action:** Over-counting: fix the firing actions first; in Goals → Conversions switch Count from "Every" to "One"; archive the dormant ones unless volume is imminent (all dormant: switch or archive, low urgency). Multiple primaries: start with categories where only one primary fires and demote the silent duplicates; for the rest, keep the action that best represents the goal (often the deepest funnel event) as primary and demote the others. Enhanced Conversions: accept the customer data terms and turn on Enhanced Conversions for Leads in Goals → Conversions → Settings, then make sure the conversion tag passes a hashed email. Excluded and firing: decide deliberately; if it should drive bidding, include it in Conversions (expect a 7–14 day learning reset); if it's a reporting-only signal leave it off, but confirm no campaign relies on it through a campaign-specific goal; archive the dormant ones. See `references/conversion-anti-patterns.md`.

## Auto-tagging disabled

- **ID:** `auto-tagging-disabled`
- **Category:** conversions · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Every account has auto-tagging on, so Google stamps a gclid on each ad click: the click ID needed to attribute a conversion down to the exact keyword or ad, not just the campaign.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name, customer.auto_tagging_enabled
FROM customer
```

**Analyse with Python**

1. Flag every row where `customer.auto_tagging_enabled` is not exactly `True`. The API omits false booleans, so a missing field means off, not unknown.

**Result**

- **opportunity:** at least one account flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account name (customer ID when the name is blank); capped at 20. Wording: "N account(s) have auto-tagging turned off. Without it Google doesn't add the gclid click ID to ad clicks, so conversions can only be tied back to the campaign, never the keyword or ad that drove them."
- **Action:** Turn auto-tagging on in Admin → Account settings → Auto-tagging. One-time switch, no downside.

## Asset type coverage

- **ID:** `asset-type-coverage`
- **Category:** creative · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Every campaign has at least 6 distinct asset types attached: sitelinks, callouts, structured snippets, call, image, logo, and business name. Each is free, lifts CTR, and gives Google more inventory to assemble ad formats.
- **Settings:** `requiredTypes` = `SITELINK,CALLOUT,STRUCTURED_SNIPPET,CALL,IMAGE,LOGO,BUSINESS_NAME` (field types that count toward coverage); `minDistinctTypes` = 6 (flag campaigns with fewer).

**Queries**

Query A:

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name, campaign.status,
  campaign.advertising_channel_type, campaign_asset.asset,
  campaign_asset.field_type, campaign_asset.status
FROM campaign_asset
WHERE campaign_asset.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING', 'PERFORMANCE_MAX')
```

Query B (campaigns in scope, so ones with no assets at all are counted):

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name, campaign.advertising_channel_type
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING', 'PERFORMANCE_MAX')
```

**Analyse with Python**

1. Per (`customer_id`, `campaign.id`) from Query A: the set of upper-cased `field_type` values that are in `requiredTypes`.
2. Left-join Query B onto it so campaigns without any enabled campaign asset get an empty set. Derive `channel`.
3. Flag campaigns where the set has fewer than 6 members. `missing` = required types not in the set. Sort by distinct count ascending.
4. This counts campaign-level assets only, as the engine does. Account-level assets also serve, so before recommending, glance at `customer_asset` for the missing types if the user asks why.

**Result**

- **warn:** at least one campaign flagged. — **ok:** otherwise.
- **unknown:** the queries error on every account.
- **Report:** account, campaign, channel, types present (or "(none)"), distinct count, missing types; capped at 50. Wording: "N campaigns have fewer than 6 distinct asset types. Each missing type is a CTR lever Google can't pull; sitelinks alone typically lift CTR 10–20% when added to a campaign that lacks them."
- **Action:** Add the missing types under Assets for each campaign. Start with sitelinks and callouts (cheapest wins). Image and logo assets unlock more inventory. Business name and call assets help on mobile.

## Ad rotation mode

- **ID:** `ad-rotation-mode`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Smart-bidding ad groups use Optimize rotation, so the bidder can favor the better creative per query. "Rotate indefinitely" stays for deliberate A/B tests only.
- **Settings:** none.

**Queries**

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name, campaign.bidding_strategy_type,
  ad_group.id, ad_group.name, ad_group.ad_rotation_mode
FROM ad_group
WHERE ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
```

**Analyse with Python**

1. Flag rows where upper-cased `ad_rotation_mode == "ROTATE_FOREVER"` AND `bidding_strategy_type` is in `TARGET_CPA`, `TARGET_ROAS`, `MAXIMIZE_CONVERSIONS`, `MAXIMIZE_CONVERSION_VALUE`.

**Result**

- **warn:** at least one ad group flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, campaign, ad group, rotation mode, bidding strategy; capped at 50. Wording: "N smart-bidding ad groups are set to Rotate indefinitely. The bidder can't favor the better creative: you're paying for machine learning you're not letting work."
- **Action:** Open each ad group → Settings → Ad rotation and switch to Optimize. Keep Rotate indefinitely only for deliberate A/B tests, and prefer Experiments so the rotation lives outside the production ad group.

## Landing page CVR outliers

- **ID:** `lp-conv-rate-outlier`
- **Category:** creative · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each page converts within range of the median; outliers below half the median signal a UX or match issue.
- **Settings:** `minClicks` = 100 (hosts with fewer clicks are ignored as noisy); `maxDropPct` = 50 (flag hosts whose CVR is this many percent or more below the median).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, campaign.status, ad_group_ad.ad.final_urls,
  metrics.clicks, metrics.conversions
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Per row take the first non-empty URL in `final_urls` (if it arrives as a JSON string, parse it; an unparseable string is the URL itself). Skip rows with no URL.
2. Key = the URL's hostname (`urllib.parse.urlparse(url).hostname`, falling back to the raw URL). Group by hostname across all accounts (one landing host can serve several accounts): sum clicks and conversions, and collect the set of accounts.
3. Keep hosts with `clicks >= 100`. If fewer than 2 remain, the result is ok.
4. CVR = conversions / clicks per host. `med` = median of those CVRs (mean of the two middle values for an even count). If `med == 0`, the result is ok.
5. `drop_pct = (med - cvr) / med * 100`. Flag hosts with `drop_pct >= 50`; sort by `drop_pct` descending.

**Result**

- **warn:** at least one host flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** host, accounts, clicks, conversions, CVR (%, 2 decimals), drop vs median (%, 1 decimal); capped at 20, plus the median CVR. Wording: "N landing pages convert more than 50% below the median conversion rate (x.x%). Either the page is slow, the message doesn't match the ad, or the flow has friction."
- **Action:** Open each page and compare it side by side with the best performer: page speed, hero message, form length, above-the-fold call to action. The cheapest fix is often matching the page's message more closely to the ad copy sending traffic to it.

## Dayparting coverage

- **ID:** `dayparting-coverage`
- **Category:** efficiency · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each campaign's spend tracks roughly with its converting hours. Campaigns that put 30% or more of spend into hours converting at less than half the best-hour rate are leaking; that's where ad-schedule bid adjustments or hour-of-day exclusions earn their keep.
- **Settings:** `minSpend` = 100 (skip campaigns with less 7-day spend, account currency); `lowCvrThreshold` = 0.5 (an hour is low-CVR below this fraction of the best hour, clamped 0–1); `maxLowCvrSpendShare` = 0.3 (flag at this share of spend in low-CVR hours, clamped 0–1); `minClicksPerHour` = 5 (hours with fewer clicks can't be the best hour).

**Queries**

Last 7 days ending yesterday:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type, segments.hour,
  metrics.cost_micros, metrics.clicks, metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Drop rows whose `segments.hour` isn't 0–23. Group by (`customer_id`, `campaign.id`, `segments.hour`): sum cost, clicks, conversions. Campaign totals = sums over its hours. Derive `channel`.
2. Skip campaigns with total cost `< 100`.
3. Best hour = the hour with the highest `conversions / clicks` among hours with `clicks >= 5`. Skip the campaign if no such hour has CVR > 0.
4. `cutoff = best_cvr * 0.5`. Low-CVR spend = sum of cost over all hours whose CVR (0 when clicks = 0) is `< cutoff`. `share = low_cvr_spend / total_cost`.
5. Flag when `share >= 0.3`. Sort by share descending; sum low-CVR spend per currency.

**Result**

- **opportunity:** at least one campaign flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, campaign, channel, low-CVR spend share (whole %), low-CVR spend, total spend, best hour, best-hour CVR (%, 2 decimals); capped at 20. Wording: "N campaign(s) put at least 30% of last week's spend into hours converting below 50% of their best hour. About X of weekly spend lands in those hours: candidates for ad-schedule bid adjustments or pausing the worst hours."
- **Action:** Review the hour-of-day report for each campaign. Apply -50% to -100% bid adjustments on the lowest-CVR hours, or build an ad schedule that excludes them. Re-check in 2 weeks: the low-CVR spend share should drop.

## Scale headroom

- **ID:** `scale-headroom`
- **Category:** growth · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Search/Shopping campaigns winning 70% or more of eligible auctions, with at least 5% of impressions lost to budget and a converting track record, can absorb more spend without efficiency falling off sharply. Not a guarantee, but a clean shortlist for budget increases.
- **Settings:** `minSis` = 70 (minimum Search impression share, %); `minBudgetLossSis` = 5 (minimum impression share lost to budget, %); `minConversions` = 5 (minimum 30-day conversions).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  metrics.search_impression_share, metrics.search_budget_lost_impression_share,
  metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by (`customer_id`, `campaign.id`): sum cost, conversions and conversion value; take the mean of `search_impression_share` and of `search_budget_lost_impression_share` over the campaign's rows (with no `segments.date` selected there is one row, the window value). Missing share values count as 0. Derive `channel`.
2. Skip campaigns with conversions `< 5`.
3. `sis_pct = mean_sis * 100`, `budget_lost_pct = mean_budget_lost * 100`. Keep campaigns with `sis_pct >= 70` AND `budget_lost_pct >= 5`.
4. CPA = cost / conversions. Sort by `budget_lost_pct` descending.

**Result**

- **opportunity:** at least one campaign kept. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, campaign, channel, Search IS (%, 1 decimal), lost IS to budget (%, 1 decimal), conversions, spend, CPA; capped at 20, plus the highest budget loss. Wording: "N campaign(s) win at least 70% of eligible auctions, lose at least 5% to budget, and convert at scale (5 or more conversions in 30 days). Adding budget here should buy more conversions at about the current CPA: the demand exists, the daily cap is the bottleneck."
- **Action:** Raise daily budgets in 20% steps on these campaigns and watch a week of pacing. If CPA stays flat as spend rises, keep going; if CPA climbs sharply, you've found the demand ceiling, so stop there. See `references/sis-headroom.md`.

## Auto-apply recommendations

- **ID:** `auto-apply-settings`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Auto-apply is off, or only the specific recommendation types you've approved are on.
- **Settings:** `allowedTypes` = "" (comma-separated recommendation types allowed to auto-apply; empty means none, so any enabled subscription is flagged). Users can record approved types in `ads/google/index.md`.

**Queries**

```sql
SELECT customer.descriptive_name, recommendation_subscription.type, recommendation_subscription.status
FROM recommendation_subscription
```

**Analyse with Python**

1. Keep rows whose upper-cased `status == "ENABLED"`.
2. Flag those whose upper-cased `type` is not in `allowedTypes`.

**Result**

- **warn:** at least one flagged subscription. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, recommendation type; capped at 20. Wording: "Google is auto-applying N type(s) of recommendations you haven't explicitly approved: adding keywords, expanding targeting or changing bids on its own, often pulling performance away from what's working."
- **Action:** Open Recommendations → Auto-apply in Google Ads and turn off anything you don't actively want. Keep it minimal; most optimizations are better controlled manually.

## Account-level negatives

- **ID:** `account-negatives`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each account has account-level negatives covering competitors, irrelevant queries, and bad placements.
- **Settings:** `minCount` = 1 (flag accounts with fewer account-level negative criteria).

**Queries**

```sql
SELECT customer.descriptive_name, customer_negative_criterion.id, customer_negative_criterion.type
FROM customer_negative_criterion
```

**Analyse with Python**

1. Count rows per account. Every account in scope that returned no rows (and no error) has a count of 0.
2. Type mix across all rows: keywords = `KEYWORD`; placements = `PLACEMENT`, `YOUTUBE_VIDEO`, `YOUTUBE_CHANNEL`; mobile apps = `MOBILE_APPLICATION`, `MOBILE_APP_CATEGORY`.
3. Flag accounts with count `< 1`.

**Result**

- **warn:** at least one account flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, negative count (all flagged accounts), plus total negatives and the keyword / placement / mobile-app split. Wording: "N account(s) have fewer than 1 account-level negative criteria. Without a baseline blocklist, the same negatives get added to every campaign instead of once at the top."
- **Action:** In Tools → Shared library → Negative keyword lists (and Exclusion lists for placements), build a list of terms and placements ads should never show for (competitor brands, job seekers, adult or low-intent sites) and apply it account-wide. For the strategy behind the list, run `google-ads-audit-negative-strategy`.

## Bid–goal alignment

- **ID:** `correct-campaign-goals`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** PMax and Shopping campaigns bid for conversions (Target CPA, Target ROAS, or Maximize Conversions), not clicks.
- **Settings:** `requireConversionBiddingForPmax` = true (flag PMax campaigns not on conversion bidding); `flagTrafficBiddingOnShopping` = true (flag Shopping campaigns on traffic bidding).

**Queries**

```sql
SELECT customer.descriptive_name, campaign.id, campaign.name, campaign.advertising_channel_type,
  campaign.bidding_strategy_type, campaign.optimization_score
FROM campaign
WHERE campaign.status = 'ENABLED'
```

**Analyse with Python**

1. Upper-case channel type and bidding strategy.
2. If `requireConversionBiddingForPmax` and channel is `PERFORMANCE_MAX` and strategy is not in `TARGET_CPA`, `TARGET_ROAS`, `MAXIMIZE_CONVERSIONS`, `MAXIMIZE_CONVERSION_VALUE` → reason "PMax not on conversion-based bidding".
3. Else if `flagTrafficBiddingOnShopping` and channel is `SHOPPING` and strategy is in `MAXIMIZE_CLICKS`, `TARGET_IMPRESSION_SHARE`, `MANUAL_CPC`, `ENHANCED_CPC` → reason "Shopping using traffic-style bidding".

**Result**

- **warn:** at least one campaign with a reason. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, campaign ID, campaign, channel type, bidding strategy, reason; capped at 20. Wording: "N campaign(s) have a bidding strategy that doesn't match how they should be optimized. A Shopping or Performance Max campaign bidding for clicks will spend on traffic without steering toward purchases."
- **Action:** Open each campaign → Settings → Bidding and switch to a conversion-based strategy (Target CPA, Target ROAS, or Maximize Conversions). Expect a short learning period after the switch.

## Geo naming coverage

- **ID:** `geo-naming-coverage`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every active campaign resolves a country or region from the Geo position of its name. Tier-1 markets get explicit country labels (US, NL, DE); long-tail markets get deliberate labels (Tier 2, Nordics, ROW-EN). All Search and PMax spend shows up under a country or region you actually track; nothing hides under an unattributed catch-all.
- **Settings:** `minSpend` = 200 (skip campaigns with less 30-day spend, account currency). Needs the naming patterns from `ads/taxonomy.md`: each pattern is a delimiter (e.g. `_` or ` | `) plus an ordered list of positions, one of which may be Geo.

**Queries**

Last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Load the patterns from `ads/taxonomy.md` in their listed order.
2. Group by (`customer_id`, `campaign.id`), summing cost. Skip campaigns with cost `< 200`. Derive `channel`.
3. Classify each name: for each pattern in order (skipping ones with no delimiter), split the name on the delimiter; if the number of parts doesn't equal the number of positions, try the next pattern. The first pattern whose part count matches wins: its Geo part, stripped and upper-cased, is the geo. If that part is empty, the pattern has no Geo position, or no pattern matches, the geo is unassigned.
4. Flag unassigned campaigns; sort by spend descending; sum spend per currency.

**Result**

- **warn:** at least one campaign unassigned. — **ok:** otherwise.
- **unknown:** `ads/taxonomy.md` has no naming patterns ("No campaign naming patterns in `ads/taxonomy.md`, so no campaign can resolve a Geo; `google-ads-check-naming-convention` can set them up"), none of the patterns has a Geo position ("None of the naming patterns include a Geo position; add one to track per-country coverage"), or the query errors on every account.
- **Report:** account, campaign, channel, spend (30 days); capped at 30, with the count and total. Wording: "N active campaign(s), about X of 30-day spend, resolve no country from their name. Market-level reporting can't tell which market these belong to, so their spend doesn't show up under any country. Either rename the campaign to follow the convention or give long-tail markets a deliberate Geo label."
- **Action:** For each campaign: (a) a tier-1 market whose name doesn't follow the convention: rename it so the Geo position carries the country (e.g. `GOOGLE_SEARCH_DEMAND_GENERIC_FR_FR_2026Q3`); (b) a long-tail or regional bundle: give it a deliberate Geo label (e.g. `Tier-2`, `Nordics`, `ROW-EN`). Goal is zero unassigned. See `references/market-partitioning.md`.

## Spend fragmentation

- **ID:** `spend-fragmentation`
- **Category:** hygiene · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Few campaigns spend below 100 a month; sub-scale campaigns starve smart bidding of learning data.
- **Settings:** `minSpend` = 100 (campaigns below this 30-day spend, account currency, count as fragmented); `maxOffending` = 3 (pass while the number of fragmented campaigns is at most this).

**Queries**

Last 30 days ending yesterday:

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign_budget.amount_micros, metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Analyse with Python**

1. Group by (`customer_id`, `campaign.id`), summing `cost`.
2. Fragmented = campaigns with `0 < cost < 100`, sorted by cost ascending.
3. `total_spend` = sum of all campaigns' cost; `fragmented_spend` = sum of fragmented cost; `fragmented_share = fragmented_spend / total_spend * 100` (0 when total is 0), whole percent. Report sums per currency.
4. The count is taken across all accounts in scope together, as the engine does.

**Result**

- **warn:** the number of fragmented campaigns is greater than 3. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** account, campaign, spend; capped at 20, plus total 30-day spend, fragmented spend and fragmented share. Wording: "N active campaign(s) spent less than 100 in the last 30 days. Campaigns this small don't give smart bidding enough volume to learn: budget stays in learning and performance never stabilizes."
- **Action:** Consolidate these into larger, adjacent campaigns (same goal, same audience, same bidding strategy). If a campaign has a genuine reason to stay small, such as a niche launch test, accept it, but keep these outliers few.

## Landing page reachability

- **ID:** `lp-reachability`
- **Category:** hygiene · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Every URL your ads point to loads successfully. Broken pages waste 100% of clicks.
- **Settings:** `timeoutMs` = 10000 (per-URL timeout, minimum 1000); `concurrency` = 8 (parallel fetches, 1 to 32); `maxSampled` = 200 (cap on distinct URLs checked per run, protects huge accounts).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  campaign.name,
  campaign.status,
  ad_group_ad.ad.id,
  ad_group_ad.ad.final_urls
FROM ad_group_ad
WHERE ad_group_ad.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
~~~

**Analyse with Python**

1. Use Python to collect URLs: for every row, take each entry of `ad_group_ad.ad.final_urls` (a list; if it arrives as a JSON string, parse it; if parsing fails, treat the raw string as one URL). Keep only strings starting with `http://` or `https://`.
2. Deduplicate URLs across all accounts, keeping for each URL the set of accounts it appears in. Keep the first `maxSampled` (200) distinct URLs in query order.
3. Fetch each sampled URL with your web fetch tool, following redirects, with the `timeoutMs` timeout. The engine sent HEAD and retried with GET on 405 or 403; a web fetch tool does a GET, which is equivalent. A URL is **broken** when the final response is not 2xx, the request times out, or it errors (DNS, TLS, connection refused). Record the status code (or none) and the error text. If your fetch tool does not expose the status code, count an error page the tool reports as 404/5xx, or a tool error, as broken and say so in the report.

**Result**

- **fail:** at least one sampled URL is broken. — **ok:** otherwise.
- **unknown:** the query errors on every account, or no active ad has an `http(s)` final URL ("No active ads with landing-page URLs found").
- **Report:** "<n> of <sampled> landing page URLs didn't load: they returned an HTTP error, timed out, or are unreachable. Every click to these pages is paid traffic that bounces immediately." Table (first 20): accounts (comma-joined names), URL, status, error.
- **Action:** For each URL, open it in a browser and fix the underlying issue (restore the page, update the redirect, or point the ad's final URL elsewhere). Until fixed, consider pausing the affected ads so you stop paying for dead clicks.

## Naming convention compliance

- **ID:** `naming-convention`
- **Category:** hygiene · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Every campaign follows one schema. The default is the campaign-level shape `[Platform]_[Channel]_[Objective]_[Geo]`, e.g. `GADS_SRCH_CONV_FR` or `FR-Search-Brand`. Within an account, names use a single delimiter (`_` or `-`, not mixed), a single casing (all UPPER or all lower), no spaces, no special characters, no name collisions, and stay short enough to read in a dashboard.
- **Settings:** `pattern` = `^[A-Za-z0-9]+([_-][A-Za-z0-9]+){2,}$` (3+ alphanumeric tokens separated by a single `-` or `_`; replace it with the schema declared in `ads/taxonomy.md` if there is one); recommended token count = 4 (Platform/Channel/Objective/Geo); disallowed characters = `& % , / \`; max length = 150.

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign.status
FROM campaign
WHERE campaign.status IN ('ENABLED', 'PAUSED')
~~~

**Analyse with Python**

Compile `pattern` with `re` (it is written as a JavaScript regex; the default works unchanged in Python, test it with `re.search`, which matches the JS `test` semantics). If it fails to compile, the result is unknown. Then, over all campaigns:

1. **Pattern mismatch:** campaigns where `re.search(pattern, name)` is falsy.
2. **Hygiene:** per campaign, collect issues: `blank` (`name.strip() == ""`), `contains spaces` (any `\s`), `special chars` (matches `[&%,/\\]`), `>150 chars` (`len(name) > 150`). Keep campaigns with at least one issue.
3. **Token-light:** tokens = `[t for t in re.split(r"[-_]", name) if t]`; flag when `0 < len(tokens) < 4` and the name is not blank.
4. **Inconsistent format, per account** (skip accounts with fewer than 2 campaigns): classify each name's delimiter as UNDERSCORE (`_` only), HYPHEN (`-` only), BOTH, or NONE, and its casing over ASCII letters as UPPER, LOWER, MIXED (both cases in the name) or NONE. Ignoring NONE, flag the account when the set of delimiter classes or the set of casing classes has more than one member.
5. **Collisions, per account:** group by `(customer_id, campaign.name)`; flag groups with more than one `campaign.id`. The same name in different accounts is intentional (market replicas) and not flagged.

**Result**

- **warn:** any of pattern mismatch, hygiene, inconsistent format or collisions is non-empty. — **opportunity:** only token-light names found. — **ok:** otherwise.
- **unknown:** the pattern does not compile, or the query errors on every account.
- **Report:** one observation per non-empty bucket, each table capped at 50 rows:
  - Pattern mismatch: "<n> of <total> campaigns (<share>%, rounded) don't match your naming pattern. They will misclassify in any report or filter that relies on campaign name (brand vs generic, channel splits, country rollups, automated rules)." Columns: account, name, status.
  - Hygiene: "<n> campaign names are blank, contain spaces, contain disallowed characters (& % , / \), or exceed 150 chars. These break dashboards, CSV exports and rules even if the rest of the pattern is fine." Columns: account, name, status, issues.
  - Token-light: "<n> campaigns have fewer than 4 tokens, so at least one of Platform / Channel / Objective / Geo is missing. Audience and funnel can't be reconstructed later if they were never in the name." Columns: account, name, status, tokens.
  - Inconsistent: "<n> accounts mix delimiters or casing across campaigns. Mixed conventions silently break grouping rules, CSV joins and string matches." Columns: account, delimiters, casing, campaign count.
  - Collisions: "<n> duplicate campaign names within a single account. Per-name reporting sums two ledgers." Columns: account, name, campaign IDs, duplicate count.
- **Action:** Pattern: rename the offending campaigns to match the convention; if the team uses another schema, declare it in `ads/taxonomy.md` and use that pattern. Hygiene: rename to alphanumerics plus the chosen delimiter, no spaces or special characters, under 150 chars; blank names should be fixed immediately. Token-light: when next renaming, work toward `[Platform]_[Channel]_[Objective]_[Geo]`; single-market accounts can drop Geo but should keep Platform / Channel / Objective. Inconsistent: pick one delimiter (`_` recommended) and one casing (UPPER_SNAKE is conventional) per account, rename the outliers, document it in `ads/taxonomy.md`. Collisions: add a distinguishing token (version, date, audience); IDs are stable, only the name changes. For a full audit run `google-ads-check-naming-convention`.

## Daily budget overdelivery

- **ID:** `daily-budget-overdelivery`
- **Category:** monitoring · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** No active campaign has spent more than 1.5× its daily budget today. Google can over-deliver up to 2× on any day, but it claws the excess back later, so sustained over-delivery throttles future serving.
- **Settings:** `overDeliveryFactor` = 1.5 (flag when today's spend / daily budget exceeds this; minimum 1; Google's hard cap is 2.0×).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign_budget.amount_micros,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date = '<today>'
~~~

`<today>` is today's date in the account's time zone (spend so far today).

**Analyse with Python**

1. Use Python to group by `(customer_id, campaign.id)`: daily budget = `campaign_budget.amount_micros / 1e6` (first row), spend today = sum of `cost_micros / 1e6`.
2. Keep campaigns with budget > 0 and `spend / budget > overDeliveryFactor`. Ratio rounded to 2 decimals. Sort by ratio descending.

**Result**

- **warn:** at least one campaign over the factor. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** "<n> campaigns have already spent more than <factor>× their daily budget today. Expect Google to throttle tomorrow's serving on these campaigns." Table (first 20): account, campaign, daily budget, spend today, ratio. Worst ratio as a headline metric.
- **Action:** If the over-delivery is intentional (launch day, sale starting today), accept tomorrow's throttle. If it's a runaway, raise the daily budget or pause the campaign before more spend lands. Recurring over-delivery means the budget is too low for sustained performance.

## Conversion rate fluctuation

- **ID:** `conv-rate-fluctuation`
- **Category:** monitoring · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Yesterday's CVR is in line with the prior 7-day rate. Sharp drops usually signal something broke.
- **Settings:** `maxDropPct` = 40 (fail when yesterday's CVR is more than this percent below the prior 7-day CVR); `minClicks` = 50 (skip accounts with fewer clicks than this yesterday, or in the prior 7 days combined).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  segments.date,
  metrics.clicks,
  metrics.conversions
FROM customer
WHERE segments.date BETWEEN '<start>' AND '<end>'
~~~

Window: last 14 days ending yesterday.

**Analyse with Python**

1. Use Python to sum clicks and conversions per `(customer_id, segments.date)`. Evaluate each account separately.
2. "Yesterday" = the account's latest date in the data. Skip the account if yesterday's clicks < `minClicks`.
3. Prior = the up-to-7 most recent dates before yesterday; sum their clicks and conversions. Skip if prior clicks < `minClicks`.
4. `yesterday_cvr = conv / max(1, clicks)`, `prior_cvr` likewise. `drop_pct = (prior_cvr − yesterday_cvr) / prior_cvr × 100`, or 0 when `prior_cvr` = 0.
5. Flag accounts with `drop_pct > maxDropPct`. Sort by drop descending.

**Result**

- **fail:** at least one account flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** "<n> accounts converted yesterday at a rate more than <maxDropPct>% below the last week's average. A drop this size usually means something broke (tracking, a landing page, a recent pricing or copy change) rather than audience fatigue." Table (first 20): account, yesterday's date, yesterday CVR %, prior CVR %, drop %.
- **Action:** For each account, sanity-check conversion tracking (test-fire the tag), scan for landing-page changes pushed in the last 24 hours, and look at the campaigns with the steepest CVR drop to narrow the source.

## Impression share losses

- **ID:** `impression-share-losses`
- **Category:** monitoring · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** On every meaningfully funded Search and Shopping campaign you're winning most of the auctions you're eligible for, and when you show, you're at the top. If you're losing impressions, the split tells you whether you ran out of budget (raise it) or Ad Rank wasn't high enough (fix bids, Quality Score, assets).
- **Settings:** `maxLostBudgetPct` = 10 (flag when lost IS to budget exceeds this); `maxLostRankPct` = 20 (flag when lost IS to rank exceeds this); `minAbsTopPct` = 30 (flag when absolute-top IS is below this); `minCampaignSpend` = 100 (skip campaigns spending less than this over the window, account currency).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share,
  metrics.search_top_impression_share,
  metrics.search_absolute_top_impression_share,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')
  AND segments.date BETWEEN '<start>' AND '<end>'
~~~

Window: last 30 days ending yesterday. With `segments.date` only in `WHERE`, each campaign returns one row aggregated over the window.

**Analyse with Python**

1. Use Python to group by `(customer_id, campaign.id)`: spend = sum of `cost_micros / 1e6`; for each IS metric take the simple mean over the campaign's rows (one row when aggregated; the engine averaged rows). Treat missing IS values as 0. Multiply by 100 for percent.
2. Keep campaigns with spend ≥ `minCampaignSpend`.
3. Budget-lost bucket: mean lost-budget % > `maxLostBudgetPct`, sorted descending. Rank-lost bucket: mean lost-rank % > `maxLostRankPct`, sorted descending. Low-abs-top bucket: mean absolute-top % < `minAbsTopPct`, sorted ascending. A campaign can land in several buckets. Round percentages to 1 decimal.

**Result**

- **warn:** the budget-lost or rank-lost bucket is non-empty. — **opportunity:** only the low-abs-top bucket is non-empty. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** one observation per non-empty bucket, each table capped at 20: account, campaign, the bucket's IS %, spend.
  - Budget: "<n> campaigns lost more than <max>% of impressions because the budget cap was hit. The daily budget is the bottleneck, not bids or Quality Score." Headline: sum of their spend.
  - Rank: "<n> campaigns lost more than <max>% of impressions because Ad Rank wasn't high enough. Bids, Quality Score or asset coverage are the levers, not budget." Headline: sum of their spend.
  - Abs top: "<n> campaigns are showing but rarely in the absolute-top position. On brand and high-intent terms that is where most click value is."
- **Action:** Budget: raise the daily budget, starting with a 20% bump and a week of pacing; if that isn't an option, narrow targeting (geo, schedule, audience) to spend the same money on higher-intent traffic. Rank: check Quality Score on top-spend keywords, asset coverage (sitelinks, callouts, structured snippets) and RSA strength; fix QS before raising bids, since raising bids on low-QS keywords is the most expensive way to win. Abs top: decide which campaigns benefit from premium placement (usually brand, competitor and high-intent commercial terms) and raise bids until absolute-top IS rises, or move them to Target Impression Share with a top-of-page goal.

## Metric trend drift

- **ID:** `trend-drift`
- **Category:** monitoring · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** The most recent 28 days of CPA, CVR and conversion volume stay within 25–30% of the prior 28 days, both for the account rollup and per channel. The channel pass exists because a flat account number can hide one channel falling while another rises.
- **Settings:** `windowDays` = 28 (length of each side; minimum 7); `maxCpaDriftPct` = 30; `maxCvrDropPct` = 25; `maxConvDropPct` = 25; `severeCpaDriftPct` = 50; `severeCvrDropPct` = 40; `severeConvDropPct` = 40 (each severe value is at least its max value); `minPriorConv` = 30 (skip comparisons with fewer prior conversions); `minPriorClicks` = 500 (skip the CVR comparison below this many prior clicks).

**Queries**

Window: the last `2 × windowDays` days (56 by default) ending yesterday. Recent = the last `windowDays` days; prior = the `windowDays` days before.

Query A (account rollup):

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM customer
WHERE segments.date BETWEEN '<start>' AND '<end>'
~~~

Query B (per channel):

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.name,
  campaign.advertising_channel_type,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
~~~

**Analyse with Python**

1. Use Python to tag each row recent (date ≥ recent start) or prior.
2. Channel for Query B rows: `campaign.advertising_channel_type`, except SEARCH splits into `SEARCH_BRANDED` when the campaign name contains any `brand_terms` entry from `ads/google/index.md` (case-insensitive) and `SEARCH_NONBRANDED` otherwise (all SEARCH is non-branded when no brand terms are set).
3. For each account (Query A) and each `(customer_id, channel)` (Query B), sum cost, clicks, conversions per side. Then: `cpa = cost / conv` (0 when conv = 0), `cvr = conv / clicks` (0 when clicks = 0), `cpa_drift = (recent_cpa − prior_cpa) / prior_cpa × 100` (0 when prior CPA = 0), `cvr_delta = (recent_cvr − prior_cvr) / prior_cvr × 100` (0 when prior CVR = 0), `conv_delta = (recent_conv − prior_conv) / prior_conv × 100` (0 when prior conv = 0). The engine rounds the three percentages to whole numbers before comparing.
4. Account buckets: CPA drift = `prior_conv ≥ minPriorConv`, prior CPA > 0, `cpa_drift > maxCpaDriftPct`. CVR drop = prior CVR > 0, `prior_clicks ≥ minPriorClicks`, `cvr_delta < −maxCvrDropPct`. Volume drop = `prior_conv ≥ minPriorConv`, `conv_delta < −maxConvDropPct`.
5. Channel buckets: CPA drift and volume drop with the same rules (no per-channel CVR: too noisy at low click counts).
6. Within each bucket, the severe rows are those with `cpa_drift > severeCpaDriftPct`, `cvr_delta < −severeCvrDropPct` or `conv_delta < −severeConvDropPct`. Sort CPA buckets by drift descending and drop buckets by delta ascending.

**Result**

- **fail:** any bucket contains at least one severe row. — **warn:** any bucket is non-empty but has no severe row. — **ok:** all five buckets empty.
- **unknown:** both queries error on every account.
- **Report:** one observation per non-empty bucket. Columns: account (plus channel for channel buckets), recent and prior CPA, CPA drift %, recent and prior CVR %, CVR delta %, recent and prior conversions, conversion delta %, recent and prior spend. Cap account tables at 20 rows and channel tables at 30. Lead with "<severe> of <n> ..." when severe rows exist ("efficiency has broken, not eroded; treat it as a live incident" for CPA, "a drop this size usually means tracking is broken" for CVR, "rarely demand alone: suspect a broken channel, a paused campaign or a tracking outage" for volume), otherwise "<n> accounts have CPA / CVR / conversions more than <max>% worse over the last <windowDays> days versus the prior <windowDays>". For channel buckets, note that a healthy channel can mask a failing one in the rollup.
- **Action:** CPA: cross-reference `recent-changes` for the same window, `impression-share-losses` (paying more for the same auctions) and `lin-rodnitzky-ratio` (search-term mix widened); the channel pass shows if one channel drives it. CVR: check `tracking-template-sanity` and `conversion-action-health` first (a partial tracking break looks identical), then `n-gram-analysis`, `search-terms-waste` and `lp-conv-rate-outlier`. Volume: read the channel breakdown first, then `impression-share-losses`, `monthly-budget-pacing` and `recent-changes` per channel. Channel CPA: for PMax check brand share, recent asset-group changes and seasonality adjustments; for Search pull search terms and `n-gram-analysis`; for Shopping check Merchant Center product status. Channel volume: check recent edits that narrowed targeting (`recent-changes`), asset issues (`pmax-asset-disapprovals`) and budget-cap shifts (`monthly-budget-pacing`).

## Zero-spend campaigns

- **ID:** `campaigns-not-spending`
- **Category:** monitoring · **Urgency:** high · **Runs by default:** yes
- **Good looks like:** Each active campaign serves impressions every week. Zero usually means a budget, bid, targeting or disapproval blocker.
- **Settings:** none. Constants: zero-impression window = 7 days (today and the 6 days before); "prior 28 days" = days 7 to 34 ago; spend history = 90 days; bad approval statuses = `DISAPPROVED`, `SITE_SUSPENDED`.

**Queries**

Query A (campaign metadata):

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.bidding_strategy_type,
  campaign_budget.amount_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
~~~

Query B (90-day daily delivery):

~~~sql
SELECT
  campaign.id,
  segments.date,
  metrics.impressions,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<today minus 90 days>' AND '<today>'
~~~

Query C (ads):

~~~sql
SELECT
  campaign.id,
  ad_group_ad.status,
  ad_group_ad.policy_summary.approval_status
FROM ad_group_ad
WHERE campaign.status = 'ENABLED'
~~~

Query D (ad groups):

~~~sql
SELECT
  campaign.id,
  ad_group.status
FROM ad_group
WHERE campaign.status = 'ENABLED'
~~~

**Analyse with Python**

Key everything on `(customer_id, campaign.id)`. Age of a row = whole days between today and `segments.date` (today = 0).

1. From Query B per campaign: last impression date (latest date with impressions > 0), last spend date (latest date with cost > 0), impressions over ages 0–6, spend over ages 7–34 (`prior_28d_spend`), days since last impression.
2. From Query C: total ads, ads with status `ENABLED`, ads whose approval status is `DISAPPROVED` or `SITE_SUSPENDED`. From Query D: total and `ENABLED` ad groups.
3. Flag each Query A campaign whose impressions over ages 0–6 are 0 (no Query B rows also counts as 0).
4. Assign a cause, first match wins:
   - total ad groups > 0 and enabled ad groups = 0 → **No enabled ad groups**, high ("All <n> ad groups are paused or removed").
   - total ads > 0 and enabled ads = 0 → **No enabled ads**, high.
   - total ads > 0 and disapproved = total → **All ads disapproved**, high.
   - total ads ≥ 2 and disapproved > total / 2 → **Majority of ads disapproved**, medium.
   - Query B data exists and `prior_28d_spend > 0` → **Recently stopped (was spending)**, medium ("Spent until <last spend date> then stopped: likely a bid or target change, audience shrink, or auction shift").
   - Query B data exists and no impression in 90 days → **Never launched**, medium ("Check bid floor vs auction price, geo or audience size, and conversion goal eligibility").
   - otherwise → **Needs investigation**, low.
5. Sort by confidence (high, medium, low), then daily budget descending. Sum daily budgets per currency as the exposure.

**Result**

- **fail:** at least one campaign flagged. — **ok:** otherwise.
- **unknown:** Query A errors on every account.
- **Report:** "<n> active campaigns didn't serve a single impression in the last 7 days. <h> have a deterministic blocker (no live ads or ad groups, all disapproved): fix those directly. <l> need investigation." Table (first 20): account, campaign, bidding strategy, daily budget, last impression (or "never (in 90d)"), days at zero (or "90+"), enabled ad groups, enabled ads, ads disapproved, prior 28-day spend, probable cause, confidence, explanation. Headline: daily budget at risk per currency.
- **Action:** Start with the high-confidence rows: each has a specific fix in the probable-cause column. For medium-confidence rows (recently stopped, never launched), check the change history first (see `recent-changes`). Low-confidence rows need the `google-ads-campaigns-not-spending` skill, or a manual check of bids vs auction prices, targeting size and conversion goal eligibility.

## Account budget cap

- **ID:** `account-budget-cap`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Every approved account budget sits below 80% of its spending limit, so no account is at risk of pausing mid-cycle.
- **Settings:** `capWarnPct` = 80 (warn at this share of the limit); `capFailPct` = 95 (fail at this share: campaigns are about to stop serving).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  account_budget.id,
  account_budget.name,
  account_budget.status,
  account_budget.approved_spending_limit_micros,
  account_budget.adjusted_spending_limit_micros,
  account_budget.amount_served_micros
FROM account_budget
WHERE account_budget.status = 'APPROVED'
~~~

This resource errors on some accounts (for example ones not on monthly invoicing). Tolerate per-account errors; accounts without an account budget pass silently.

**Analyse with Python**

1. Use Python, per row: effective limit = adjusted limit if > 0, else approved limit (both / 1e6). Skip rows with effective limit ≤ 0 (unlimited budgets). Served = `amount_served_micros / 1e6`; `served_pct = served / effective_limit × 100`, rounded to a whole number.
2. Fail bucket: `served_pct ≥ capFailPct`. Warn bucket: `capWarnPct ≤ served_pct < capFailPct`. Sort each descending.

**Result**

- **fail:** the fail bucket is non-empty. — **warn:** only the warn bucket is non-empty. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** fail: "<n> account budgets are at or above <capFailPct>% of the approved spending limit. Campaigns are about to stop serving." warn: "<n> account budgets are between <capWarnPct>% and <capFailPct>% of the limit. Plan the next adjustment." Tables (first 20 each): account, budget name, approved limit, effective limit, served, served %.
- **Action:** Fail: raise the approved spending limit or apply an adjustment in billing; if the cap is intentional, tell stakeholders before campaigns pause. Warn: forecast remaining-cycle spend and decide whether to raise the cap, narrow scope, or accept the throttle.

## Day-over-day spend variance

- **ID:** `variance-dod-wow`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Yesterday's spend per campaign is within ±50% of its 7-day median. Sharp swings need explaining.
- **Settings:** `maxDeltaPct` = 50 (flag when |yesterday − median| / median exceeds this percent); `minMedian` = 5 (skip campaigns whose median daily spend is below this, account currency).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  segments.date,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
~~~

Window: last 14 days ending yesterday.

**Analyse with Python**

1. Use Python to build a spend series per `(customer_id, campaign.id)` and date (`cost_micros / 1e6`).
2. "Yesterday" = the latest date present across all rows. The baseline dates are every date before it that appears anywhere in the data (up to 13 days, despite the "7-day" label); a campaign with no row on a date counts as 0 that day. Yesterday's spend is 0 if the campaign has no row.
3. Skip campaigns with no baseline dates. `median` = median of the baseline values (mean of the two middle values for an even count). Skip when median < `minMedian`.
4. `delta_pct = |yesterday − median| / median × 100`; flag when > `maxDeltaPct`. Round to 1 decimal.

**Result**

- **warn:** at least one campaign flagged. — **ok:** otherwise (including no data).
- **unknown:** the query errors on every account.
- **Report:** "<n> campaigns spent yesterday more than <maxDeltaPct>% away from their typical daily spend. Swings like this usually mean a budget or bid change, a targeting tweak, or a technical issue, not demand." Table (first 20): account, campaign ID, campaign, yesterday's spend, baseline median, delta %.
- **Action:** For each campaign, check whether budget or bids changed in the last 24 hours, whether targeting changed, and whether it is in learning after a bid-strategy switch. If nothing intentional changed, something on the serving side likely did. For a deeper read run `google-ads-check-variance`.

## Device CVR imbalance

- **ID:** `device-imbalance`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each campaign's CVR is in the same ballpark across devices, or bid adjustments compensate. The common failure is mobile-heavy spend where mobile converts at half the desktop rate with no device modifier; Smart Bidding eventually compensates, but a deliberate adjustment moves faster.
- **Settings:** `minSpend` = 100 (per-device spend floor over the window, account currency); `minClicks` = 100 (per-device click floor); `maxCvrRatio` = 0.5 (flag when worst-device CVR / best-device CVR is below this).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  segments.device,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING', 'PERFORMANCE_MAX')
  AND segments.date BETWEEN '<start>' AND '<end>'
~~~

Window: last 30 days ending yesterday.

**Analyse with Python**

1. Use Python to sum spend, clicks and conversions per `(customer_id, campaign.id, segments.device)`.
2. Eligible devices: not `OTHER`, spend ≥ `minSpend`, clicks ≥ `minClicks`. CVR = conv / clicks (0 when clicks = 0).
3. Skip campaigns with fewer than 2 eligible devices, or where every eligible device has CVR 0.
4. Worst = lowest-CVR eligible device, best = highest. `ratio = worst_cvr / best_cvr`; flag when < `maxCvrRatio`. Smart Bidding campaigns get the same bar. Sort by ratio ascending.

**Result**

- **warn:** at least one campaign flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** "<n> campaigns have one device converting at less than <maxCvrRatio × 100>% of another's rate. Either that device has a UX or speed problem, or a bid adjustment is overdue." Table (first 20): account, campaign, worst device, worst CVR %, worst spend, best device, best CVR %, best spend, ratio.
- **Action:** For each campaign, decide whether the weak device is fixable (mobile site speed, form usability, click-to-call). If yes, fix the experience. If not, set a negative bid adjustment for that device, start at −25% and watch a week.

## Monthly budget pacing

- **ID:** `monthly-budget-pacing`
- **Category:** monitoring · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each account's month-to-date spend is on track to land within 80–110% of the monthly target. Over-pacing exhausts budget early and stops serving in week four; under-pacing leaves demand on the table or loses impression share to budget caps.
- **Settings:** `targetMonthly` = 0 (monthly spend target; 0 skips the check; take it per account from `ads/media-plan.md` or `ads/google/rules/` when they state one, otherwise ask the user); `cycleStartDay` = 1 (day the cycle starts, 1 to 28; 1 = calendar month); `maxOverPct` = 110; `minUnderPct` = 80.

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  segments.date,
  metrics.cost_micros
FROM customer
WHERE segments.date BETWEEN '<cycle start>' AND '<today>'
~~~

Cycle start = day `cycleStartDay` of this month if today's day-of-month ≥ `cycleStartDay`, else of last month. Cycle end = cycle start + 1 month − 1 day. The window includes today.

**Analyse with Python**

1. Use Python: `days_in_cycle` = days from cycle start to cycle end inclusive; `days_elapsed` = days from cycle start to today inclusive (minimum 1).
2. Per account, MTD spend = sum of `cost_micros / 1e6` over days with spend > 0.
3. `forecast = mtd / days_elapsed × days_in_cycle`; `pace_pct = forecast / target × 100` (whole number).
4. Over bucket: `pace_pct > maxOverPct` (sort descending). Under bucket: `pace_pct < minUnderPct` (sort ascending).

**Result**

- **warn:** the over bucket is non-empty. — **opportunity:** only the under bucket is non-empty. — **ok:** otherwise, and when no target is set (say "pacing not evaluated: no monthly target" and offer to record one).
- **unknown:** the query errors on every account.
- **Report:** over: "<n> accounts are forecast to spend more than <maxOverPct>% of the monthly target. Left alone, they hit the cap before month-end and stop serving." under: "<n> accounts are forecast to spend less than <minUnderPct>% of the target: demand dropped, the bidder is too conservative, or impression share is leaking to rank." Tables (first 20 each): account, MTD spend, forecast, pace %, days elapsed, days in cycle.
- **Action:** Over: lower daily budgets on the over-pacing campaigns, or raise the target if the spend is intentional; watch lost IS (budget) once budgets tighten. Under: cross-reference `impression-share-losses`; high lost IS budget means raise budgets, high lost IS rank means work on Quality Score or bids, neither means demand has genuinely fallen and the target should change. For a full pacing read run `google-ads-check-pacing`.

## Low optimization score

- **ID:** `optimization-score-plateau`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each account's optimization score sits at 0.7 or above. The score is a 0–1 share of Google's open recommendations, not a performance metric, but a sustained low score means the recent recommendations are worth scanning.
- **Settings:** `minScore` = 0.7 (flag accounts below this fraction, 0 to 1; 0.7 = 70% in the Google Ads UI).

**Queries**

~~~sql
SELECT
  customer.id,
  customer.descriptive_name,
  customer.optimization_score,
  customer.optimization_score_weight
FROM customer
~~~

**Analyse with Python**

1. Use Python to keep accounts with `0 ≤ optimization_score < minScore`. Skip a score of −1 or missing (Google has not scored the account: not enough activity).
2. Sort by score ascending; show it as a fraction (2 decimals) and a rounded percent.

**Result**

- **opportunity:** at least one account below the floor (opportunity, not warn: many recommendations are worth dismissing). — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** "<n> accounts sit below <minScore × 100>% optimization score. Some recommendations are worth dismissing (Google leans toward broader matching and more spend), but high-value ones are queuing up unread." Table (first 30): account, score, score %. Headline: worst score.
- **Action:** Open Recommendations in each account, sort by impact and read the top few. Apply those that match strategy (ad strength, asset coverage, conversion tracking). Dismiss with notes those that don't (bid increases, broader match, audience expansion).

## Cross-account concentration

- **ID:** `cross-account-concentration`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** No single account holds more than 50% of last-30-day spend across the accounts in scope. Higher concentration is common, not broken, but it means the top account drives the overall numbers.
- **Settings:** `maxConcentrationPct` = 50 (note when the top account's share exceeds this, 0 to 100).

**Queries**

~~~sql
SELECT
  customer.id,
  customer.descriptive_name,
  customer.currency_code,
  metrics.cost_micros
FROM customer
WHERE segments.date BETWEEN '<start>' AND '<end>'
~~~

Window: last 30 days ending yesterday. Run on every account in scope.

**Analyse with Python**

1. Use Python to sum `cost_micros / 1e6` per account and sort descending. If accounts use different currencies, convert to one before comparing, or evaluate per currency group and say so (the engine summed raw amounts).
2. If total spend ≤ 0 or fewer than 2 accounts have rows, stop: ok.
3. `top_share = top_spend / total × 100`; note it when > `maxConcentrationPct`.

**Result**

- **ok:** always, unless unknown. When the top share exceeds the threshold, add an informational note (the engine's `info` level does not change the status).
- **unknown:** the query errors on every account.
- **Report (info):** "Top account <name> took <share>% of last-30-day spend (<top> of <total> across <n> accounts). Any change to it drives the overall numbers." Table (first 20): account, spend, share %.
- **Action:** Weight automation, tests and investigations accordingly. Top-account findings deserve extra scrutiny; long-tail accounts have smaller samples, so their metrics are noisier.

## Active bidding overrides

- **ID:** `active-bidding-overrides`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** When seasonality adjustments or data exclusions are running, you know about them: they're rare, scoped, and deliberate (a Black Friday conversion-rate boost, a tracking outage on a known day). When none are running, bidding is on default behaviour.
- **Settings:** none.

**Queries**

Query A:

~~~sql
SELECT
  customer.descriptive_name,
  bidding_seasonality_adjustment.resource_name,
  bidding_seasonality_adjustment.name,
  bidding_seasonality_adjustment.start_date_time,
  bidding_seasonality_adjustment.end_date_time,
  bidding_seasonality_adjustment.scope,
  bidding_seasonality_adjustment.conversion_rate_modifier,
  bidding_seasonality_adjustment.devices,
  bidding_seasonality_adjustment.campaigns
FROM bidding_seasonality_adjustment
~~~

Query B:

~~~sql
SELECT
  customer.descriptive_name,
  bidding_data_exclusion.resource_name,
  bidding_data_exclusion.name,
  bidding_data_exclusion.start_date_time,
  bidding_data_exclusion.end_date_time,
  bidding_data_exclusion.scope,
  bidding_data_exclusion.devices,
  bidding_data_exclusion.campaigns
FROM bidding_data_exclusion
~~~

**Analyse with Python**

1. Use Python to parse `start_date_time` and `end_date_time` (format `YYYY-MM-DD HH:MM:SS`, treated as UTC, as the engine did). Skip rows with a missing or unparsable bound.
2. Keep rows where `start ≤ now ≤ end`. For seasonality rows, modifier = `conversion_rate_modifier` (1.0 when missing); its effect is `(modifier × 100 − 100)%`.

**Result**

- **ok:** always, unless unknown. Active adjustments and exclusions are informational context: when other variance checks fire during one, the answer is usually "expected", not "investigate".
- **unknown:** both queries error on every account.
- **Report (info):** seasonality: "<n> seasonality adjustments are in effect. Smart Bidding treats conversion rates as <effects> different from baseline for their scope; variance and CPA during this window look unusual on purpose." Table (first 20): account, name, start, end, scope, modifier. Exclusions: "<n> data exclusions are in effect. Smart Bidding ignores conversion data inside the window." Table (first 20): account, name, start, end, scope.
- **Action:** Seasonality: if it's doing what you intended (a known sale or launch), no action; remember it when reading other checks; if it shouldn't run, end it under Tools → Bid strategies → Advanced controls. Exclusions: confirm the exclusion is still appropriate; if the issue is fixed, end it there so the bidder learns from fresh data.

## Bid strategy churn

- **ID:** `bid-strategy-churn`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** No active campaign changes bid strategy more than 2 times in the last 29 days. Smart Bidding needs 14–30 days of stable conversions to leave learning; healthy accounts pick a strategy and tune the target instead of swapping strategies.
- **Settings:** `windowDays` = 29 (days back to scan, 7 to 29: `change_event` rejects start dates 30 or more days old); `maxChurn` = 2 (flag campaigns with more than this many bid-strategy edits); bid-strategy tokens = `bidding_strategy_type`, `bidding_strategy`, `manual_cpc`, `maximize_conversions`, `maximize_conversion_value`, `target_cpa`, `target_roas`, `target_impression_share`, `target_spend`, `percent_cpc`.

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  change_event.change_date_time,
  change_event.changed_fields,
  campaign.id,
  campaign.name
FROM change_event
WHERE change_event.change_date_time >= '<today minus windowDays> 00:00:00'
  AND change_event.change_date_time <= '<today> 23:59:59'
  AND change_event.change_resource_type = 'CAMPAIGN'
ORDER BY change_event.change_date_time DESC
LIMIT 1000
~~~

`change_event` needs `LIMIT` ≤ 10000 and a date range within the last 30 days.

**Analyse with Python**

1. Use Python to keep rows whose lower-cased `changed_fields` (a comma-separated FieldMask list, e.g. `manual_cpc.enhanced_cpc_enabled,bidding_strategy_type`) contains any token as a substring.
2. Count per `(customer_id, campaign.id)`, track the latest change time. Flag campaigns with count > `maxChurn`. Sort by count descending.

**Result**

- **warn:** at least one campaign flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** "<n> campaigns changed bid strategy more than <maxChurn> times in the last <windowDays> days. Each change resets Smart Bidding's learning, so performance stays volatile." Table (first 50): account, campaign, changes, latest change.
- **Action:** Pick a strategy per campaign and commit for at least 30 days. If targets aren't being hit, tune the target (raise target CPA, lower target ROAS) instead of swapping the strategy. Use Drafts and Experiments for risk-controlled comparisons.

## Recent account changes

- **ID:** `recent-changes`
- **Category:** monitoring · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Every material change to bid strategies, budgets, conversion actions and campaign criteria is logged and reviewable. When performance shifts, the first place to look is what changed. Auto-applied recommendations stay rare and intentional.
- **Settings:** `windowDays` = 14 (days back, 1 to 29); `maxAutoApplied` = 10 (warn when more changes than this came from auto-applied recommendations).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  change_event.change_date_time,
  change_event.change_resource_type,
  change_event.resource_change_operation,
  change_event.user_email,
  change_event.client_type,
  change_event.changed_fields,
  campaign.name
FROM change_event
WHERE change_event.change_date_time >= '<today minus windowDays> 00:00:00'
  AND change_event.change_date_time <= '<today> 23:59:59'
  AND change_event.change_resource_type IN ('CAMPAIGN', 'CAMPAIGN_BUDGET', 'CAMPAIGN_CRITERION', 'AD_GROUP', 'AD_GROUP_CRITERION', 'AD_GROUP_BID_MODIFIER')
ORDER BY change_event.change_date_time DESC
LIMIT 1000
~~~

`change_event` needs `LIMIT` ≤ 10000 and a date range within the last 30 days. The API only filters `change_event` on a subset of resource types: bidding-strategy, conversion-action and seasonality edits surface through their parent `CAMPAIGN` rows (see `changed_fields`) or through `active-bidding-overrides`.

**Analyse with Python**

1. Use Python to combine all accounts and sort by `change_date_time` descending. Total = row count (capped at 1000 per account by the `LIMIT`).
2. Auto-applied = rows with `client_type = 'GOOGLE_ADS_AUTO_APPLY'`; automated rules = rows with `client_type = 'GOOGLE_ADS_AUTOMATED_RULE'`.
3. Count changes per `user_email` (empty = "(unknown)"); top user = the highest count.

**Result**

- **warn:** auto-applied count > `maxAutoApplied`. — **ok:** otherwise. The change list and the automated-rules list are informational and don't change the status.
- **unknown:** the query errors on every account.
- **Report:** when total > 0 (info): "<total> material edits in the last <windowDays> days. When a variance check fires, look here first." Table (first 20): account, when, resource, operation, campaign, user, client; headline metrics total, top user (count), auto-applied count, automated-rule count. When warn: "<n> auto-applied recommendations landed in the last <windowDays> days, past the threshold of <maxAutoApplied>. These are edits Google made without anyone clicking Apply." Table (first 20): account, when, resource, operation, campaign. When automated rules > 0 (info): "<n> changes came from automated rules your team created." Same columns.
- **Action:** Change list: if an edit lines up with a performance shift, open Tools → Change history to see the full diff. Auto-apply: review Recommendations → Auto-apply settings; turn off any category nobody consciously approved and review those recommendations weekly instead. Rules: review Tools → Rules and confirm each active rule still matches strategy.

## Customer Match list health

- **ID:** `customer-match-list-health`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each Customer Match list has at least 1,000 members (Google's targeting minimum), a 50%+ match rate (the upload was clean), and a meaningful membership lifespan. NCA goals and remarketing rely on these lists.
- **Settings:** `minSize` = 1000 (Google won't serve a list below this); `minMatchRatePct` = 50 (below this the upload had too many unmatchable rows); `minLifespan` = 30 (membership lifespan in days).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  user_list.id,
  user_list.name,
  user_list.type,
  user_list.size_for_search,
  user_list.size_for_display,
  user_list.match_rate_percentage,
  user_list.membership_life_span,
  user_list.access_reason
FROM user_list
WHERE user_list.type = 'CRM_BASED'
  AND user_list.read_only = FALSE
~~~

**Analyse with Python**

1. Use Python, per list, collect reasons: `size_for_search < minSize` → "size <n> < <minSize>"; `0 < match_rate_percentage < minMatchRatePct` → "match rate <x>% < <min>%" (0 means not yet computed, skip); `0 < membership_life_span < minLifespan` → "lifespan <d>d < <min>d" (0 skipped).
2. Flag lists with at least one reason; report each list once with all its reasons joined by "; ".

**Result**

- **warn:** at least one list flagged. — **ok:** otherwise (including accounts with no Customer Match lists).
- **unknown:** the query errors on every account.
- **Report:** "<n> Customer Match lists are below health thresholds: too small to target (< <minSize>), low match rate (< <min>%), or short lifespan (< <min>d). NCA bidding and remarketing degrade silently when these lists aren't healthy." Table (first 50): account, list name, size for search, match rate %, lifespan days, reasons.
- **Action:** For small lists, upload more members or merge with a similar list. For low match rates, re-upload from the CRM with clean email and phone normalisation (lowercase, strip whitespace, SHA-256 hash). For short lifespans, extend the membership window in the list settings.

## NCA goal config

- **ID:** `nca-goal-config`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Campaigns using the New Customer Acquisition goal have at least one Customer Match list of 1,000+ members in the account. Without it, every conversion looks new to Google and the goal does nothing for bidding.
- **Settings:** `minListSize` = 1000 (minimum list size that counts as a usable existing-customer signal).

**Queries**

Query A:

~~~sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type,
  campaign.optimization_goal_setting.optimization_goal_types
FROM campaign
WHERE campaign.status = 'ENABLED'
~~~

Query B:

~~~sql
SELECT
  user_list.id,
  user_list.size_for_search,
  user_list.size_for_display,
  user_list.type
FROM user_list
WHERE user_list.read_only = FALSE
~~~

The engine used `optimization_goal_types` because it found `campaign.customer_acquisition_goal_settings` sub-fields unselectable. Check with `get_resource_metadata`: if `campaign.customer_acquisition_goal_settings.optimization_mode` is selectable, add it to Query A and also treat `BID_HIGHER_FOR_NEW_CUSTOMER` or `TARGET_NEW_CUSTOMER` as "NCA on".

**Analyse with Python**

1. Use Python to parse `optimization_goal_types` (a list; if a string, parse JSON or split on commas) and upper-case it. NCA on = the list contains `NEW_CUSTOMER` (or the optimization mode above).
2. An account has a usable list when any Query B row (any list type) has `max(size_for_search, size_for_display) ≥ minListSize`.
3. Flag NCA campaigns in accounts with no usable list.

**Result**

- **warn:** at least one campaign flagged. — **ok:** otherwise.
- **unknown:** both queries error on every account.
- **Report:** "<n> campaigns have the New Customer Acquisition goal on but no Customer Match list of at least <minListSize> members in the account. NCA can't tell new from returning customers, so the goal does nothing for bidding." Table (first 30): account, campaign, channel type.
- **Action:** Upload a Customer Match list of past customers (aim for 1,000+ hashed-email members), link it as the existing-customer list under the NCA setting, and let the goal start working. Or turn off the NCA goal on these campaigns until the list is ready.

## Geo-targeting type

- **ID:** `geo-targeting-type`
- **Category:** targeting · **Urgency:** medium · **Runs by default:** yes
- **Good looks like:** Each campaign targets users physically in your area, not anyone showing interest in it (`positive_geo_target_type = PRESENCE`, not the default `PRESENCE_OR_INTEREST`).
- **Settings:** `minSpend` = 0 (only flag campaigns with at least this much 30-day spend, account currency; 0 flags every misconfigured campaign); `includePaused` = false (also audit paused campaigns).

**Queries**

~~~sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.geo_target_type_setting.positive_geo_target_type,
  campaign.geo_target_type_setting.negative_geo_target_type,
  metrics.cost_micros
FROM campaign
WHERE campaign.status IN ('ENABLED', 'PAUSED')
  AND segments.date BETWEEN '<start>' AND '<end>'
~~~

Window: last 30 days ending yesterday. Because it selects metrics, campaigns with no activity in the window don't return rows and are not evaluated.

**Analyse with Python**

1. Use Python to group by `(customer_id, campaign.id)`: sum spend (`cost_micros / 1e6`); take the geo settings from the first row (missing = `UNSPECIFIED`).
2. Keep `ENABLED` campaigns (plus `PAUSED` when `includePaused`). Flag those with positive type ≠ `PRESENCE` and spend ≥ `minSpend`. Sort by spend descending. Sum their spend per currency as the spend at risk.

**Result**

- **warn:** at least one campaign flagged. — **ok:** otherwise.
- **unknown:** the query errors on every account.
- **Report:** "<n> campaigns serve to people merely interested in your targeted locations, not just people physically there; about <spend at risk> in the last 30 days may be going to users you can't serve." Table (first 50): account, campaign, channel type, 30-day spend. For a deeper geo review run `google-ads-check-geo-targeting`.
- **Action:** Open each campaign → Settings → Locations → Location options and switch to "Presence: People in or regularly in your targeted locations".

## Demographic exclusions

- **ID:** `demographic-exclusions`
- **Category:** targeting · **Urgency:** low · **Runs by default:** yes
- **Good looks like:** Each campaign excludes at least one irrelevant age, gender, income or parental group.
- **Settings:** `maxOffending` = 0 (pass when the number of campaigns with zero demographic exclusions is at most this).

**Queries**

Query A (campaigns in channels that support demographic targeting):

~~~sql
SELECT
  customer.descriptive_name,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND campaign.advertising_channel_type IN ('SEARCH', 'DISPLAY', 'VIDEO', 'DEMAND_GEN')
~~~

Query B (demographic exclusions):

~~~sql
SELECT
  ad_group.id,
  ad_group.name,
  campaign.id,
  campaign.status,
  campaign.name,
  ad_group_criterion.type,
  ad_group_criterion.negative
FROM ad_group_criterion
WHERE ad_group_criterion.negative = TRUE
  AND ad_group_criterion.status = 'ENABLED'
  AND ad_group_criterion.type IN ('AGE_RANGE', 'GENDER', 'INCOME_RANGE', 'PARENTAL_STATUS')
  AND ad_group.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
~~~

**Analyse with Python**

1. Use Python to build the set of `(customer_id, campaign.id)` that appear in Query B, and count Query B rows per `ad_group_criterion.type`.
2. Offending = Query A campaigns not in that set. Covered = Query A count − offending.

**Result**

- **warn:** offending count > `maxOffending`. — **ok:** otherwise.
- **unknown:** both queries error on every account.
- **Report:** "<n> of <total> campaigns have zero demographic exclusions (age, gender, income, parental status). Most businesses have at least one obvious non-audience (a B2B tool excluding teenagers, a premium product excluding the lowest income bracket); none at all usually means the default setup was never touched." Table (first 20): account, campaign, channel type. Headline metrics: total exclusions, covered campaigns ("<covered> of <total>"), counts by age, gender, income and parental status.
- **Action:** Open each campaign → Audiences → Demographics and exclude at least one age, gender or income range that clearly doesn't match your buyer. Start with the most obvious misfits; you can expand later.
