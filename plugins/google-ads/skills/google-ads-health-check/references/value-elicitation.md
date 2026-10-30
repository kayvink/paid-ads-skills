# Value Elicitation

The value passed with a conversion is what lets Smart Bidding distinguish a $20 customer from a $5,000 customer. Without it, the bidder treats every conversion as equal and the tROAS lever is dead.

When the value isn't obvious from research, ask the user. Below are the questions to ask per motion, plus what to do when the answer is "we don't know."


## B2C ecommerce

Value model is settled: **order total, sent dynamically, with currency and `transaction_id`.** Always.

Things to verify rather than ask:
- Is order total available at the time the conversion event fires? (Almost always yes for completed-purchase events.)
- Is currency populated? (Critical for multi-currency stores; bidder treats unmarked values as account-currency.)
- Is `transaction_id` unique per order? (Required for client/server dedup.)

Edge case: subscription ecom (recurring revenue). Pass the first-period value as the conversion value, and consider an offline upload for the 90-day or 12-month value as a separate conversion action so the bidder can learn long-tail value too.


## B2C growth (consumer subscription, mobile apps, DTC services)

Value isn't a single number; it's an estimate of expected revenue. Ask:

- What's your average ARPU at month 3? (Proxy for short-window LTV that's stable enough to pass.)
- Do you have an activation event that predicts retention? (e.g., "completed first workout" for fitness, "added 5 friends" for social.) If yes, use *activation* as primary; value can be flat at this stage because activation predicts retention which is what you care about.
- Are plan prices tiered? (If yes, pass plan price as the value when the user signs up for a paid plan.)

When the user says "we don't know our LTV":
- Recommend activation as primary with value = 1 plus a quality dimension (e.g., user country, signup source, plan tier passed as a custom parameter the bidder can segment on).
- Add an upgrade path: "Once retention cohorts stabilize, switch to LTV-based value model."


## B2B self-serve

Ask:

- What's your average revenue per paid signup in the first 90 days?
- Do paid plans differ in price? (If yes, pass plan price as value at the paid-signup event.)
- Is there a free→paid upgrade path? (If yes, the *paid signup* is a separate conversion action from the *free signup* — value is the plan price.)

When pre-revenue (no paid signups yet, or volume is tiny):
- Use activation as primary, value = 1.
- Pass a quality dimension where possible (company size, industry, country).
- Add upgrade path: switch to paid-signup-with-price once volume crosses the threshold (see `learning-phase-thresholds`).


## B2B sales-led

Ask:

- What's your average closed-won ACV (annual contract value)?
- Historical lead → opportunity rate? (Percentage of qualified leads that become opportunities.)
- Historical opportunity → closed-won rate? (Percentage of opportunities that close.)
- What's the typical sales cycle length? (Days from first ad click to closed-won. Affects offline conversion window.)

**Expected value per qualified lead** = ACV × (lead → opportunity rate) × (opportunity → closed-won rate)

Example: $50,000 ACV × 30% lead → opp × 25% opp → close = **$3,750 expected value per qualified lead.**

If you can read the CRM (through an MCP or an export), pull ACV, conversion rates, and sales cycle directly rather than asking. Confirm the numbers with the user before writing them into the brief.

When the user doesn't know:
- Ask for ballpark ranges instead of precise numbers.
- Default to industry-typical rates only as a last resort and flag this in the brief as "estimated, refine after first 90 days of data."


## B2B hybrid (combined self-serve + sales-led)

Separate value models per path. Never average across.

- Self-serve primary: value model from B2B self-serve section above.
- Sales-led primary: expected value from B2B sales-led section above.
- Brief should explicitly note: "Self-serve activations are valued at ~$X; sales-led MQLs are valued at ~$Y; bidder will allocate spend across the two."


## Questions never to skip

Regardless of motion:

- Is the value populated dynamically at firing time, or is it a fixed default?
- Is currency set?
- Does the same `transaction_id` (or equivalent) flow to both client-side (gtag/Pixel) and server-side (CAPI/offline) so dedup works?

If any of these is "no" or "I don't know," that's a finding for the brief.
