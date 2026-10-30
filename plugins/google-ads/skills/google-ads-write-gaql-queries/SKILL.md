---
name: google-ads-write-gaql-queries
description: Reference for writing Google Ads Query Language (GAQL) queries through the Google Ads MCP that return what you expect, and for reading what comes back. Covers result shape, micros, date ranges, conversion counts and the primary-action two-query pattern, insight resources, change_event limits, impression share and syntax. Use when writing or debugging any GAQL query, when a query errors or returns unexpected rows, or when another Google Ads skill points here for syntax and API gotchas.
---

# Write GAQL queries

> Gotchas and conventions for writing GAQL queries that return what you expect, and interpreting what comes back from the Google Ads MCP.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. This skill is the detailed GAQL reference the other skills rely on; it produces no finding of its own.

## How results come back

The reference server is Google's official Google Ads MCP. Three tools matter:

| Tool | What it does |
|---|---|
| `list_accessible_customers` | Lists the accounts the user can read. Run it first to find the customer IDs in scope. |
| `get_resource_metadata` | Lists the selectable, filterable and sortable fields of a resource. Check it whenever a field name or a filter is in doubt instead of guessing. |
| `search` | Runs one GAQL query against **one account**: `search(customer_id, fields, resource, conditions, orderings, limit, login_customer_id)`. |

**One account per call.** Nothing fans out for you. To cover several accounts, call `search` once per account in scope and stamp each result with its `customer_id` when you save it (conventions section 2). Accounts reached through a manager (MCC) need `login_customer_id` set to the manager ID.

**Arguments**, as the `search` tool's own hints state them:

- `customer_id`: digits only, no hyphens (`1234567890`, not `123-456-7890`). Same for `login_customer_id`.
- Dates are `YYYY-MM-DD`.
- Date ranges must be finite: both bounds, or a `DURING` constant. Open-ended ranges are rejected.
- `change_event` queries need `limit` set to 10,000 or less (see below).
- `fields`, `conditions` and `orderings` are lists. Each `AND` clause of a `WHERE` becomes one entry in `conditions`; keep an `OR` group inside one entry, in parentheses.

**Response shape.** A successful call returns a list of flat dicts, one per row, keyed by the full GAQL field path:

```
[
  {"customer.descriptive_name": "Acme NL", "campaign.id": 123, "campaign.status": "ENABLED", "metrics.cost_micros": 41250000, ...},
  ...
]
```

Row-level conventions:

- Keys are the **full field path** exactly as written in `fields`: `campaign.id`, `ad_group.name`, `metrics.cost_micros`, `customer.currency_code`. Not nested objects: `row["ad_group.id"]` works, `row["ad_group"]["id"]` does not.
- **Enums come back as their string names** (`"ENABLED"`, `"SEARCH"`, `"EXACT"`), not numbers.
- **Money stays in micros.** `metrics.cost_micros` is returned as-is; there is no friendly `metrics.cost` expansion (see Cost and currency).
- The rows do not carry the customer ID unless you select it. Select `customer.descriptive_name` and `customer.currency_code` in every query, and add `customer_id` yourself when saving each account's result.
- An empty list means the query ran and matched nothing. That is not an error, and not proof of "all good" (see Channel-type filters).

**Errors are raised, not returned.** A failed call raises a `ToolError` whose message contains `Request ID ...` and `Google Ads API Error: ...` followed by Google's error code and message (for example `PROHIBITED_SEGMENT_WITH_METRIC_IN_SELECT_OR_WHERE_CLAUSE`). Read the error code: it usually names the exact problem. Because each call covers one account, a failure on one account doesn't stop the others; keep going, record which accounts failed and why, and call it out in the output.

## Multi-account reasoning

- Entity IDs can **collide across accounts** in an MCC. Always treat `(customer_id, entity_id)` as the unique key; never bucket or compare entities by ID alone.
- Currency differs per account. Always include `customer.currency_code` in the fields and format each account's figures in its own currency. Don't assume a single symbol across rows.
- When some accounts error and others succeed, say so explicitly in the output. Don't report "everything passed" based on a subset.

