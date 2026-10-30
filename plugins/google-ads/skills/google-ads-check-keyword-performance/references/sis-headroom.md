# SIS Headroom

Search Impression Share (SIS) measures the percentage of eligible impressions a campaign actually won. The gap between current SIS and 100% is the headroom — auctions the campaign could have entered but didn't, either because the budget ran out (IS Budget loss) or because competitors outranked it (IS Rank loss). For non-search campaigns (PMax, Display, YouTube), frequency serves the analogous role: how often the target audience sees the ad relative to what's available.

SIS headroom determines whether a campaign can absorb more budget productively. A campaign at 95% SIS has almost no room to grow — additional budget enters auctions it would have won anyway or auctions where competition is fierce. A campaign at 50% SIS has substantial room, and budget increases translate more directly into incremental impressions.


## Headroom bands

| Band | SIS threshold | Frequency equivalent | Interpretation |
|------|--------------|---------------------|----------------|
| High headroom | < 60% | < 3 | Large untapped auction pool. Budget increases have the highest marginal return. The campaign is only competing in a fraction of eligible auctions. |
| Moderate headroom | 60-85% | 3-5 | Meaningful room exists but diminishing returns are starting. Budget increases are productive but should be sized conservatively. |
| Capped | > 85% | > 5 | Near saturation. The campaign is already winning most eligible auctions. Additional budget yields little incremental reach and may inflate CPCs by competing harder in marginal auctions. |


## Budget increase caps by SIS band

When a campaign qualifies for a budget increase, the SIS band limits how large that increase can be:

| SIS range | Maximum budget increase |
|-----------|------------------------|
| >= 90% | 0% (no increase allowed) |
| 85-90% | Up to +5% |
| 70-85% | Up to +10% |
| < 70% | Up to +20% |

The formula: `final_budget_delta% = min(requested_delta%, SIS_cap_band)`

If a skill's analysis suggests a +15% budget increase but the campaign's SIS is 88%, the cap limits the actual recommendation to +5%. The cap prevents over-scaling into saturated auction space where marginal cost per incremental conversion rises sharply.


## Three-gate eligibility

A budget increase recommendation requires all three conditions to be true simultaneously:

1. **Efficient performance:** CPA at or below group benchmark (or ROAS at or above). Increasing budget on an inefficient campaign scales the inefficiency.

2. **Budget-limited flag:** The platform's `limited_by_budget` flag is true, meaning the campaign's daily budget was the binding constraint on impression delivery. Without this flag, the campaign chose not to spend more — the issue is bid competitiveness or audience saturation, not budget.

3. **IS(Budget) loss >= 10%:** At least 10% of eligible impressions were lost specifically because the budget ran out. This confirms the budget-limited flag is not a trivial edge case (e.g., budget running out in the last hour of the day with minimal remaining demand).

If any gate fails, the budget lever is the wrong tool:
- Not efficient -> fix performance first (bid adjustments, audience refinement, creative testing).
- Not budget-limited -> the campaign has budget to spare; the issue is elsewhere.
- IS(Budget) loss < 10% -> the budget constraint is marginal; other factors dominate.


## IS(Rank) vs IS(Budget) distinction

This distinction is critical and frequently confused:

**IS(Budget) loss** = impressions lost because the daily budget ran out. The fix is budget. Rank was fine; the campaign just couldn't afford to keep bidding.

**IS(Rank) loss** = impressions lost because a competitor's Ad Rank (bid x quality) was higher. The fix is bid adjustment or quality improvement, not budget. Adding budget to a rank-loss campaign lets it enter more auctions at the same disadvantaged position — it spends more without winning more.

When both losses are present, address IS(Budget) first. Budget is the binding constraint; until it's relaxed, IS(Rank) assessment is skewed (the algorithm may be choosing lower-rank auctions because it's rationing budget).

**IS(Rank) loss action:** When a campaign is Efficient and has IS(Rank) loss of 10-20%, a mild bid loosen (tCPA +5-10% or tROAS -5-10%) is warranted. But only as a bid adjustment — never as a budget increase. And only when SIS < 90%; at very high SIS, even bid loosening has limited upside because the campaign is already winning most auctions.


## Scaling decision flow

```
Campaign is Efficient?
  No  -> No budget increases. Diagnose inefficiency first.
  Yes -> Continue.

Budget-limited flag = true AND IS(Budget) loss >= 10%?
  No  -> Budget lever not applicable. Check IS(Rank) for bid adjustment.
  Yes -> Continue.

SIS band?
  >= 90%  -> No budget increase (capped). Consider bid loosen if IS(Rank) loss exists.
  85-90%  -> Up to +5% budget.
  70-85%  -> Up to +10% budget.
  < 70%   -> Up to +20% budget.

Apply: final_budget_delta% = min(requested_delta%, SIS_cap_band)
```
