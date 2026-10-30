---
name: google-ads-weekly-report
description: Write the weekly business review for a Google Ads account from live data, with a performance snapshot for the last complete Monday-to-Sunday week (weekly trend, WoW, YoY, month-to-date and year-to-date, plus channel and country breakdowns), root-cause investigation of the movements that matter, sized context from existing health-check results and findings, progress against targets, and decisions for next week. Use when the user asks for a weekly report, a WBR, a weekly summary, or how Google Ads did last week.
---

# Weekly business review

> Write this week's Google Ads WBR — performance snapshot from live data, root-cause investigation for meaningful variance, sized health-check context, and decisions for next week.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. Read `google-ads-write-gaql-queries` for conversion semantics, and `references/priority-tiers.md` for how urgent a health issue is.

## Goal

Produce one durable weekly business review at `ads/google/reports/week-YYYY-WNN.md` (the ISO year and week number of the reporting week, for example `week-2026-W17.md`). The report must be grounded in live account data, not just workspace files; must be sized (not a list of every failed check); and must answer the WBR questions through narrative, not as a labelled questionnaire.

**The report file is this skill's output: do not also write a finding.** This is the one exception to the one-finding-per-run rule in the conventions.

## Scope

Google Ads only. One report per run. Several accounts (for example under one manager account) can be in scope: the snapshot aggregates accounts that share a currency, and reports accounts in other currencies separately rather than converting them.

## Preconditions

- A Google Ads MCP is connected and the accounts in scope are known (`ads/google/index.md`).
- Live data is reachable. If the snapshot queries fail, say so and stop: do not write a file-only WBR. If some accounts fail and others succeed, name the failed accounts in the report.
- The reporting week is the last **complete** Monday-Sunday week. Never report on the current partial week.

## Inputs you need

1. **Live performance:** the snapshot queries in step 2. They are the primary source of truth. A report based only on files is incomplete.
2. **Conversion semantics:** read `google-ads-write-gaql-queries` before interpreting conversion metrics. Follow its conversion semantics (primary action vs all conversions, value vs count, etc.) and the primary conversion action rule in conventions section 3.
3. **Findings:** list `ads/google/findings/` and read recent ones for context, decisions, and prior investigations on whatever the snapshot surfaces.
4. **Health-check outputs:** list `ads/google/health/` (one file per check, written by the `google-ads-health-check` skill) and read the ones that materially affect spend, conversions, tracking trust, account safety, or budget delivery. Do **not** run `google-ads-health-check` here: read existing outputs only, and say how old they are. If the folder is empty or missing, say health context is missing.
5. **Objectives / targets:** read `ads/media-plan.md` and `ads/google/rules/*.md` for declared targets to compare against. If none exist, say targets are not configured and use observed trend only.
6. **What went live:** change history (step 2e), experiments, and launch plans in `ads/google/strategy/`.
7. **Memory:** read `ads/google/memory/MEMORY.md` so known exceptions aren't presented as news.

Run independent queries and file reads in parallel when possible.

## Procedure

### Step 1: Establish the reporting window

Use Python to compute the dates from today's date:
- **Reporting week:** the last complete Monday-Sunday week (end = the most recent Sunday before today; start = end − 6 days).
- **Previous week:** the 7 days before that; **weeks −2 to −4:** the three before that.
- **YoY week:** the reporting week shifted back 364 days, so weekdays line up.
- **Months:** the two complete calendar months before the month containing the reporting-week end (Month −2, Month −1), and **reporting month MTD** = first day of that month through the reporting-week end.
- **YTD:** 1 January through the reporting-week end; **YTD YoY:** 1 January of the previous year through the same calendar date a year earlier.

Do not report on the current partial week.

### Step 2: Build the performance snapshot first

Run these for each account in scope. Conversions use the primary conversion action when one is configured (a second query segmented by `segments.conversion_action_name`, joined on the same keys, as `google-ads-write-gaql-queries` describes); otherwise `metrics.conversions`.

**2a. Account daily totals**, from 1 January of the previous year through the reporting-week end (one row per day; this single query feeds every account-level bucket):

```sql
SELECT customer.descriptive_name, customer.currency_code,
  segments.date,
  metrics.cost_micros, metrics.impressions, metrics.clicks,
  metrics.conversions, metrics.conversions_value
FROM customer
WHERE segments.date BETWEEN '<prev_year_jan_1>' AND '<reporting_week_end>'
```