## Date ranges emit one row per entity per day

A `segments.date` range (`segments.date >= '2026-04-01' AND segments.date <= '2026-04-30'`, or the `BETWEEN` form) emits **one row per entity per day**, not an aggregated row per entity, but only when `segments.date` is in the selected fields. GAQL has no `GROUP BY` or `SUM()`: segmentation is implicit in which fields you select. If you filter on a date range without selecting `segments.date`, Google returns one row per entity aggregated over the range.

**Prefer explicit ranges over `DURING` constants.** `DURING LAST_30_DAYS`, `LAST_7_DAYS` and `YESTERDAY` resolve their boundaries in UTC, so on accounts in non-UTC time zones they can quietly drop a day from the window. Use them only as a last-resort fallback for prototypes; skills compute concrete dates and pin them in the query.

**`metrics.*` requires a date filter.** A query that selects any `metrics.*` field without a `segments.date` condition fails. No date filter, no metrics.

**`segments.week` and `segments.month` are incompatible with `metrics.*`.** The API rejects mixed queries. To report weekly or monthly totals, pull daily rows with a `segments.date` range and roll them up in Python (`df["week"] = df["segments.date"].dt.to_period("W")`, then `groupby`).

Two practical consequences:

1. If you want a total (for example spend by campaign over 30 days) from daily rows, use Python to sum the per-day rows per `(customer_id, entity id)`. Never total them in your head. For very large row counts, drop `segments.date` from the fields (one aggregated row per entity) or narrow the window or entity set.
2. To get a single row per entity for a single day, use a specific day (`segments.date = '2026-04-23'`), or omit the date segment entirely (Google returns current attributes, but only for queries that don't select `metrics.*`).

## Cost and currency

**Money fields come back in micros, and you select them by their raw names.** There is no friendly-name expansion. Select `metrics.cost_micros`, `campaign_budget.amount_micros`, `ad_group_criterion.cpc_bid_micros` and so on, and divide by 1,000,000 in Python before reporting.

| Context | Field name | Units |
|---|---|---|
| `fields` (SELECT) | `metrics.cost_micros` | micros |
| Response row key | `metrics.cost_micros` | micros: divide by 1e6 |
| `conditions` / `orderings` | `metrics.cost_micros` | micros: multiply a currency threshold by 1,000,000 (spend above €50 is `metrics.cost_micros > 50000000`) |

Fields like `metrics.average_cpc`, `metrics.cost_per_conversion` and `metrics.average_cpm` have no `_micros` suffix in GAQL but are **still in micros**. Write them as-is and divide by 1e6 too. When in doubt, check the value's magnitude: a CPC of `1450000` is 1.45 in currency units.

Currency is on `customer.currency_code`; don't hardcode `$` or `€`.

## Campaign scheduling fields

Google Ads API v23 replaced the legacy date-only campaign scheduling fields:

| Do not use | Use instead |
|---|---|
| `campaign.start_date` | `campaign.start_date_time` |
| `campaign.end_date` | `campaign.end_date_time` |

For a campaign metadata probe, use:

```sql
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.serving_status,
  campaign.start_date_time,
  campaign.end_date_time,
  campaign_budget.amount_micros
FROM campaign
WHERE campaign.name = '<campaign_name>'
```

If you only need to diagnose delivery or budget state, omit the scheduling fields entirely. They are not required for active or not-serving checks.

## Conversions and the primary event

Google Ads exposes several conversion counts. Knowing which one you're reading is the difference between a trustworthy report and a misleading one.

| Metric | What it counts | When to use |
|---|---|---|
| `metrics.conversions` | Sum across every action flagged "Include in Conversions" (primary) at account level. Google's own primary-set aggregate. | Only when the user explicitly asks for Google Ads' aggregate Conversions column, or when no primary conversion action is configured. |
| `metrics.all_conversions` | Every conversion action, regardless of the include-in-conversions flag. The full funnel. | Alongside the primary count for funnel awareness: did the whole funnel drop, or just this event? |
| `metrics.conversions` filtered by `segments.conversion_action_name = '<primary>'` | The one action named in `ads/google/index.md` as `primary_conversion_action`. | The KPI. This is what "conversions" should mean in every skill output when a primary action is set. |
| `metrics.conversions_value` under the same filter | Conversion value for that action. | Selected-event ROAS and value reporting. |

The primary event is read from `ads/google/index.md` (`primary_conversion_action: <name>`, conventions section 3). When it is missing, use the unfiltered `metrics.conversions` (Google's aggregate), label it as such, and suggest `google-ads-configure-conversion-action` so the KPI becomes unambiguous. To list the conversion actions an account has, query `conversion_action` (`conversion_action.name`, `conversion_action.status`, `conversion_action.primary_for_goal`, `conversion_action.category`).

### API constraint: you can't combine the segment with spend

Google Ads rejects `segments.conversion_action_name` when any of `metrics.cost_micros`, `metrics.clicks` or `metrics.impressions` appears in the SELECT or WHERE clause: `PROHIBITED_SEGMENT_WITH_METRIC_IN_SELECT_OR_WHERE_CLAUSE`. So the primary-action count always needs two queries and a join.

### The two-query pattern

When a skill needs both spend and primary conversions (the common case for audit skills):

**Query A: spend and funnel metrics**, no conversion-action segment. Surfaces `all_conversions` so the funnel view is visible even without a primary selection:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  segments.date,
  metrics.cost_micros,
  metrics.clicks,
  metrics.impressions,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date >= '2026-04-01' AND segments.date <= '2026-04-30'
```

**Query B: primary-event conversions**, filtered by segment. No cost, clicks or impressions here:

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  segments.date,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date >= '2026-04-01' AND segments.date <= '2026-04-30'
  AND segments.conversion_action_name = '<primary_conversion_name>'
```

Substitute `<primary_conversion_name>` with the value from `ads/google/index.md`. Escape single quotes inside the name with a backslash (`It's` becomes `It\'s`) so GAQL accepts the literal.

**Join in Python** on `(customer_id, campaign.id, segments.date)`, or drop `segments.date` from both queries when you only need period totals and join on `(customer_id, campaign.id)`. Use a left join from A to B: dates (or entities) can be missing from Query B when the primary action didn't fire, so fill missing conversions with 0, not NaN.

Skip Query B only when no primary event is configured. In that case Query A already carries `metrics.all_conversions` for the funnel view, and you can add `metrics.conversions` to Query A (Google's aggregate) to give the user the best unfiltered number available.

### ROAS under the filter

Filtered ROAS can't be computed in a single query (cost is in Query A, conversion value in Query B). Use Python to compute it after the join: per entity, `roas = sum(conversions_value from B) / sum(cost_micros from A / 1e6)`, NaN when cost is 0. If the primary event is a non-revenue action (for example `SUBMIT_LEAD_FORM`), conversion value is usually zero; prefer CPA (`cost / conversions`) over ROAS for those accounts.

### Output labelling

Tables and prose always disambiguate which count is being reported:

- `conversions (Primary: Lead Form): 42`: filtered, the KPI.
- `all conversions: 128`: funnel context from `metrics.all_conversions`.

In narrow columns, `conversions (Primary)` is fine. Never render a bare `conversions: N` once a primary event is configured: the reader can't tell which count they're looking at.

## Fields that fail

Some fields look selectable but aren't. The API returns `PROHIBITED_FIELD_IN_SELECT_CLAUSE` and the call raises an error for that account.

Known offenders (v23):
- `asset_group_signal.audience` is not selectable. Use `asset_group_signal.asset_group` and reason over rows per asset group if you need signal coverage.

Rule of thumb: if a field is a polymorphic union (one of several possible shapes), GAQL usually won't let you select the whole thing; pick the specific member. `get_resource_metadata` shows which fields a resource actually allows.

## Insight resources require single-resource filtering

Some "insight" resources can only be queried one entity at a time: you cannot select across all campaigns or entities in one call. Without the single-resource filter in the conditions, the API returns `REQUIRES_FILTER_BY_SINGLE_RESOURCE`.

**Verified against v23 on a live account, `campaign_search_term_insight`:**

- Must filter by `campaign_search_term_insight.campaign_id = '<id>'`. Running broadly returns the `searchTermInsightError: REQUIRES_FILTER_BY_SINGLE_RESOURCE` error.
- `campaign.status`, `campaign.advertising_channel_type` and similar parent-resource fields are not valid filters on this resource. Determine which campaigns to query from a separate `FROM campaign` query first, then loop.
- `metrics.cost_micros` is **not selectable** on this resource: it returns `queryError: PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE` with the message "could not support requested resources: 'CAMPAIGN_SEARCH_TERM_INSIGHT'". Available metrics: `clicks`, `impressions`, `conversions`, `conversions_value`. Classification for this resource must work without cost.
- By default it returns one row per search-term *category*. `campaign_search_term_insight.id = "0"` is the residual, uncategorised catch-all (always returned with an empty `category_label`).
- To drill from a category to raw search terms, query again with BOTH filters, `campaign_search_term_insight.campaign_id = '<id>'` and `campaign_search_term_insight.id = '<non-zero category id>'`, then select `segments.search_term` and `segments.search_subcategory`. Drilldown on `id = "0"` errors.

**Operational implication:** for an account with N PMax campaigns, expect N per-campaign queries (plus drilldowns where warranted). If a skill needs this data, budget for the extra calls and reuse saved results where possible.

Other resources with similar single-resource filter requirements (verify before relying on broad queries): `landing_page_view`, some `*_insight` resources introduced after v21.

## `change_event` constraints

The `change_event` resource has the strictest query shape in GAQL. Every query must satisfy *all* of these or the API rejects it:

1. **`limit` is required** and must be 10,000 or less. Omitting it gives `changeEventError: LIMIT_NOT_SPECIFIED`.
2. **`change_event.change_date_time` needs both bounds**: a `>=` and a `<=` (or `BETWEEN`). A one-sided filter gives `CHANGE_DATE_RANGE_INFINITE`.
3. **30-day lookback and 30-day window.** Per the [official docs](https://developers.google.com/google-ads/api/docs/change-event): the date range must be within the past 30 days *and* the range itself can span at most 30 days. So both bounds must sit inside the last 30 days, and `(upper - lower)` is at most 30 days. Don't promise users older audit data than this; use `change_status` for a coarser, longer-lived view of what currently differs from a snapshot.
4. **About 3 minutes of propagation delay.** Recent changes can take up to three minutes to appear. Don't assume the absence of an event means it didn't happen if you're querying right after a suspected edit.
5. **Selectable fields are limited.** On `change_event` you can select `change_date_time`, `change_resource_name`, `change_resource_type`, `client_type`, `user_email`, `changed_fields`, `resource_change_operation`, `old_resource`, `new_resource`, plus the join keys (`campaign`, `ad_group`, `asset`, `feed`, and so on).
   - `change_event.campaign_budget` and `change_event.campaign_criterion` are **not** selectable: they aren't join keys on this resource.
   - You **cannot dot into** `old_resource` or `new_resource` in the SELECT clause. `change_event.old_resource.campaign_budget.amount_micros` gives `UNRECOGNIZED_FIELD`. These come back as whole messages; parse them in Python to read individual sub-fields.
6. **Filter by resource type, not by sub-resource join.** To scope to budget edits, use `change_event.change_resource_type = 'CAMPAIGN_BUDGET'`. To scope to a campaign, use `campaign.id = <id>` (campaign is a valid join key).

Canonical shape:

```sql
SELECT
  change_event.change_date_time,
  change_event.change_resource_type,
  change_event.change_resource_name,
  change_event.resource_change_operation,
  change_event.changed_fields,
  change_event.user_email,
  change_event.client_type,
  change_event.old_resource,
  change_event.new_resource
FROM change_event
WHERE change_event.change_date_time >= '2026-05-04 00:00:00'
  AND change_event.change_date_time <= '2026-05-13 00:00:00'
  AND campaign.id = 1234567890
  AND change_event.change_resource_type = 'CAMPAIGN_BUDGET'
LIMIT 1000
```

Then use Python to read `row["change_event.old_resource"]` and `row["change_event.new_resource"]` as objects (parse them with `json.loads` if they arrive as strings) and extract `campaign_budget.amount_micros`, `campaign_criterion.criterion_id` and so on.

## Impression share semantics

- `metrics.search_impression_share` is a fraction (0–1), not a percentage.
- Google returns `null` when volume is too low to report. Treat null as "not available" and exclude those rows from averages (in pandas, leave them as NaN, which `mean()` skips); don't treat them as zero.
- The same applies to `metrics.search_budget_lost_impression_share`, `metrics.search_rank_lost_impression_share` and the other share metrics.
- **Incompatible with `segments.date` on criterion-level resources.** `metrics.search_impression_share` on `FROM keyword_view` with any `segments.date` filter (explicit range or `DURING`) is rejected. The same behaviour was observed on `ad_group_criterion`. Pull impression share at `campaign` or `ad_group` level in a separate query, then join in Python on `(customer_id, campaign.id)` or `(customer_id, ad_group.id)`. Campaign-level impression share is usually more meaningful for downstream decisions anyway (auction headroom is a campaign-scope property).

## Channel-type filters

Filters like `campaign.advertising_channel_type = 'SEARCH'` can return zero rows for legitimate reasons (PMax-only accounts, Shopping-only accounts). **Zero rows is not "all good".** In your output, distinguish:
- "No Search campaigns in this account, nothing to check"
- "Checked N Search campaigns, all passed"

## GAQL syntax reminders

- **No `JOIN`.** Start FROM the lowest-granularity resource you need: `ad_group_ad` for ad level, `ad_group` for ad-group level, `campaign` for campaign level, `asset_group` for PMax.
- **No wildcards in SELECT.** Every field is listed explicitly.
- **Filters:** `=`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `NOT IN`, `LIKE`, `NOT LIKE`, `CONTAINS ANY`, `CONTAINS ALL`, `CONTAINS NONE`, `IS NULL`, `IS NOT NULL`, `BETWEEN`, `REGEXP_MATCH(field, 'pattern')`, `NOT REGEXP_MATCH(field, 'pattern')`.
- **String values in filters use single quotes:** `campaign.status = 'ENABLED'`, not `"ENABLED"`.
- **Date ranges:** prefer explicit dates in `YYYY-MM-DD`: `segments.date >= '2026-04-01' AND segments.date <= '2026-04-30'`, `BETWEEN '2026-04-01' AND '2026-04-30'`, or `segments.date = '2026-04-30'`. `DURING LAST_30_DAYS` works but may mis-resolve on non-UTC accounts; treat it as a fallback. Ranges must be finite.
- **Status filters matter:** without `campaign.status = 'ENABLED'` you'll also pull paused and removed campaigns. Usually not what you want.

## When rows come back unexpected

If a query returns a surprising shape (fewer rows than expected, missing fields), check:
1. Did you spell the field exactly right? Money fields are `*_micros` everywhere: there is no `metrics.cost`. Confirm the name with `get_resource_metadata` for that resource.
2. Is the entity status filter too narrow or too broad?
3. Is the date range valid, finite and non-empty, in `YYYY-MM-DD`?
4. Does the FROM resource support the fields you selected? (For example, you can't select ad-level fields FROM campaign.)
5. Is the `customer_id` digits only, and is `login_customer_id` set when the account sits under a manager?

Re-run with a minimal field list first to confirm rows exist, then add fields back one at a time. When the call raises a `ToolError`, the `Google Ads API Error` part of the message names the failing rule; fix that before retrying.
