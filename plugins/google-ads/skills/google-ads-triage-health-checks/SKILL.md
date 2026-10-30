---
name: google-ads-triage-health-checks
description: Read the latest Google Ads health-check result files, size and cluster the issues that matter, and hand each important cluster to a root cause investigation. Use when the user asks which health-check failures matter, to triage or follow up on a health check, or after google-ads-health-check finishes in a scheduled run. Each cluster is investigated with google-ads-investigate-health-cluster; to run the checks themselves use google-ads-health-check.
---

# Triage health checks

> Read the latest Google Ads health-check files, cluster what matters, and start root cause analysis investigations. Run it after each health-check run.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## What you're doing

The `google-ads-health-check` skill writes one markdown file per check under `ads/google/health/`. Your job is to decide which issues are important enough to investigate, cluster related symptoms, and hand each cluster to `google-ads-investigate-health-cluster`.

You are the promoter, not the investigator. Do not write root cause analysis findings yourself. Each cluster's investigation writes its own finding; once they are all done, you write one digest finding that points at them.

If there are no important clusters, write a short all-clear digest instead.

## Check the health files are current

1. List `ads/google/health/` (skip the `.<check-id>.log.md` history files).
2. If there are no health files, or the newest `checked` date in their frontmatter is more than 7 days before today, the results are too old to triage. Run `google-ads-health-check` first (when a user is present, say so and offer to run it; unattended, run it), then continue.
3. If most files are fresh but a check you'd need for sizing a cluster is older than 7 days, run `google-ads-health-check` in targeted mode for just those check IDs.
4. Note files whose status is `unknown` because their channel has no spend: they are not issues.

Don't re-run the battery when the files are fresh.

## Read your inputs

1. Every current health file in `ads/google/health/`: frontmatter and body.
2. `ads/google/findings/`: recent entries for dedupe and context (look further back than 14 days for findings carrying a `cluster_key`, since cluster findings are refreshed in place).
3. `wiki/company.md` for business context.
4. `ads/google/memory/MEMORY.md` and the entries that look like acknowledgements or prior decisions.

Use Python to load the health files into one table: parse each file's YAML frontmatter into a row (`check_id`, `check_name`, `status`, `category`, `channel`, `urgency`, `total_items`, `previous_status`, `status_unchanged_since`, `checked`, `accounts`, `accounts_failed`), and parse the offending-items tables in the body (markdown tables: split on `|`, first row is the header) to sum any spend, cost or conversion columns per check and per account. Read the `.<check-id>.log.md` history and count status changes in the last 14 days per check: 3 or more is flapping. Print the non-ok checks sorted by status, urgency and spend at stake.

## Decide what is important

Important means the issue may materially affect at least one of:

- spend
- conversions or conversion value
- budget delivery
- selected KPI trust (the `primary_conversion_action` in `ads/google/index.md`)
- Smart Bidding signal quality
- account safety
- a meaningful performance movement
- a current scaling objective (from `ads/media-plan.md` or `wiki/company.md`, when present)

A failed health check is not automatically important. Size impact before escalating, using the spend, conversion and item counts from the table above where the health file gives enough context. Hygiene-only failures with no material exposure should usually stay out of the investigation batch. Issues the user acknowledged in memory stay out unless their size has materially changed.

No hard cap: investigate every important cluster. Floor is zero.

## Cluster related symptoms

Merge checks into one cluster when they likely share a cause or decision:

- conversion setup issues affecting the same KPI or bidding signal
- zero-spend, disapproval, budget, and delivery blockers on the same campaigns
- performance drift plus related recent changes on the same channel or campaign
- geo targeting issues that explain a country-level shift
- creative or asset coverage issues on the same Performance Max campaigns

Use Python to find shared entities: collect `(account, campaign)` from the offending tables of every important check and list campaigns that appear in two or more checks. Several checks whose `status_unchanged_since` is the same date also point at one cause.

Keep separate clusters when the next action would clearly belong to different owners or data slices.

## Start investigations

Write every cluster to `ads/google/analyses/health-triage-YYYY-MM-DD.md` first, so each investigation can read its brief from the workspace. Each cluster must include:

- `title`: the investigation title
- `cluster_key`: a stable key such as `google-ads:tracking-reliability`. Reuse the key of an existing cluster finding for the same issue so the investigation refreshes it instead of creating a duplicate.
- `health_check_ids`: the check IDs in the cluster
- `evidence_paths`: the health files and related finding paths the investigation should read first
- `instruction`: a self-contained root cause analysis brief

The instruction must tell the investigation:

- what issue cluster to investigate, and why triage judged it important (the sized exposure)
- which health files to read
- which existing findings to check for dedupe and context
- to cite workspace files as markdown links with plain relative paths (`[conversions flowing](ads/google/health/conversions-flowing.md)`), with no bare file paths in prose, and to cite fresh numbers from its Python output
- to use the `google-ads-investigate-health-cluster` skill
- to create or update one finding if actionable, carrying the `cluster_key`
- not to send any message or email

Then run `google-ads-investigate-health-cluster` once per cluster with its brief. If your agent can run sub-agents, run the clusters in parallel, one sub-agent per cluster, and wait until all have finished; otherwise run them one after another in this session.

## Digest

After every investigation has finished, write one finding for this run, `ads/google/findings/YYYY-MM-DD-google-ads-triage-health-checks.md` (`kind: audit`, `category` per conventions for the most severe cluster, `status: pending` when any cluster finding is pending):

- **Wrap-up:** how many checks were triaged, how many clusters were investigated, and the most material one, with its sized impact.
- **Clusters table:** cluster, checks, sized impact, likely root cause (one line from its finding), confidence, link to its finding.
- **Not investigated:** the non-ok checks left out, with the reason (hygiene-only, acknowledged in memory, immaterial size, channel not live).

## All-clear path

If no important clusters exist, write the digest as an `ok` finding:

- what health areas were checked (channels and categories, with the run date of the files)
- why nothing material needs investigation
- any low-risk setup debt that remains visible but not urgent

Show the digest in the conversation when a user is present.

## Do not

- Do not re-run `google-ads-health-check` when the health files are fresh.
- Do not query Google Ads unless a health file is missing basic sizing needed for triage.
- Do not write root cause analysis findings in the triage run; the investigations do that.
- Do not write the digest until every investigation has finished.
- Do not use dramatic phrasing. Describe severity with measured impact.
- Use sentence case in headings unless a product name or acronym requires capitals.
