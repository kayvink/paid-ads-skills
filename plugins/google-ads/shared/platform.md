# Platform: Google Ads

Platform slug: `google`. This platform's workspace files live under `ads/google/`.

## Getting data: the Google Ads MCP

These skills assume a Google Ads MCP server is connected. The reference setup is Google's official server, [googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp), which exposes:

| Tool | Use it for |
|---|---|
| `list_accessible_customers` | The account IDs and names the user can read. Run it first. |
| `search` | Run one GAQL query against one account. Takes `customer_id`, `fields`, `resource`, `conditions`, `orderings`, `limit`, optional `login_customer_id`. |
| `get_resource_metadata` | The selectable, filterable and sortable fields of a resource. Use it whenever a field name is in doubt instead of guessing. |

Any other Google Ads MCP that can run GAQL works too; adapt the call shape to its tool.

**Translating the GAQL in a skill into a `search` call.** Skills write full queries. Split them like this:

| GAQL part | `search` argument |
|---|---|
| `SELECT a, b, c` | `fields: ["a", "b", "c"]` |
| `FROM resource` | `resource: "resource"` |
| `WHERE x AND y AND z` | `conditions: ["x", "y", "z"]` (each `AND` clause becomes one entry; keep `OR` groups inside one entry, in parentheses) |
| `ORDER BY m DESC` | `orderings: ["m DESC"]` |
| `LIMIT n` | `limit: n` |

**Accounts.** One `search` call reads one account. Unless the user names specific accounts, run each query for every account `list_accessible_customers` returns that the user wants in scope (ask once, then record the answer in `ads/google/index.md`). Accessing client accounts through a manager (MCC) account needs `login_customer_id` set to the manager ID. Treat `(customer_id, entity_id)` as the unique key for any entity: IDs can repeat across accounts. If some accounts fail and others succeed, say which ones failed in the output; never report "all clear" on a subset.

**Always select `customer.descriptive_name` and `customer.currency_code`** so every row carries the account name and currency. Refer to accounts by name, not by customer ID, in everything you write. Format money in each account's own currency.

**Rows.** `search` returns a list of flat dicts keyed by the full GAQL field path (`"campaign.id"`, `"metrics.cost_micros"`), with enums as their string names (`"ENABLED"`), so `pd.DataFrame(rows)` loads them directly.

**Money fields are in micros.** `metrics.cost_micros`, `campaign_budget.amount_micros`, `metrics.average_cpc`, `metrics.cost_per_conversion` and similar come back in millionths of the currency unit. Divide by 1,000,000 before reporting. In `WHERE` clauses, multiply currency thresholds by 1,000,000.

**Dates.** Prefer explicit ranges (`segments.date BETWEEN '2026-04-01' AND '2026-04-30'`) over `DURING LAST_30_DAYS`: the constants resolve in UTC and can drop a day on accounts in other time zones. Any query that selects `metrics.*` needs a `segments.date` condition. A date range with `segments.date` selected returns one row per entity per day; GAQL has no `GROUP BY` or `SUM`, so totals are computed in the analysis step.

**Read-only.** The official server cannot change anything in the account. Skills recommend; the user applies. Present proposed changes as a table the user can act on (entity, current value, proposed value, reason). Never say a change was made.

For GAQL syntax, field compatibility and API gotchas, use `google-ads-write-gaql-queries`.

## Platform settings in `ads/google/index.md`

- **Accounts in scope** and the manager (MCC) ID, if any.
- **Primary conversion action:** `primary_conversion_action: <name>` (or `all` when the user deliberately reports on every action). When it is set, skills judge performance on that action: query `metrics.conversions` segmented by `segments.conversion_action_name` and filter to it, and keep `metrics.all_conversions` for the full funnel. When it is not set, use `metrics.conversions` and note that the primary action isn't configured (`google-ads-configure-conversion-action` sets it).
- **Brand terms:** `brand_terms: [acme, acme shop]`. Skills use them to split brand from non-brand traffic: a search term or keyword is brand when it contains any brand term, case-insensitive. When the list is missing, propose one from the account name, the domain in final URLs and campaign names containing "brand", and confirm it with the user before relying on it.

## Google Ads files in the workspace

| File | Purpose | Written by |
|---|---|---|
| `ads/google/index.md` | Accounts in scope, primary conversion action, brand terms | `google-ads-configure-conversion-action`, first run of any skill |
| `ads/google/rules/<group>.md` | Targets and thresholds per campaign group | `google-ads-create-channel-rules` |
| `ads/google/health/` | Per-check results | `google-ads-health-check` |
| `ads/taxonomy.md` | Naming and UTM schema the audits validate against | `google-ads-check-naming-convention`, `google-ads-check-utm-tagging`, user |
| `ads/media-plan.md` | What spend is supposed to do | `google-ads-create-media-plan` |
