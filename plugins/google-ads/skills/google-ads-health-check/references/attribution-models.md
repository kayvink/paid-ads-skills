# Attribution Models

The attribution model determines how Google Ads assigns conversion credit across the ad clicks in a user's path. It affects what Smart Bidding learns from and what reports show.


## Recommendation: data-driven attribution (DDA) by default

DDA has been Google's default for new conversion actions since 2023. It uses account-level data to assign fractional credit across all clicks in the path, weighted by their estimated contribution to the conversion.

Use DDA unless there's a specific reason not to. Smart Bidding works best with DDA — the bidder gets richer signal about which keyword/audience/placement combinations contribute to conversions, not just which one fired the last click.


## When to override

The only legitimate reasons to recommend something other than DDA:

- **Reporting parity with another tool.** If the customer's analytics stack or executive dashboards use last-click, they may want Google Ads to match for cross-system reconciliation. In that case: use **last-click for reporting, keep DDA for bidding** if possible (set the conversion action to DDA but explain in reporting that other tools count differently). Do not regress to last-click everywhere.
- **Volume too low for DDA.** Below ~300 conversions in 30 days (Google's stated threshold), DDA falls back to last-click automatically. No need to override manually; it'll handle itself.


## What NOT to recommend

These are deprecated or low-value:

- **Position-based** — assigns 40% to first click, 40% to last click, 20% across middle. Arbitrary weighting; no evidence it outperforms DDA.
- **Time-decay** — exponentially weights toward the most recent click. Worse than DDA in almost every case because it ignores account-level patterns.
- **Linear** — equal credit across all touches. Treats a low-intent display impression as equivalent to a high-intent branded search click. Almost never correct.

If the customer's account is on one of these, recommend switching to DDA in the brief. Flag the learning-period warning (see `learning-phase-thresholds`) since the bidder will recalibrate.


## What attribution can and cannot fix

DDA still operates on platform-reported, click-based data. It improves credit assignment *within* Google Ads. It does not fix:

- Over-attribution to Google Ads relative to social/display/CTV (see `source-of-truth-cross-check`)
- Untracked offline conversions (DDA can't credit clicks it doesn't know converted)
- Conversions with no value passed (DDA still works but tROAS bidding is dead)

Tell the user this when they ask "if we switch to DDA, will our attribution be correct?" The honest answer is: more accurate within Google Ads, still not a substitute for source-of-truth reconciliation.


## Conversion windows

Two windows to set per conversion action:

- **Click-through window:** how long after an ad click a conversion can still be attributed. Default 30 days. Extend to 60-90 for B2B sales-led with longer cycles; 90+ for very long sales cycles (offline upload still works up to 540 days).
- **View-through window:** how long after a viewed (non-clicked) impression a conversion can be attributed. Default 1 day. Rarely worth extending; long view-through windows over-credit display.

For most accounts, defaults are correct. Override is a finding for the brief only if the sales cycle warrants it.
