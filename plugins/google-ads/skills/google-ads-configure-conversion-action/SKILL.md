---
name: google-ads-configure-conversion-action
description: Choose and save the Google Ads conversion action that reports and analyses treat as the primary KPI (purchase, qualified lead, booked call, signup), stored as primary_conversion_action in ads/google/index.md. Use when the user asks which conversion to report on, says reports mix every conversion action, wants to change the primary KPI, or when another skill notes the primary action isn't configured. For designing the full conversion spec (primary and secondary events, values, tracking risks) use google-ads-conversion-tracking.
---

# Configure conversion action

> Choose the Google Ads conversion action to use as the primary KPI in reports, weekly updates, and performance analysis.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Section 3 there describes the `primary_conversion_action` setting this skill writes.

## Goal

Set the account's primary conversion action intentionally. Reports should not silently mix every conversion action when the business really cares about one outcome, such as purchases, qualified leads, booked calls, or signups.

This is a setup skill, not a performance audit. With the user present, help them pick and save the setting. In an unattended run, write a finding only when the primary action is missing, ambiguous, or likely wrong; otherwise end with a short `status: ok` finding.

## Scope

Google Ads only. The saved setting lives in `ads/google/index.md` as `primary_conversion_action: <name>`, or `primary_conversion_action: all` when the user deliberately reports on every action. The value is the conversion action **name**, matched against `segments.conversion_action_name`, so one setting covers every account in scope that uses that name. This skill does not change anything in Google Ads (the MCP is read-only); it changes which action the other skills judge performance on.

## Inputs

1. **Current setting:** read `ads/google/index.md`. Note the current `primary_conversion_action`, if any, and the accounts in scope.
2. **Available actions:** run the two queries below for each account in scope before recommending anything.
3. **Business context:** read `wiki/company.md` if the right action is not obvious from action names and volume.

### Query A: enabled conversion actions

```sql
SELECT
  customer.descriptive_name,
  conversion_action.id,
  conversion_action.name,
  conversion_action.status,
  conversion_action.category,
  conversion_action.type,
  conversion_action.primary_for_goal,
  conversion_action.include_in_conversions_metric,
  conversion_action.counting_type
FROM conversion_action
WHERE conversion_action.status = 'ENABLED'
```

### Query B: recent volume per action

Use the last 30 days ending yesterday.

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  segments.conversion_action_name,
  segments.date,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE segments.date BETWEEN '<start>' AND '<end>'
```

Use `metrics.all_conversions`, not `metrics.conversions`: secondary actions only appear in the all-conversions columns, and the candidates should be compared on equal terms.

### Analysis

Use Python to build one candidate table:

- From query B, group by `segments.conversion_action_name` (across accounts, since the setting is a name) and sum `all_conversions` and `all_conversions_value`. Also compute `active_days` (distinct dates with `all_conversions > 0`) and `last_conversion_date` (latest such date).
- From query A, collapse to one row per `conversion_action.name` with its `category`, `type`, `counting_type`, whether it is `primary_for_goal` in any account, and the list of account names that have it.
- Left-join A to B on the action name, so enabled actions with no recent volume stay in the table with zero conversions.
- Print the table sorted by 30-day conversions descending: name, category, primary_for_goal, counting_type, accounts, conversions, value, active_days, last_conversion_date.

## How to choose

Prefer the deepest reliable business outcome with enough recent volume:

| Business type | Usually prefer | Usually avoid as primary |
|---|---|---|
| Ecommerce | Purchase, transaction, sale | Page view, add to cart |
| Lead gen | Qualified lead, booked call, demo request | Page view, newsletter signup |
| Self-serve SaaS | Paid signup, activation, trial start | Generic signup if activation exists |
| Local services | Call, form lead, booking | Direction click, page view |

Use recent conversion volume as evidence, not as the only criterion. A shallow action with high volume can be worse than a deeper action with lower but stable volume. `active_days` from the table is the stability evidence: an action that converts on most days of the window is more reliable than one with the same total in a few bursts.

## Flow with the user present

1. Run the queries and build the candidate table.
2. Summarise the top 3–5 candidates in plain language:
   - Action name
   - Recent volume
   - Why it may or may not be the right KPI
3. Recommend one action. If no action is safe to recommend, say what is missing.
4. Ask the user to confirm.
5. On confirmation, write `primary_conversion_action: <name>` to `ads/google/index.md` (create the file if it doesn't exist, and keep every other line in it unchanged).
6. If the user wants all actions included, confirm the tradeoff (reports will mix shallow and deep outcomes, and CPA will look lower than the business outcome costs), then write `primary_conversion_action: all`.

## Unattended run

Don't edit `ads/google/index.md`. Write a finding (`category: tracking`, `kind: recommendation`, `status: pending`) when:

- `primary_conversion_action` is not set;
- it is set to a name that no enabled action in the accounts in scope has, or that had zero conversions in the window;
- it is set to an action the "Usually avoid as primary" column describes while a deeper action from the "Usually prefer" column has recent volume;
- several enabled actions share the name with different categories across accounts (ambiguous).

Put the candidate table in the finding and the proposed `index.md` line in its recommendations. Otherwise write a `status: ok` finding that names the configured action, its 30-day volume and the accounts it covers.

## Output

Keep the recap short:

- Selected conversion
- Why it was chosen
- What reports will use it for
- Any caveat, such as low volume or naming ambiguity

Do not show API field names, resource IDs, or implementation details in the recap.
