---
name: google-ads-conversion-tracking
description: Research the business and its Google Ads conversion setup, recommend which events should be primary and secondary conversions and what value each should pass, and write the conversion tracking brief to ads/google/conversion-tracking.md for a coding agent to implement. Use when the user asks what they should track as a conversion, whether their Google Ads conversion setup fits the business, how to set up conversion values, or wants to audit conversion tracking before code work. For inspecting and implementing the tracking code in a repo use google-ads-setup-tracking; for only picking the reporting KPI use google-ads-configure-conversion-action.
---

# Audit conversion tracking

> Research the business and its Google Ads setup, recommend a conversion spec, then hand codebase inspection and implementation to the user's coding agent.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The recommendation draws on `references/conversion-tracking-worldview.md` and `references/conversion-anti-patterns.md`; the steps below name the other references at the point they're needed.

## Goal

Create the conversion tracking brief before code work begins. The brief should explain what should count as primary and secondary Google Ads conversions, why those events fit the business model, what value should be passed, and what the coding agent should inspect or implement.

Use only the conversion-relevant business model:

- **B2C ecommerce**
- **B2C growth**
- **B2B self-serve**
- **B2B sales-led**
- **B2B hybrid:** only when the same B2B business has both self-serve and sales-led paths.

Write the approved brief to:

```text
ads/google/conversion-tracking.md
```

## Workflow

### 1. Research

If no Google Ads MCP is connected, ask the user to connect one (conventions section 1) and stop.

If it is connected, gather:

- Business context from the workspace: `wiki/company.md` and any other `wiki/` pages on the product, pricing, funnel and go-to-market.
- Existing `ads/google/conversion-tracking.md`, if present (see Review mode).
- Current Google Ads conversion actions, recent volume, primary/secondary status, source/type, value settings, attribution settings, and recent conversion value (queries A and B).
- Account setup signals where available: auto-tagging, GA4 link/import posture, enhanced conversions, consent mode, offline uploads, and cross-domain risks (query C, plus what the user tells you).
- Campaign, landing-page, feed, checkout, subscription, CRM, or product-funnel context needed to classify the conversion model. Ask the user for anything the workspace and account don't show.

Run these for each account in scope.

**Query A: conversion action configuration**

```sql
SELECT
  customer.descriptive_name,
  conversion_action.id,
  conversion_action.name,
  conversion_action.status,
  conversion_action.type,
  conversion_action.category,
  conversion_action.origin,
  conversion_action.primary_for_goal,
  conversion_action.include_in_conversions_metric,
  conversion_action.counting_type,
  conversion_action.value_settings.default_value,
  conversion_action.value_settings.default_currency_code,
  conversion_action.value_settings.always_use_default_value,
  conversion_action.attribution_model_settings.attribution_model,
  conversion_action.click_through_lookback_window_days
FROM conversion_action
WHERE conversion_action.status != 'REMOVED'
```

**Query B: volume and value per action, last 30 days ending yesterday**

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

**Query C: account-level tracking settings**

```sql
SELECT
  customer.descriptive_name,
  customer.auto_tagging_enabled,
  customer.tracking_url_template,
  customer.conversion_tracking_setting.conversion_tracking_status,
  customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled,
  customer.conversion_tracking_setting.accepted_customer_data_terms
FROM customer
```

Use Python to turn A and B into one table per account:

- From B, group by `(customer_id, segments.conversion_action_name)` and sum `all_conversions` and `all_conversions_value`; add `active_days` (distinct dates with conversions) and `last_conversion_date`.
- Left-join to A on `(customer_id, conversion_action.name)` so configured actions with no recent volume stay visible.
- Add `value_per_conversion = all_conversions_value / all_conversions` and a `value_flat` flag when `always_use_default_value` is true or every conversion carries the default value (value per conversion equals `default_value`).
- Flag GA4 imports (`type` starting with `GOOGLE_ANALYTICS_4`), offline imports (`type` such as `UPLOAD_CLICKS` or a CRM import type), and website tags (`WEBPAGE`, `WEBPAGE_CODELESS`).
- Print, per account: action name, type, category, primary_for_goal, counting_type, attribution model, 30-day conversions, value, value per conversion, value_flat, active_days, last_conversion_date. Sort primary actions first, then by conversions.

Settings the API doesn't expose reliably (enhanced conversions for web, Consent Mode, cross-domain setup, whether GA4 is linked when no GA4 action exists) go into the brief as "to verify" items for the coding agent rather than as findings.

### 2. Recommend

Share a recommendation for review before writing files. Keep it concise and specific:

- The likely conversion model.
- Recommended primary conversion(s).
- Recommended secondary conversion(s).
- Recommended value model.
- Why these metrics are better bidding/reporting signals than the alternatives.
- What will happen next after approval.

Use this decision model:

| Conversion model | Prefer as primary | Usually secondary | Value model |
| --- | --- | --- | --- |
| B2C ecommerce | Purchase, order, booking, or other completed transaction | View item, add to cart, begin checkout, lead capture, newsletter signup | Dynamic order value; include currency and transaction/order ID |
| B2C growth | Activation, subscription start, paid signup, retained activation, or another event tied to the growth equation | Install, signup, trial start, onboarding step, first key action | LTV, plan, cohort, or activation-quality proxy |
| B2B self-serve | Activation, trial start, paid signup, or purchase | Signup and earlier funnel events | Dynamic revenue when known; otherwise plan-tier or LTV proxy |
| B2B sales-led | Qualified lead, demo booked, CRM MQL/SQL, opportunity, or closed-won upload | Raw form submit, content download, lead-form event | Expected value: close rate x average contract value |
| B2B hybrid | One self-serve primary and one sales-led primary | Funnel events for each path | Separate values per path; avoid flat values across unlike events |