**2b. Channel daily rows** over the recent window (from the earlier of week −4's start and Month −2's start, through the reporting-week end):

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, campaign.name, campaign.advertising_channel_type,
  segments.date,
  metrics.cost_micros, metrics.clicks, metrics.impressions,
  metrics.conversions, metrics.conversions_value
FROM campaign
WHERE segments.date BETWEEN '<recent_start>' AND '<reporting_week_end>'
```

Plus three aggregated channel queries for annual context: the same query **without `segments.date` in the SELECT**, once each for YTD, YTD YoY and the YoY week. With the date only in `WHERE`, each row is the campaign's total over the range.

**2c. Country rows**, same windows as 2b (one daily query over the recent window, three aggregated ones):

```sql
SELECT customer.descriptive_name, customer.currency_code,
  campaign.id, geographic_view.country_criterion_id, geographic_view.location_type,
  segments.date,
  metrics.cost_micros, metrics.clicks, metrics.impressions,
  metrics.conversions, metrics.conversions_value
FROM geographic_view
WHERE segments.date BETWEEN '<recent_start>' AND '<reporting_week_end>'
```

Sum over both `location_type` values (presence and area of interest) for the country total. Resolve country names once:

```sql
SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code
FROM geo_target_constant
WHERE geo_target_constant.id IN (<country_criterion_ids>)
```

**2d. Compute the buckets in Python.** Load 2a, sum the per-day rows into each bucket from step 1 (weeks −4 to reporting week, YoY week, Month −2, Month −1, MTD, YTD, YTD YoY) per account and in total. For each bucket compute Spend, Conversions, Conversion value, CPA = spend / conversions, ROAS = value / spend, CTR = clicks / impressions, CPC = spend / clicks, Clicks, from the sums. Then WoW = (reporting − previous) / previous and YoY = (reporting − YoY week) / YoY week, undefined when the base is 0. Do the same per `campaign.advertising_channel_type` from 2b and per country from 2c, using the week, previous week, MTD, Month −1, YTD and YTD YoY buckets. Label weeks by their Monday ("Apr 13") and months by name ("Apr"). Save the script next to the data; the report cites it.

**2e. Change history and experiments** for "What went live":

```sql
SELECT change_event.change_date_time, change_event.change_resource_type,
  change_event.resource_change_operation, change_event.changed_fields,
  change_event.campaign, change_event.client_type
FROM change_event
WHERE change_event.change_date_time >= '<reporting_week_start>'
  AND change_event.change_date_time <= '<reporting_week_end> 23:59:59'
ORDER BY change_event.change_date_time DESC
LIMIT 10000
```

`change_event` only covers the last 30 days and needs a `LIMIT` of 10,000 or less. Summarise it in Python by campaign, resource type and operation (bid strategy, budget, status, keyword and ad changes) rather than listing rows.

```sql
SELECT experiment.name, experiment.type, experiment.status,
  experiment.start_date, experiment.end_date
