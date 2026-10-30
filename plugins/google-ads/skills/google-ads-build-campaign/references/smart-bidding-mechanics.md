# Smart Bidding Mechanics

Smart Bidding (tCPA, tROAS, Maximize Conversions, Maximize Conversion Value) is Google's auction-time bid optimisation. It sets bids per auction using real-time signals — device, location, time of day, remarketing list, query — that manual bidding cannot incorporate at scale. The trade-off is loss of per-keyword bid control in exchange for signal density the algorithm can exploit.

The mechanics below govern how skills evaluate, adjust, and recommend around Smart Bidding campaigns.


## Volume sufficiency

Smart Bidding needs conversion volume to learn. Below a minimum floor the noise-to-signal ratio is too high for the model to converge on patterns, and bid decisions become near-random.

| Campaign type | Minimum conversions (L30D) | Why |
|---------------|---------------------------|-----|
| Search | 30 | Single-inventory (search auctions only); fewer signals to reconcile |
| PMax / YouTube | 50 | Multi-inventory (Search, Shopping, Display, YouTube); the model must learn placement-level signals on top of audience signals, so it needs a larger sample |

These are rules of thumb, not hard cutoffs. A campaign at 25 conversions with stable conversion paths may still optimise reasonably, but confidence in bid decisions drops sharply below the floor. Skills should flag campaigns below threshold as unstable and recommend consolidation or a different bidding approach (e.g., Maximize Clicks to build volume before switching).


## Performance tiers

Every campaign is classified against its **group benchmark** — the median CPA or ROAS across peer campaigns over 14-30 days. The benchmark is the group median, not the set target. The set tCPA/tROAS is the campaign's instruction to the algorithm; the benchmark is the observed reality across the group.

| Tier | Definition |
|------|-----------|
| Efficient | CPA at or below group benchmark (or ROAS at or above) |
| Slightly-above | CPA 0-10% over benchmark (or ROAS 0-10% under) |
| Inefficient | CPA >10% over benchmark (or ROAS >10% under) |

When a business target exists per group, use it as the primary benchmark. Fall back to the peer median only when no business target is set.


## tCPA and tROAS levers

Adjustments to targets are always expressed as percentages, never currency amounts. Currency amounts are misleading across accounts with different scales; percentages normalise the magnitude of the change.

**Standard adjustment:** 5-10% per move. This is the default step size for loosening or tightening. It is small enough to avoid destabilising the learning phase, large enough to produce a measurable signal within the test window.

**Low-volume inefficient adjustment:** 10-15% loosening. When a campaign is both inefficient and low-volume, a standard 5-10% move may not generate enough additional volume for the algorithm to find a better equilibrium. The wider step accepts short-term cost increase to rebuild signal.

**Direction rules:**

- CPA consistently lower than tCPA: the target is too restrictive, capping volume the algorithm could deliver efficiently. Loosen tCPA by 5-10%.
- ROAS consistently higher than tROAS: same dynamic, inverted metric. Relax tROAS by 5-10%.
- CPA consistently higher than tCPA (or ROAS lower than tROAS): the campaign is struggling to meet the target. Diagnose root cause before tightening further — tightening an already-struggling campaign reduces auction participation and can accelerate a volume death spiral.
- PMax on Maximize Conversions: optionally introduce tCPA as a percentage reduction (e.g., "reduce CPA bids by 5%"), not as an absolute currency target.


## Bid vs budget lever selection

The distinction between IS(Rank) loss and IS(Budget) loss determines which lever to pull. Conflating them wastes budget or misses opportunity.

**IS(Budget) loss >= 10%:** the campaign is losing impressions because the daily budget runs out before the day ends. This justifies a budget increase — but only within the SIS cap bands (see `ref:sis-headroom`). Budget increases require all three gates: Efficient + budget-limited flag + IS(Budget) loss >= 10%.

**IS(Rank) loss 10-20%:** the campaign is losing impressions because competitors' bids or quality scores are higher. This justifies a mild bid loosen (tCPA +5-10% or tROAS -5-10%) when the campaign is Efficient. Rank loss never justifies budget increases — adding budget to a rank-loss campaign just runs through more auctions at the same disadvantaged position.

**Both losses present:** address budget loss first (it is the binding constraint), then reassess rank loss after the budget change settles.


## Test window

After any bid or budget change, wait 7-14 days before reassessing. Smart Bidding re-enters a mini learning phase after target changes. Evaluating too early captures learning-phase noise, not the new equilibrium. The 7-day floor ensures at least one full weekly cycle (weekday/weekend patterns); 14 days gives the algorithm a second cycle to stabilise.


## Decision flow summary

```
Campaign meets volume floor?
  No  -> Flag unstable, recommend consolidation or Maximize Clicks
  Yes -> Classify performance tier

Efficient + IS(Budget) loss >= 10%?
  Yes -> Budget increase within SIS cap

Efficient + IS(Rank) loss 10-20%?
  Yes -> Bid loosen (tCPA +5-10%, tROAS -5-10%)

Inefficient?
  No budget increases.
  Strong volume -> loosen tCPA +5-10% or brief Maximize Conversions pulse
  Weak volume  -> loosen tCPA +10-15% or switch to Maximize Conversions to rebuild signal

After any change -> wait 7-14 days, then reassess.
```
