# Conversion Anti-Patterns

Events that should never be set as a Google Ads **primary** conversion. Most accounts fail because the wrong event was chosen as primary, not because the bidder is broken.

When recommending a primary, check the list for the customer's motion. If their existing primary is on this list, that finding goes in the brief — it's likely the single highest-leverage change.


## Any motion

These should never be a primary, regardless of business model:

- **Page view** — engagement, not conversion. Bidder learns to find visitors, not customers.
- **Scroll depth / time on page** — same problem. Optimizes for content consumers.
- **Video play / video view** — only valid as a primary for video campaigns where the conversion goal *is* the view (rare; usually awareness budgets that don't run Smart Bidding).
- **Raw button click** (e.g., "clicked Get Started") — fires before intent is confirmed. Bidder learns to find click-happy users.
- **Conversion actions with no value and no quality proxy** when the business *has* revenue data available. Discards the most useful signal the bidder could be using.


## B2C ecommerce

- **Add to cart as primary** — use as secondary; cart abandonment is the norm (60-80% baseline). Optimizing on add-to-cart drives the bidder to find easy-to-engage shoppers, not buyers.
- **Begin checkout as primary** — same reason, slightly later in funnel but still pre-purchase.
- **Flat-value purchase** ($1 per order, or value = 1) — destroys tROAS bidding entirely. The bidder treats a $20 mug the same as a $5,000 sofa. Always pass dynamic order value.
- **Multiple "purchase" conversion actions firing on the same transaction** — duplicate conversions inflate the count and confuse attribution. One purchase event, one fire.


## B2C growth (consumer subscription, mobile apps, DTC services)

- **App install as sole primary** — install ≠ activation. Bidder learns to find install-happy users (which is a real segment, often low-quality). Pair install with activation event minimum.
- **Newsletter signup as primary** when the business has a paid product. Newsletter signup is a content engagement signal, not a customer signal.
- **Free trial start as primary** if trial→paid conversion is <10%. Below 10%, the trial-start signal is too noisy — bidder finds trial collectors. Use activation or paid signup instead.


## B2B self-serve

The most common screwup happens here:

- **Free signup volume as primary** — the canonical mistake. Bidder optimizes for tire-kickers, students, and signup-bonus farmers. CAC looks good in Google Ads; pipeline contribution is near zero. Always recommend activation as primary for B2B self-serve, even when signup volume is much higher.
- **Trial start as primary if trial→paid conversion is <10%** — same as B2C growth.
- **Single "conversion" mixing both free and paid signups** — bidder can't distinguish; treats them as equal. Split into separate conversion actions.


## B2B sales-led

- **Raw form submit / "contact us" as primary** — bidder learns to find form-fillers, not buyers. Common in agencies running lead-gen campaigns where any form submit counts as a "lead."
- **Content download / gated PDF as primary** — same problem. Optimizes for content consumers. Use as a secondary engagement signal at most.
- **MQL with no qualification logic** — if the MQL definition is "filled out a form," it's just a form submit with extra steps. Bidder still learns to find form-fillers.
- **Demo booked without no-show filtering** — bidder learns to find people who book demos, not people who attend. If no-show rate >25%, filter to "demo attended" or add demo no-shows as a negative signal.


## B2B hybrid (combined self-serve + sales-led)

- **A single combined "conversion" mixing self-serve activation and sales-led MQL** — they're different cohorts with different value, conversion rates, and quality signals. Bidder cannot reconcile them. Always split into two primary conversion actions, one per path.
- **Averaging values across the two paths** — self-serve activation might be worth $200 in 90-day ARPU; a sales-led MQL might be worth $3,000 in expected value. Averaging or using a single flat value misrepresents both.


## When this changes a recommendation

If the customer's existing primary is on this list, the brief should:

1. Name it explicitly as a finding under "Existing Google Ads setup"
2. Quantify the likely impact (e.g., "free signup volume as primary likely sends 30-60% of spend to low-intent users")
3. Recommend the replacement primary
4. Add a learning-period warning (see `learning-phase-thresholds`)
5. Document an upgrade path if the recommended primary has low volume