FROM experiment
```

Preserve the historical context: recent complete weeks, WoW, YoY, recent months / month-to-date, year-to-date, and YTD YoY. Do not collapse the snapshot to only "reporting week and WoW" — short-term, mid-term, and annual context must all be visible.

The snapshot is the primary basis for everything that follows. Findings and health-check outputs are context; they do not replace the snapshot.

### Step 3: Spot meaningful variance

From the snapshot, identify the 2-4 most important movements at account / channel / country level. Materiality is judged by:

- Spend impact
- Conversion or conversion-value impact
- Whether it reverses or accelerates a recent trend
- Whether it crosses a declared target or threshold

Use Python to rank candidates: for each channel and country, compute the absolute WoW change in spend, conversions and conversion value, and its share of the account-level change in the same metric. Mark a movement as a trend reversal when its WoW direction is opposite to the direction across weeks −3 to previous, and as an acceleration when it continues that direction at a larger rate. Mark target crossings by comparing the reporting week with the targets from step 6. Print the top candidates; movements that don't pass these tests don't make it into the report.

### Step 4: Investigate root causes for meaningful variance

For each meaningful movement, walk the evidence trail with a hypothesis ledger: list the candidate causes, the evidence for and against each, and what would confirm or rule it out. When the symptom is Google Ads performance drift, prefer the `google-ads-diagnose-trend-drift` skill.

Live data first → findings → health checks → change history → investigation skills.

Separate confirmed causes from likely causes from unresolved questions in the report.

### Step 5: Size health-check impact before mentioning it

Read across `ads/google/health/`. For any check that's worth raising:

- Sized impact: affected spend, affected conversions, affected budget, tracking-trust impact, account-safety exposure
- Confidence in the impact
- Why it matters **this week** specifically

Do not promote a health check just because it failed. Low-impact failures are setup debt, not emergencies — roll them into one short paragraph after the main table.

For conversion-action health issues specifically: do not claim the WBR conversion totals are inflated or unreliable merely because a check failed. First determine whether the issue affects the **selected** KPI (`primary_conversion_action`), Smart Bidding, Google's raw conversion aggregate, or setup hygiene. If the selected conversion action exists and is unaffected, frame the issue as bidding-signal risk or setup debt — not as proof the snapshot is wrong. If no primary conversion action is configured, say the report is falling back to Google's aggregate conversion column and apply conversion-action-health caveats more strongly.

### Step 6: Compare against objectives

If the media plan or a per-group rule declares a target, compare actuals against it in Python (reporting week and MTD against the weekly or monthly share of the target; YTD against the plan to date) and say whether we're on track, ahead, behind, or missing. If no objective is declared, say targets are missing and use observed trend only.

### Step 7: Identify decisions for next week

Only decisions or actions supported by the snapshot, investigation trail, recent findings, or material health-check context. Each item must name the evidence that justifies it and the decision the team needs to make.

### Step 8: Write the report

Use the WBR template (below). Output path: `ads/google/reports/week-YYYY-WNN.md`. Length: 600-900 words. When the user is present, show the draft and write it when they agree; on an unattended run, write it directly. If a report for the same week exists, update it rather than writing a second one.

### Step 9: Share

Show the executive summary and the snapshot tables in the conversation. If the user wants to send the review to their team, offer a short digest they can paste into an email or chat:

1. Subject: the report's headline.
2. Open with a high-level snapshot: whether performance is improving, stable, or getting worse, and whether the account is on track, ahead, behind, or missing a declared target. If no target exists, say target tracking is not configured yet and use observed trend only.
3. Body: shorter than the full report. Short paragraphs, key numbers and movers inline, and the report's path at the bottom.

Never send anything yourself.

## WBR template

The report must answer these questions **through the narrative** — not as a questionnaire, checklist, or bullet list:

- How are we doing against objectives or targets, if they are set?
- How are we doing versus the previous complete week?
- How are we doing versus recent monthly / trailing 4-week context?
- Are there meaningful shifts by channel or country?
- If there are shifts, why did they happen?

### Structure

~~~markdown
# Weekly business review

Audience: Marketing lead and day-to-day account manager
Length: 600-900 words
Cadence: Weekly
Output: ads/google/reports/week-YYYY-WNN.md

## Executive summary

2-3 short paragraphs, not bullets. Open with the most important read from the last complete week. Weave in objective status, WoW movement, monthly / trailing context, channel or country shifts, and the likely reason for the shift. Do not use question labels like "How are we doing versus last week?" Do not lead with health-check failures unless their sized impact is material.

## Performance snapshot

**Mandatory.** If the report does not include aggregate, channel, and country tables, the report is incomplete.

Start with the date ranges:

- Reporting week: last complete Monday-Sunday week
- Short-term comparison: previous complete Monday-Sunday week
- Recent weekly context: last 4-5 complete weekly buckets
- Monthly context: recent month buckets and the current reporting month-to-date bucket
- Annual context: year-to-date and YoY context

### Account total

Two tables, from the account daily totals.

**Recent weekly trend** — rows: Spend, Conversions, Conversion value, CPA, ROAS, CTR, CPC, Clicks (when available).

| Metric | Week -4 | Week -3 | Week -2 | Previous week | Reporting week | WoW | YoY |

Use real week labels ("Apr 13", "May 11") instead of generic labels.

**Monthly and annual context** — same rows.

| Metric | Month -2 | Month -1 | Reporting month MTD | YTD | YTD YoY |

Use real month labels ("Mar", "Apr", "May"). Source directly underneath each table.

### Channel breakdown

Use the per-channel buckets as analysis input. Do **not** reproduce every metric for every channel — the WBR publishes a compressed read.

Include only:

- Top spend or conversion contributors
- Any channel with material movement
- Any channel that went to zero or restarted
- Any channel that explains the account-level story

| Channel | This week | WoW | Monthly context | Annual context | Read |

Cell guidance:

- **This week:** compact KPI bundle, e.g. "€1.9K / 975 conv. / €2.00 CPA" or "€1.9K / 41.8x ROAS" depending on the account's primary KPI
- **WoW:** the meaningful movement, not every metric. Example: "spend flat, conv. +33%, CPA -26%"
- **Monthly context:** reporting month MTD vs previous complete month. Example: "May MTD €5.1K / 1.9K conv.; below Apr volume"
- **Annual context:** YTD and YoY only when it adds useful seasonal or scale context. Example: "YTD €35.4K, spend -9% YoY"
- **Read:** one sentence explaining what the channel means for the week

Sort by reporting-week spend descending. Roll the long tail into a short sentence after the table if it does not materially change the read. Source underneath.

### Country breakdown

Use the per-country buckets. Same compression rule as Channel.

Include only:

- Top spend or conversion contributors
- Any country with material movement
- Any country that went to zero or restarted
- Any country that explains the account-level story

| Country | This week | WoW | Monthly context | Annual context | Read |

Same cell guidance as Channel. Sort by reporting-week spend descending. Source underneath.

## Performance against objective and recent trend

Prose, at most one short supporting bullet list. Do not repeat the WBR questions as headings or labels.

Cover:

- Whether we are on track against the objective, media plan, or target (if one exists)
- What changed vs the previous complete week
- What changed vs recent monthly / trailing 4-week context
- Which channel or country shifts explain the change
- Why those shifts likely happened

If no objective is declared, say targets are missing, then use the snapshot to assess recent trend and directional health.

## Meaningful changes

Pick the 2-4 most important movements from the snapshot. Do **not** start from health-check failures. For each movement:

- What moved
- Where it moved: account total, channel, country, or named campaign group
- Magnitude: spend, conversions, CPA, ROAS, or conversion value
- Short-term, mid-term, or both
- What recent findings or investigations say about it, if any
- Why it likely moved, using the hypothesis ledger when root cause matters

Separate confirmed causes from likely causes and unresolved questions.

## Health issues needing attention

Requires reading `ads/google/health/`. Also check `ads/google/findings/` for already-investigated versions of the same issues.

Do not write a long list of failed checks. Summarize only checks that materially affect spend, conversions, budget delivery, tracking trust, account safety, or next-week decisions.

| Issue | Status | Sized impact | Confidence | Why it matters this week |

For sized impact: affected spend, affected conversions, affected budget, account-safety exposure, or tracking-trust impact. If impact cannot be sized, say "unknown" and do not use urgent language unless the issue blocks reporting trust or account safety.

Treat low-impact failures as setup debt, not emergencies, unless they explain a broader performance pattern. Roll setup debt into one short paragraph after the table.

## What went live

Launches, experiments, campaign changes, recommendations, or notable account changes from the reporting period.

| Change | Date | Scope | Expected effect | Early read | Source |

If no reliable change history or experiment log is available, say went-live context is missing. Do not infer launches from performance movement alone.

## Decisions for next week

Only decisions or actions supported by the snapshot, investigation trail, recent findings, or material health-check context. Each item names the evidence that justifies it and the decision the team needs to make.
~~~

## Evidence-forcing rules

- Every numeric claim in the snapshot must trace to a specific query and the Python output computed from it. Cite the source directly underneath each table (query, accounts, date range, and the path of the saved analysis script).
- Every cause attribution must trace to live data, a finding, a health-check file, or a change-history row. "Probably because" without an evidence pointer is rejected.
- Health-check claims about tracking quality must distinguish selected KPI vs Google's aggregate vs setup hygiene before being escalated.
- If live data fails, say so explicitly and stop. Do not silently fall back to file-only reporting.
- If findings or health-check files cannot be read, say context is missing rather than skipping it.

## Output

One report file at `ads/google/reports/week-YYYY-WNN.md`. No finding.

## What this skill is not

- **Not** a fresh health-check run. Reads existing outputs only; never runs `google-ads-health-check`.
- **Not** a campaign-level audit. Audits live in the `google-ads-audit-*` skills and the per-domain `google-ads-check-*` skills.
- **Not** an opportunity-discovery report. That belongs in `google-ads-find-new-opportunities` and `google-ads-find-scale-candidates`.
- **Not** a findings tracker. Findings are referenced for context, not duplicated as report content.