Prefer the deepest reliable signal with enough volume. For what "enough volume" means per campaign type, use the conversion floors in `references/learning-phase-thresholds.md`, compared against the 30-day counts from step 1. When volume is too low, move one step earlier in the funnel and pass value or quality signals so Smart Bidding can still learn.

If the recommended primary is an earlier event because the deeper event lacks volume, document the upgrade path: current primary, target primary, upgrade condition, and review cadence.

For ecommerce, anchor the recommendation in purchase value. For consumer growth, anchor it in activation, retention, and LTV. For B2B, anchor it in either self-serve activation or sales-led qualification and pipeline quality. When the value isn't obvious from research, ask the questions in `references/value-elicitation.md`. For the attribution stance, follow `references/attribution-models.md`.

Ask the user to confirm or correct the recommendation.

### 3. Save the brief

After confirmation, write `ads/google/conversion-tracking.md`. Fill the identifier, risk and platform sections using `references/identifier-persistence.md`, `references/consent-mode-v2.md`, `references/offline-conversion-failures.md` (sales-led and hybrid) and `references/source-of-truth-cross-check.md`; each has a "What to put in the brief" section.

```markdown
# Google Ads conversion tracking

## Research summary
- Conversion model:
- Primary planning metric:
- Evidence:
- Existing Google Ads setup:

## Recommended conversion spec

### Primary conversions
| Path | Event | Trigger | Value model | Why |
| --- | --- | --- | --- | --- |

### Secondary conversions
| Path | Event | Trigger | Why |
| --- | --- | --- | --- |

### Upgrade path
- Current primary:
- Target primary:
- Upgrade condition:
- Review cadence:

### Attribution and value
- Attribution stance:
- Value model:
- Enhanced conversions:
- Offline conversion uploads:

### Identifier requirements
- gclid / gbraid / wbraid:
- UTMs:
- transaction_id / order_id / deal_id:
- user data for enhanced conversions:

### Tracking risks to verify
- Event fires on the correct trigger:
- No duplicate client/server firing without deduplication:
- Value and currency populated:
- Server-side tracking needed:
- Consent mode:
- Cross-domain or redirect loss:

## Google Ads platform status

## Implementation brief for the coding agent
- Server-side tracking to inspect or implement:
- Client-side tracking to inspect or implement:

## Current implementation status
To be completed by the coding agent.

## Validation log
To be completed by the coding agent.

## Remaining fixes
To be completed by the coding agent.
```

Under "Google Ads platform status", list each account's actions from the step 1 table (name, type, primary or secondary, 30-day volume, value per conversion, attribution model) and the query C settings, and say which actions should change status or value settings to match the spec. The Google Ads MCP is read-only, so these are changes the user makes in Google Ads.

If the recommended primary differs from `primary_conversion_action` in `ads/google/index.md`, offer to update it (the `google-ads-configure-conversion-action` skill covers that choice in more depth).

Also write the run's finding (conventions section 4, `category: tracking`, `kind: recommendation`): the wrap-up names the conversion model and recommended primary, the recommendations table lists the Google Ads changes, and the body points to `ads/google/conversion-tracking.md`.

### 4. Hand off to the coding agent

After saving the brief, give the user a single copyable prompt for the coding agent (Claude Code, Cursor, Codex or similar) they use in the product's repository. It needs this skill collection installed and access to the workspace folder; if the workspace lives outside that repository, tell the user to give the agent its path or copy the brief into the repo.

**Message to the user (adapt the path to where the workspace lives):**

````markdown
The brief is saved at `ads/google/conversion-tracking.md` in the marketing workspace. To hand off implementation, open the product's repository in your coding agent and paste this:

```text
Read the conversion tracking brief at `<workspace>/ads/google/conversion-tracking.md`.

Then run the `google-ads-setup-tracking` skill to inspect this repo, set up any missing conversion tracking, validate what you can, and write the results back into the brief's "Current implementation status", "Validation log" and "Remaining fixes" sections.
```
````

If the user's coding agent can't read the workspace or doesn't have the skill installed, acknowledge the blocker and offer to walk through the tracking spec manually in the conversation instead. Don't push them to retry without addressing the underlying problem.

## Review mode

If `ads/google/conversion-tracking.md` already exists, offer two options: review the existing doc, or start from scratch. If the user starts from scratch, keep the existing doc as context but rerun research and recommendation before writing a replacement.

If the user chooses review and the doc contains implementation status from the coding agent's run, summarise:

- Chosen conversion model, primary conversion(s), and value model.
- What exists in the codebase.
- Missing, broken, or partial tracking.
- Validation results.
- Highest-priority remaining fix.

If implementation status is still empty, continue with research and recommendation.

In an unattended run, don't overwrite the brief; review it against fresh query results and put any drift (a primary action that stopped converting, a value that went flat, a new action that isn't in the spec) in the finding.

## Hand-off contract

This skill produces the brief. The `google-ads-setup-tracking` skill, run by a coding agent in the product's repository, handles:
- Codebase inspection (where events fire, what payload ships, gclid capture/persistence)
- Implementation (writing/fixing client-side and server-side tracking, enhanced conversions hashing, offline upload webhooks)
- Validation (GA4 DebugView, Tag Assistant, test conversion, network intercept)
- Updating the brief's `Current implementation status`, `Validation log` and `Remaining fixes` sections, and writing `ads/google/tracking-status.md`

Don't try to do its job here. If the user asks for code-level fixes during the recommendation phase, point them at the hand-off prompt.
