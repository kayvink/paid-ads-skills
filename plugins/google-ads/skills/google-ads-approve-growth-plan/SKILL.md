---
name: google-ads-approve-growth-plan
description: Turn the Google Ads objective, campaign groups, targets, scale candidates, new opportunities and open findings into an approved 30-day plan - the first three actions, a test backlog, and what waits - saved to ads/google/growth-plan.md. Use when the user asks what to do next in Google Ads, wants a 30-day or monthly plan, asks to prioritise findings and ideas, or wants to agree the next month of work. Builds on google-ads-find-scale-candidates and google-ads-find-new-opportunities.
---

# Approve growth plan

> Turn the objective, campaign groups, targets, scale candidates, opportunities, and open findings into the next 30 days of work.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

Help the user choose a practical 30-day Google Ads plan: the first 3 actions to take, the test backlog, and what should wait. This skill is for decision support. Do not imply changes have been made in Google Ads; the user applies them.

## Inputs you need

1. Media plan: read `ads/media-plan.md`.
2. Campaign rules: list `ads/google/rules/` and read each current rule file.
3. Taxonomy: read `ads/taxonomy.md`.
4. Open findings: list `ads/google/findings/` and read the ones with `status: pending`.
5. Recent reports: list `ads/google/reports/` and read the latest Google Ads weekly report if present.
6. Primary conversion action and accounts in scope: `ads/google/index.md`. Memory: `ads/google/memory/MEMORY.md`.
7. Recent performance: when a metric claim needs fresh support, run the query through the MCP for the accounts in scope (the `google-ads-write-gaql-queries` skill helps with fields) and compute the number in Python per conventions section 2. Cite the window and the computed figure.
8. Recent opportunity work: reuse outputs from the `google-ads-find-scale-candidates` and `google-ads-find-new-opportunities` skills if they exist in the conversation or in `ads/google/findings/`. If neither has run recently, offer to run them first; the plan is thinner without them.

## Method

Build the plan in this order:

1. Confirm the objective and constraint: primary KPI, target, budget ceiling, and risk appetite. Take them from the media plan and rules; ask the user for whatever is missing.
2. Separate required fixes from growth moves. Fixes that protect tracking, spend delivery, or target quality come before scaling. Open findings with `category: tracking`, and high-severity `budget` or `bids` findings, are fixes by default.
3. Pick the first 3 actions using impact, confidence, effort, and dependency order. Lay every candidate out in one table (source, action, impact, confidence, effort, depends on) so the ordering is visible; an action that depends on a fix can't come before it.
4. Put lower-confidence ideas into a test backlog with a clear success metric (metric, threshold, read date).
5. Name what is deliberately not being done this month, and why.

## Output

Give, in the conversation:

1. Recommended first 3 actions.
2. Test backlog.
3. Dependencies or approvals needed.
4. What to monitor next week.

Ask the user to confirm or edit the plan. When they confirm, write or update `ads/google/growth-plan.md` with the approved 30-day plan, including the decision date and the evidence used (the workspace paths of the findings, reports and rules each action rests on, and the computed figures). Mark an earlier plan in that file as superseded rather than deleting it. In an unattended run, don't write `growth-plan.md`; put the proposed plan in the finding instead.

Also write the run's finding (`kind: recommendation`, `category: budget`, or the category of the first action) per conventions section 4: the wrap-up names the first 3 actions and the recommendations table lists them, pointing to `ads/google/growth-plan.md` once approved.
