---
name: google-ads-find-scale-candidates
description: Shortlist up to five Google Ads campaigns or campaign groups that already hit their CPA or ROAS target and have room for more budget, bids or coverage, with the evidence and the next move for each. Use when the user asks where to spend more, which campaigns to scale, where there is headroom, or how to grow conversions without changing strategy. For a full plan-versus-spend pacing audit use google-ads-check-pacing; for new keyword themes and tests use google-ads-find-new-opportunities.
---

# Find scale candidates

> Spot campaigns or groups that are already working and have room for more budget, bids, or coverage.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The room-to-spend test uses `references/sis-headroom.md`.

## Goal

Give the user a short, evidence-backed list of places where more spend could produce more conversions without changing the account strategy. This is a scale shortlist, not a broad audit.

## Inputs you need

1. Media plan: read `ads/media-plan.md` when present.
2. Campaign rules: list `ads/google/rules/` and read each current rule file for its group's KPI and target CPA or ROAS.
3. Taxonomy: read `ads/taxonomy.md` for campaign grouping.
4. Primary conversion action and accounts in scope: `ads/google/index.md`.
5. Recent performance: queries A and B below, for each account in scope, over the last 30 days ending yesterday. For field questions use the `google-ads-write-gaql-queries` skill.
6. Recent findings: list `ads/google/findings/` and read the open ones (`status: pending`) from the last 30 days, so you do not recommend scaling a known broken area.
7. Memory: `ads/google/memory/MEMORY.md`, so you don't propose scaling something the user has deliberately capped.

**Query A: spend, delivery and headroom per campaign**

Leave `segments.date` out of the `SELECT` so the API returns one 30-day row per campaign; impression-share metrics are ratios and can't be summed over daily rows.

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  campaign.bidding_strategy_type,
  campaign.primary_status,
  campaign.primary_status_reasons,
  campaign_budget.amount_micros,
  metrics.cost_micros,
  metrics.clicks,
  metrics.conversions,
  metrics.conversions_value,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

**Query B: primary-action conversions** (skip when no primary action is configured and use `metrics.conversions` from query A)

```sql
SELECT
  campaign.id,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

For "strong converting terms not yet fully covered", reuse a recent `google-ads-check-keyword-expansion` finding if one exists; otherwise note that this signal wasn't checked.

## Method

Use the plan-versus-performance framing of the `google-ads-check-pacing` skill: if it ran in the last 14 days, read its finding and start from its scale quadrant (on or ahead of target, behind or on plan). Then narrow to scale candidates.

Use Python to build the candidate table:

- Join query B to query A on `(customer_id, campaign.id)`; compute `cost = cost_micros / 1e6`, CPA = cost / conversions, ROAS = conversions_value / cost.
- Map each campaign to its group from `ads/taxonomy.md` (or by name pattern when there's no taxonomy) and attach that group's target from its rules file.
- Without a target, compute the benchmark from sums: group (or account) CPA = group cost / group conversions, ROAS = group value / group cost.
- Also aggregate the same metrics to group level, so a whole group can qualify when its campaigns are individually small.

A candidate should pass all three checks:

1. **Performance is at or better than its declared target**, or clearly better than the account/group average when no target exists. In code: CPA ≤ target CPA (or ROAS ≥ target ROAS). Without a target, use the group benchmark above and print how far the campaign beats it. Campaigns below the conversion floors in `references/learning-phase-thresholds.md` are unstable: they can stay on the list only as low-confidence candidates.
2. **There is room to spend more**, shown by budget limits, low impression share, budget lost impression share, or strong converting terms not yet fully covered. Apply the three-gate eligibility and headroom bands from `references/sis-headroom.md`: budget-limited when `campaign.primary_status_reasons` contains `BUDGET_CONSTRAINED`; IS(Budget) loss = `search_budget_lost_impression_share ≥ 0.10`; then the SIS band of `search_impression_share` sets the maximum budget increase (≥ 90% none, 85–90% up to +5%, 70–85% up to +10%, < 70% up to +20%). When budget gates fail but IS(Rank) loss is 10–20% and SIS < 90%, the room is a mild bid loosen, not budget. Non-Search campaigns have no search impression share; for them, budget-limited status is the room signal (print 30-day cost against `amount_micros / 1e6 × 30` as supporting evidence), and say that the SIS band couldn't be applied.
3. **No open high-confidence finding says the campaign or group is unsafe to scale.** Match open findings to campaigns by name and drop any campaign with an open high-severity tracking, budget or bids finding.

Rank candidates by practical upside: likely extra conversion volume, confidence, and how simple the next move is. In code, estimate the upside as current conversions × the allowed budget increase from the SIS band (a ceiling, not a forecast), then sort by that estimate, breaking ties by confidence (above the conversion floor first) and by move simplicity (a budget change before a bid change before new coverage).

## Output

Give, in the conversation:

1. Best scale candidates, capped at 5.
2. Why each one qualifies: CPA or ROAS against target, the headroom numbers (SIS, IS budget and rank loss), and the gate each passed.
3. Suggested next move: budget increase capped by the SIS band, bid loosen, or extra coverage.
4. Main caveat or check before changing spend.

Then write one finding (`kind: recommendation`, `category: budget`) per conventions section 4, with the shortlist as the recommendations table (account, campaign or group, current budget, proposed change, reason). Update an open finding from this skill instead when one covers the same campaigns. If nothing is safe to scale, write a `status: ok` finding that says what was checked and why no candidate cleared the bar.
