# Consent Mode v2

Consent Mode v2 is Google's mechanism for telling Google Ads what you couldn't track due to user consent denial. Without it, EU/EEA traffic that denies consent is invisible to the bidder — conversions happen, but Google Ads can't see them and can't optimize toward them.


## When required

Consent Mode v2 is **required** when the customer serves any of:

- European Economic Area (EEA) traffic
- United Kingdom traffic
- Switzerland traffic

Default to "required" unless the user explicitly confirms zero EU presence (geo-restricted product, US-only service, etc.). It's safer to over-implement than to discover six months later that EU conversions have been silently missing from the bidder's training data.

When EEA traffic is present, surface Consent Mode v2 as a **required** brief item, not a checklist line. Most teams skip it because the implementation is complex, and skipping it is the most expensive consent-mode mistake.


## Two modes: Basic vs Advanced

- **Basic mode:** consent denial blocks all Google tags from firing. Conversions from non-consenting users are zero — Google sees nothing. The bidder receives modeled conversions (Google's estimate based on consented traffic patterns).
- **Advanced mode:** consent denial allows pings to Google with no cookies/PII. The bidder receives both real conversions (from consenting users) and modeled conversions (from non-consenting users), with much better accuracy than Basic.

**Recommend Advanced mode by default.** Basic mode is acceptable only when the customer has a strict legal/policy reason to block all pings on denial (rare).


## Seven common mistakes

These are the failures to check for in the brief, in priority order:

1. **Wrong mode selected.** Basic when Advanced would work, or vice versa. Most common: implemented Basic because it was "simpler," getting much worse modeled conversion estimates than Advanced would produce.

2. **Missing `(not set)` attribution.** When consent defaults aren't fired before any analytics call, Google can't link the session to a source. Reports show `(not set)` traffic spikes invisibly, and session-source linkage breaks for all denial-state users.

3. **Default consent signals not set before analytics fires.** The Consent Mode default must be declared before any `gtag` or `dataLayer` push happens. If the analytics call fires first, then consent state updates, Google records the call as "consented" regardless of the user's actual choice.

4. **Update signals inaccurate.** The update call must reflect the user's actual choice (granted vs denied per category: `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`). Implementations that always send `granted` regardless of choice are non-compliant AND give the bidder wrong signal.

5. **Cookies not blocked when consent is denied.** If the CMP shows consent banner but cookies are still set on denial, you have a legal problem AND a tracking problem (data quality of consented traffic is polluted with denied users).

6. **Geolocation rules misapplied.** EU, UK, and Switzerland have different rules. Customer in CA serving EU traffic needs EU rules applied to EU users only, not globally. Common mistake: applying EU rules globally (over-restrictive) or US-style "implied consent" globally (non-compliant for EU users).

7. **Blended reporting toggle in GA4 not enabled.** With Advanced mode and EEA traffic, GA4 surfaces "modeled" conversions alongside real ones. If the toggle is off, the user sees only real conversions and concludes Consent Mode "isn't working" — when really the modeled data is there, just hidden.


## What to put in the brief

When EEA traffic is present:

- "**Consent Mode v2 required.** Customer serves [EEA / UK / Switzerland] traffic. Recommend Advanced mode with proper default + update signals. Without this, [estimated %] of conversions are invisible to Smart Bidding."
- List which of the seven mistakes apply (from research or platform inspection)
- Flag to the IDE skill: verify CMP integration order, consent defaults declared before analytics, update calls reflect actual choice, cookies blocked on denial

When EEA traffic is absent and confirmed:

- "Consent Mode v2 not required (customer serves [US-only / restricted geos]). Standard tag setup applies."


## Common signal of broken consent-mode setup

If GA4 shows a large `(not set)` source/medium segment (>10% of traffic from EU regions), consent defaults are firing late or not at all. This is the single best diagnostic signal that consent mode is broken.
