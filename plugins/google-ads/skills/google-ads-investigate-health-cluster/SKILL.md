---
name: google-ads-investigate-health-cluster
description: Investigate one cluster of related Google Ads health-check results, size its impact, find the likely root cause with a hypothesis ledger, and write one evidence-backed finding. Use when google-ads-triage-health-checks hands over a cluster, or when the user asks why a group of Google Ads health checks is failing or wants the root cause behind a specific health-check result. To decide which clusters deserve an investigation use google-ads-triage-health-checks.
---

# Investigate health cluster

> Turn one important Google Ads health-check cluster into a durable, evidence-backed finding. Use this when health-check triage hands you a cluster.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## What you're doing

You are the root cause analysis step for one health-check cluster. The triage run already decided the cluster may matter. Your job is to verify impact, investigate likely cause where the data supports it, and create or update exactly one finding unless the cluster is not actionable.

Do not send any message or email. The digest is written by `google-ads-triage-health-checks` after all sibling investigations finish.

## Inputs

Read your brief first. When triage started you, it is in `ads/google/analyses/health-triage-YYYY-MM-DD.md` (or in your instruction) and includes:

- `cluster_key` (for example `google-ads:tracking-reliability`)
- health-check IDs
- evidence paths
- the triage framing, including the exposure it sized

When the user asks directly instead, build the brief yourself: the check IDs they name (or the non-ok checks on the topic they name), a `cluster_key` of the form `google-ads:<topic>`, and the matching health files as evidence paths.

Then read:

1. The listed health files in `ads/google/health/`. If one is missing, or its `checked` date is more than 7 days before today, run `google-ads-health-check` in targeted mode for those check IDs first, then read the fresh files.
2. Recent `ads/google/findings/` entries for dedupe and context, plus any finding of any age whose frontmatter carries the same `cluster_key`.
3. `wiki/company.md` if business context would change how you size impact.
4. Relevant memory under `ads/google/memory/` when a prior decision or acknowledgement may affect the recommendation.
5. `ads/google/index.md` for the accounts in scope, `primary_conversion_action` and `brand_terms`.

## Method

### Size first

Start with sizing before diagnosis. A health check is not automatically urgent because it failed. Estimate whether the cluster materially affects at least one of:

- spend
- conversions or conversion value
- budget delivery
- selected KPI trust
- Smart Bidding signal quality
- account safety
- a meaningful performance movement
- a current scaling objective

Use Python to size it: load the offending-items tables from the health files (markdown tables, split on `|`), join them on `(account, campaign)` across the cluster's checks, and sum spend, conversions and conversion value for the affected entities over the window each file states. Where the files lack a number you need (for example the affected campaigns' share of account spend, or conversions before and after the date the status changed), query it fresh through the MCP for the same entities and window, and compute the share or change in Python: share = affected cost / account cost, change = (current - baseline) / baseline. Print the sized exposure per account in its currency.

Use `google-ads-write-gaql-queries` before writing custom Google Ads queries or interpreting conversion metrics. Treat the `primary_conversion_action` as the KPI unless the selected action itself is affected. Conversion-action health issues can still be serious as Smart Bidding or setup debt, but they do not automatically invalidate primary-conversion reporting.

### Find the cause with a hypothesis ledger

If a domain-specific skill fits, use it as well: for example `google-ads-diagnose-trend-drift` for performance drift. Whatever skill you use, run the investigation as a hypothesis ledger, so the first plausible cause doesn't become the answer by default:

1. **List 3 to 5 competing hypotheses** for the cluster's symptom. Typical ones: a tracking or tag change, a conversion action setting change, a budget or billing limit, a policy or disapproval wave, a bid strategy or target change, a landing page change, a structural change (campaigns paused, merged or launched), seasonality or demand. Mark any that can't apply here as `N/A` with the reason; keep them in the ledger.
2. **Give each one a falsifiable probe:** a specific query, file read or metric delta, with the result that would reject it stated up front ("if conversions for the primary action fell more than 25% against the prior 14 days starting on the date `conversions-flowing` turned red, H1 is supported; if flat, rejected"). "Check whether X looks high" is not a probe.
3. **Run every probe,** not just until the first match. Independent queries and file reads can run together. `change_event` (last 30 days, `LIMIT` 10000 or less) is the usual probe for "what changed on that date". Do the comparisons in Python.
4. **Temporal evidence rule.** Current state is not evidence about past state. "This setting is wrong now" doesn't show it was wrong on the date the symptom started. A hypothesis bounded by a date needs dated evidence (change history, segmented-by-date metrics); without it the probe did not run, so mark it `deferred` and name what would unblock it.
5. **Classify each hypothesis** as exactly one of: `confirmed` (the probe supports it and nothing contradicts it), `rejected` (the probe disconfirms it), `inconclusive` (mixed or noisy), `deferred` (couldn't run; say what would unblock it), `N/A` (ruled out by another hypothesis; name which).
6. **Land on the cause:** the confirmed hypothesis. Several confirmed means a compound cause; say so. None confirmed and all rejected means the list missed the cause: say that and recommend a deeper look. Some inconclusive means "narrowed to A or B, here's what would disambiguate."

**Confidence.** One strong probe and nothing contradicting is high. A supporting probe with another hypothesis still inconclusive is medium. A cause that fits but a ledger that may not cover the real cause is low. Never overstate the trail.

Skip the ledger only when the cluster is pure setup debt with no "why" to answer (for example a setting that is simply missing); then size it and recommend the fix.

## Finding behavior

Create or update exactly one finding for the cluster, following conventions section 4, with `skill: google-ads-investigate-health-cluster` and an extra frontmatter field `cluster_key: <cluster_key>`:

- If a `pending` finding with the same `cluster_key` already exists, refresh it: append a dated `## Update YYYY-MM-DD` section with the new sizing and ledger, and update the title and summary if the picture changed.
- If the user previously declined a finding with the same `cluster_key` (its status was changed to something other than `pending` or `ok`, or memory records the decision), only reopen it by creating or updating when the impact has materially escalated, and say what escalated.
- If the cluster is not actionable, do not create a new `pending` finding. If useful, create or update an `ok` finding that records what was checked and why it is not material.

Use `kind: anomaly` when the cluster is a change in performance, delivery or tracking, and `kind: audit` when it is standing setup debt. Pick `category` from the conventions list for where the cause sits (`tracking`, `budget`, `bids`, `creative`, `keywords`, `structure`).

## Finding body

The finding must include:

- Symptom.
- Sized impact, citing the health files and the numbers from your Python output (name the query, accounts and window behind each fresh number).
- Likely root cause, or a clear statement that root cause is deferred.
- Hypothesis/evidence table when root cause analysis was needed:

  | Hypothesis | Status | Evidence |
  |---|---|---|
  | H1: <short name> | rejected | primary-action conversions flat across the window (Python output, 14 days vs prior 14) |
  | H2: <short name> | **confirmed** | conversion action set to secondary on 2026-10-21 (`change_event`), the day [conversions flowing](ads/google/health/conversions-flowing.md) turned red |
  | H3: <short name> | deferred | needs landing page deploy history |

- Confidence.
- Recommended next action, as a table the user can act on (entity, current value, proposed value, reason). The MCP is read-only; the user applies the change.
- Links to the source health files and, for fresh numbers, the scratch path of the saved query results and analysis script.

Lead the wrap-up with the confirmed cause, not the symptom: "The purchase action was switched to secondary on 21 October" rather than "CPA up 38%".

Format every workspace file citation as a markdown link with a plain relative path, for example `[conversion action health](ads/google/health/conversion-action-health.md)`. Do not leave bare file paths in prose. Do not cite dashboards for finding data. A claim you can't tie to a file or to your Python output didn't really get checked: mark that hypothesis `deferred`.

If the issue cannot be investigated with available data, write or update the finding with:

- what was confirmed
- what could not be checked
- what evidence is missing
- the next best manual or automated step

## Output rules

- Do not send any message or email.
- Do not create multiple findings for one cluster.
- Do not re-run the whole health-check battery; at most re-run the cluster's own checks when their files are missing or stale.
- Do not overstate setup debt as performance impact unless you have sized the KPI, spend, delivery, or bidding effect.
- Use sentence case in headings unless a product name or acronym requires capitals.
