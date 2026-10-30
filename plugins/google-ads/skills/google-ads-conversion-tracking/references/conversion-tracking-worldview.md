# Conversion Tracking Worldview

Bidding algorithms are sophisticated. Signal quality is what's broken. **No optimization layer can fix what the signal layer broke.** Most teams optimize the wrong layer — tweaking Smart Bidding when the real problem is wrong primary event, missing value, busted gclid, or absent Consent Mode. The conversion-tracking skill exists to put signal-quality decisions before bidding decisions.

This frame inverts the dominant industry narrative ("Smart Bidding is a black box, the bidder is the lever"). It positions tracking work not as a setup task to be checked off, but as the highest-leverage thing a team can do to improve paid performance. Signal → algorithm → outcome. In that order.


## Lines to defend a recommendation

- *"The conversion event is not a tracking task — it's a strategic decision that dictates campaign performance."*
- *"Smart Bidding's prediction quality equals your conversion data quality."*

Use these when the user resists the idea that the conversion event matters more than the bid strategy, or pushes back on the time investment of getting tracking right before launching.


## The five signal-layer failure modes

Most broken accounts fail at one or more of:

1. **Wrong primary event** — Bidder learns the wrong customer. Most common in B2B self-serve (signup volume as primary instead of activation).
2. **No values** — Bidder is capped at tCPA logic; can't acquire high-LTV customers. Most common in ecom (flat-value purchase) and B2B (no expected value on leads).
3. **Broken gclid** — Bidder doesn't know which clicks actually converted. Auto-tagging off, URL transformers mangling case, cookie scope wrong.
4. **Missing Consent Mode** — EU traffic invisible to modelling layer. Conversions exist but the bidder can't see them.
5. **Environment pollution** — Test traffic, internal traffic, or duplicate firing trains the model on garbage.

Each failure starves the bidder of a different type of information. The brief should explicitly address each one — even if just to confirm it's not a problem.


## Nine rules for conversion-event selection

Each rule maps to a verification gate the brief should cover:

1. **Conversion event is a strategic decision**, not a tracking task. Choosing the wrong primary is the single biggest mistake.
2. **Pick the deepest reliable event** with enough volume. Don't optimize on a leading indicator when you have the lagging metric.
3. **Pass dynamic value** whenever the business has it. Flat values destroy tROAS and bias the bidder toward low-value customers.
4. **Always set up enhanced conversions.** Recovers iOS/ad-blocker cohort. Roughly 17% lift in match rate per Google's published benchmarks.
5. **Capture and persist gclid correctly.** Cookie + localStorage, path `/`, preserve case exactly. (See `identifier-persistence`.)
6. **Deduplicate client + server** with `transaction_id` / `event_id`. Double-firing inflates conversions and trains the model on phantoms.
7. **Server-side is the default architecture** under low consent rates. EU especially. Client-only loses ~30-50% of conversions to ad-blockers + ITP + consent denials.
8. **Cross-domain: explicitly pass identifiers** via URL or server session. Default cookie behavior breaks across domains.
9. **Triangulate against source of truth.** Never trust platform-reported numbers alone. (See `source-of-truth-cross-check`.)


## When to cite this reference

- User asks "why does the conversion event matter so much?"
- User wants to start optimizing bids before tracking is verified
- User pushes back on the time investment in the conversion-tracking brief
- Recommendation includes a non-obvious primary (e.g., activation over signup volume) and needs defending
