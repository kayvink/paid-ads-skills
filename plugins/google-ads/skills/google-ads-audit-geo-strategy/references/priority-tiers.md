# Priority Tiers

Every skill that produces recommendations needs a consistent way to communicate urgency. The three-tier priority system (Critical, Moderate, Low) provides that consistency across all Google Ads skills. It tells the agent and the user which findings demand immediate attention, which warrant scheduled review, and which can be acknowledged and monitored.

The tiers are not arbitrary labels. Each has specific threshold criteria that vary by domain (cannibalisation, geo performance, budget allocation) but follow the same structural principle: the tier reflects the magnitude of waste, risk, or missed opportunity.


## The three tiers

### Critical

A finding that is actively wasting significant budget or missing substantial opportunity. Left unaddressed, the impact compounds — the longer it runs, the more budget is misallocated or the larger the opportunity cost grows.

**Framing:** Lead with the impact. State the estimated waste or missed opportunity in concrete terms (spend amount, conversion count, percentage of budget). Recommend immediate action with a specific next step.

**Handling:** Surface in the next check-in. Do not batch with lower-priority items. If you are composing a weekly report, Critical findings get their own section at the top.

### Moderate

A finding that represents meaningful inefficiency or a practice gap, but is not actively compounding at a rate that demands same-day action. The issue is real, the impact is material, but a week's delay does not dramatically change the outcome.

**Framing:** State the issue and its impact, but frame the recommendation as a scheduled improvement rather than an emergency. Include the specific change and expected benefit.

**Handling:** Include in the next scheduled review (weekly report, monthly audit). Group with related Moderate findings when multiple exist in the same domain.

### Low

A finding that is technically suboptimal but has minimal current impact. Often these are hygiene issues, minor inconsistencies, or early signals that could become Moderate if conditions change.

**Framing:** Note the issue briefly. Recommend monitoring or addressing as part of a broader cleanup pass. Do not overstate the urgency — a Low finding presented with Critical language erodes trust in the priority system.

**Handling:** Log for awareness. Address opportunistically (e.g., during a naming convention cleanup, fix all Low naming issues at once). Do not surface in executive-facing reports unless aggregated with other Low findings to show overall account hygiene.


## Domain-specific thresholds

The tier boundaries vary by domain because the same percentage means different things in different contexts. Below are the thresholds established across the source skill library.

### Cannibalisation (keyword and search term overlap)

| Metric | Critical | Moderate | Low |
|--------|----------|----------|-----|
| NonBestSpendShare% | >= 30% | 5-30% | < 5% |
| PerfGap% | >= 30% (combined with high NonBestSpendShare) | Varies | Varies |
| Brand cannibalisation flag | Always Critical regardless of spend share | - | - |
| Data quality | >= 20 events required for confident tier assignment; below 20 events, append "low data" flag |

**NonBestSpendShare%** = the percentage of total spend on a query or keyword going to campaigns other than the best performer. At 30%+, nearly a third of spend is going to worse-performing campaigns — that's active waste.

**PerfGap%** = the performance difference between the best and worst campaign on the same query. At 30%+, the worst campaign is dramatically underperforming relative to the best — consolidating to the best would yield a large efficiency gain.

### Geo performance

| Metric | Critical | Moderate | Low |
|--------|----------|----------|-----|
| CPA/ROAS variance from account average | > 25% weaker | 10-25% weaker | < 10% (within expected range) |
| Spend in unapproved geo | > 1% of campaign budget | < 1% of campaign budget | - |
| Spend skew vs media plan | > 20% deviation | 10-20% deviation | < 10% |

### Budget allocation

| Metric | Critical | Moderate | Low |
|--------|----------|----------|-----|
| Campaign below learning-phase threshold | > 50% of campaigns | 30-50% of campaigns | < 30% |
| IS(Budget) loss on Efficient campaigns | >= 20% | 10-20% | < 10% |
| Overspend vs plan | > 20% | 10-20% | < 10% |

### Smart Bidding health

| Metric | Critical | Moderate | Low |
|--------|----------|----------|-----|
| CPA vs group benchmark | > 25% over | 10-25% over | 0-10% over (Slightly-above) |
| Volume below threshold | < 15 conversions (half the floor) | 15-29 conversions (approaching floor) | At or above floor |
| Days since last bid change | < 7 (still in learning; premature to judge) | - | - |


## Minimum confidence requirements

A finding below the minimum event threshold (default: 20 events) cannot be assigned a confident tier. Instead:

- Assign the tier based on available data.
- Append a "low data" qualifier to the finding.
- Present it as directional ("early signal suggests...") rather than definitive.

This prevents suppressing genuinely Critical findings just because the campaign is low-volume, while also preventing thin data being presented thin data with false confidence.


## Threshold consistency rule

When a skill defines its own domain-specific thresholds, they must be internally consistent with the tier definitions above. A skill should not label a 5% variance as Critical — that undermines the system. If a domain genuinely has tighter tolerances (e.g., brand safety), document why in the skill's Interpretation Guide section, and the threshold will be understood in context.
