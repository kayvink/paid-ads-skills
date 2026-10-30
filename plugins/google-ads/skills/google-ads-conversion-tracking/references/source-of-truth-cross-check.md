# Source-of-Truth Cross-Check

Google Ads reported conversions should not be trusted in isolation. The platform reports what it can see, which is systematically incomplete (cookie loss, consent denial, ad-blockers) and systematically over-credited (Google's attribution favors trackable channels over untrackable ones).

The cross-check compares Google Ads reported conversions against the customer's own source of truth — their CRM, billing system, or order database. The gap between the two numbers tells you something specific about what's broken.


## How to run the check

For a recent stable window (last 30 days; avoid windows with promotions or anomalies):

1. **From Google Ads:** total conversions for the primary conversion action.
2. **From source of truth:** count of the equivalent business event (paid signups, closed-won deals, completed orders) in the same window.
3. **Compute the gap:** `(source_of_truth - google_ads_reported) / source_of_truth`

If you can read the CRM, payment system or order database (through an MCP or an export), query both sides directly. If not, ask the user for the source-of-truth number.


## Reading the gap

The size and direction of the gap is diagnostic:

- **Gap < 15% (Google Ads matches source of truth ±15%):** tracking is functionally healthy. Note it in the brief and move on.

- **Gap 15-30% (Google Ads reports fewer conversions than source of truth):** mild under-tracking. Likely causes, roughly ranked:
  - Missing enhanced conversions (iOS + ad-blocker cohort lost)
  - Cookie eviction (no localStorage backup)
  - EU traffic without Consent Mode v2
  - Client-side only (no CAPI / server-side fallback)

- **Gap >30% (Google Ads reports significantly fewer conversions than source of truth):** severe under-tracking. Likely causes:
  - gclid never captured or persisted (most common at this severity)
  - Conversion event not firing on the right trigger
  - Conversion action disabled or misconfigured in Google Ads UI
  - OCI required (B2B sales-led) but not implemented

- **Gap negative >10% (Google Ads reports MORE conversions than source of truth):** over-counting. Likely causes:
  - Duplicate firing client + server with no dedup (`transaction_id` or `event_id` missing)
  - Conversion event firing on the wrong trigger (page load instead of submit, every page render instead of conversion page)
  - Test traffic entering the conversion action
  - Multiple conversion actions firing on the same business event


## The over-attribution problem

Even when Google Ads reports the correct conversion count, the **attribution** can systematically over-credit Google Ads relative to other channels. Click-based attribution in GA4 and Google Ads under-credits channels that drive untrackable impressions (social, display, CTV) and over-credits channels that drive trackable clicks (search, especially branded).

This means: a $100K business attributed 60% to Google Ads in the platform may actually be 35-40% Google Ads. The other 20-25% is over-credit lifted from social/display/affiliate that doesn't get attribution because the user clicked on a Google Search ad last.

**This skill does not fix the attribution model.** It verifies the signal is clean. But the brief should note this for the user:

> "Note: Google Ads-reported conversions reflect platform attribution, which systematically over-credits trackable channels. Cross-reference with your media mix model or marketing-attribution platform for true contribution."


## What to put in the brief

Under "Existing Google Ads setup":

- Reported conversions (last 30 days): [N]
- Source of truth count (last 30 days): [M]
- Gap: [%]
- Likely cause(s) based on gap size and direction

If the gap is severe, this becomes the lead finding of the brief — fixing it usually outranks any conversion-action choice.

If the source-of-truth number isn't available, note that in the brief and recommend the user pull it manually so the cross-check can be redone after implementation.
