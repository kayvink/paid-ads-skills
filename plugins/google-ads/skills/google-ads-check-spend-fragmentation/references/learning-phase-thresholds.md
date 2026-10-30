# Learning Phase Thresholds

The learning phase is the period after a campaign launches or changes its bidding strategy, target, or conversion action, during which the algorithm is calibrating its bid model. During this window, performance is volatile — CPA can swing 2-3x above steady state — because the model is exploring auction segments it has not yet mapped.

Understanding the learning phase is essential for every skill that evaluates performance, recommends bid changes, or assesses campaign health. Judging a campaign in learning phase by its current CPA is like judging a new hire by their first-week output.


## Conversion floors by campaign type

The learning phase ends (functionally, not formally announced by Google) when the campaign accumulates enough conversion signal for the bidding model to converge. The floors below are the practical minimums for stability:

| Campaign type | Minimum conversions (L30D) | Rationale |
|---------------|---------------------------|-----------|
| Search | 30 | Search campaigns bid on a single inventory type (search auctions). The signal space is narrower — device, location, time, query — so fewer conversions are needed for the model to find patterns. |
| PMax | 50 | PMax distributes spend across Search, Shopping, Display, YouTube, Discovery, and Gmail. Each inventory type has its own signal structure (placement-level on Display, video completion on YouTube, product-level on Shopping). The model must learn cross-inventory allocation on top of audience signals, requiring a larger sample. |
| YouTube (video action) | 50 | Similar to PMax in that video inventory has a different signal profile from search. Conversion paths are longer (view -> site visit -> convert), adding noise the model must filter. |

Below these floors, the bidding model has insufficient signal to distinguish real patterns from noise. Bid decisions become near-random, and performance metrics are unreliable as diagnostic inputs.

A campaign at 25 conversions on Search with highly stable conversion paths (e.g., single landing page, single conversion action, consistent audience) may still function, but confidence drops sharply. Skills should treat sub-floor campaigns as unstable and exclude them from benchmark calculations that assume steady-state performance.


## Fragmentation assessment

When multiple campaigns in an account each fall below threshold, the issue is usually structural: budget and traffic are spread across too many campaigns for any single one to accumulate sufficient signal.

| Share of conversion campaigns below threshold | Severity | Implication |
|-----------------------------------------------|----------|-------------|
| <= 30% | Normal | Some campaigns are niche or newly launched. Monitor, don't restructure. |
| 30-50% | Fragmented | The account structure is splitting signal. Recommend reviewing campaign consolidation opportunities — merge campaigns with overlapping targeting or similar conversion actions. |
| > 50% | Severely fragmented | The majority of campaigns cannot learn effectively. Strong recommendation to consolidate. The account is likely spending budget on campaigns that will never exit the learning phase at current volume levels. |

Fragmentation is distinct from low total volume. An account with 500 conversions/month spread across 30 campaigns (17/campaign average) is fragmented. The same account with 3 campaigns (167/campaign) is healthy. The total budget may be adequate; the structure is the problem.


## Relationship to bid strategy recommendations

When a campaign meets the volume threshold but is not using Smart Bidding (e.g., still on Manual CPC or Enhanced CPC), the typical pathway is:

1. Switch to Maximize Conversions (no target) to let the algorithm accumulate signal without a constraint.
2. After 2-4 weeks of stable performance, introduce a tCPA or tROAS target based on observed performance, not aspirational goals.
3. Tighten the target incrementally (5-10% per adjustment, 7-14 day test windows) toward the business goal.

Starting directly with tCPA/tROAS on a campaign that has never run Smart Bidding is risky — the algorithm has no historical signal to calibrate against, and a tight target can suppress auction participation before learning begins.


## What skills should do with sub-floor campaigns

- Exclude from group benchmarks (their metrics are noise, not signal).
- Flag in output as "below learning-phase threshold" with the specific count and floor.
- Recommend consolidation when fragmentation assessment triggers.
- Do not recommend bid target changes on sub-floor campaigns — the target is not the problem; volume is.
- If the campaign is newly launched (< 7 active days), apply the stability windowing rules (`ref:stability-windowing`) before any assessment.
