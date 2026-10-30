# Market Partitioning

Market partitioning assigns every campaign a MarketKey — a label identifying which geographic or tier-based market the campaign serves. Skills that detect cannibalisation, assess geo performance, or recommend budget shifts need to know which campaigns compete in the same market and which operate in separate ones. Without partitioning, a US brand campaign and a UK generic campaign would be flagged as cannibalising each other when they serve entirely different audiences.


## MarketKey derivation

The MarketKey is derived from a priority hierarchy. The first match wins:

### 1. Location targeting (LocMarket) — highest priority

Derived from the campaign's location targeting settings in the platform:

| Targeting configuration | LocMarket value |
|------------------------|-----------------|
| Single country or region | That value (e.g., "US", "UK", "NL") |
| Multiple specific countries | Set label (e.g., "{UK,CA,ES}") |
| Global / ROW / International targeting | "GLOBAL" |
| No targeting data available | Falls through to next level |

Location targeting is the strongest signal because it reflects what the platform actually does — regardless of what the campaign name says, location targeting controls which auctions the campaign enters.

### 2. Geo token from campaign name — second priority

If LocMarket does not resolve to a single country, check the campaign name for geo tokens (case-insensitive):

**Valid geo tokens:** UK, United Kingdom, GB, US, USA, United States, CA, Canada, DE, Germany, FR, France, ES, Spain, IT, Italy, NL, Netherlands, AU, Australia, IN, India, BR, Brazil, MX, Mexico, EMEA, APAC, NAMER, GLOBAL, ROW, INTERNATIONAL

Geo tokens in the name are a weaker signal than location targeting — names can be stale or misleading — but when location targeting is ambiguous (multi-country sets, broad regions), the name is the best available signal.

### 3. Tier token from campaign name — third priority

If neither LocMarket nor GeoToken resolves, check for tier tokens:

**Valid tier tokens:** Tier1, T1, Tier2, T2, Tier3, T3, Core, Expansion, Test

Tier tokens are used only when `tier_as_market` is enabled (default: true). In accounts that organise by market tiers rather than specific countries, tiers function as market proxies — Tier1 campaigns target high-value markets, Tier2 targets expansion markets, and they should not be compared against each other for cannibalisation.

### 4. GLOBAL fallback

If LocMarket is GLOBAL or a GLOBAL/ROW/INTERNATIONAL token is detected in the name, MarketKey = "GLOBAL".

### 5. UNKNOWN

If nothing matches, MarketKey = "UNKNOWN". Unknown campaigns are isolated — they never collide with known MarketKeys. This prevents false positives from campaigns with insufficient metadata.


## Integrity assertion

When a campaign has both a tier token and a specific geo signal (single-country LocMarket or GeoToken in name), the geo signal overrides the tier. The MarketKey is set to the country/geo, and the campaign is flagged with "Tier overridden by explicit geo."

This prevents a campaign named "T1 - UK - Brand" from being grouped with all other T1 campaigns. The UK signal is more specific and more useful for cannibalisation detection.


## Collision blocking rules

Not all MarketKey pairs should be checked for collisions:

**GLOBAL isolation** (configurable via `global_collides_with_named`, default: false):
- When false, GLOBAL campaigns do not collide with named-country campaigns. A campaign targeting worldwide and a campaign targeting the US are assumed to serve different intents (broad reach vs focused performance). This is the default because most accounts with both GLOBAL and country-specific campaigns intend them to coexist.
- When true, GLOBAL campaigns can collide with specific-country campaigns. Enable this when the account uses GLOBAL as a catch-all that competes for the same auctions as country-specific campaigns.

**UNKNOWN isolation:** UNKNOWN MarketKeys never collide with any other MarketKey, including other UNKNOWNs. Without a known market, any collision flag would be a guess.

**Cross-market transparency:** When campaigns in different markets share the same queries or keywords, they are listed separately as "cross-market overlap" for audit purposes, but not flagged as actionable cannibalisation. The skill notes the overlap without recommending intervention.


## Geo performance thresholds

When evaluating campaign performance by geography (not cannibalisation, but geo-level optimisation):

| Variance from account average | Action |
|-------------------------------|--------|
| Within +/- 10% | Expected range. No action. |
| >= 10% stronger (lower CPA or higher ROAS) with scalable volume | Scale spend toward this geo. |
| >= 10% weaker | Reduce spend or investigate root cause (landing page, offer relevance, competition). |
| Spend skew vs media plan > 10% | Adjust allocations to match plan, or update plan if the skew is intentional. |
| Spend in off-plan geo | Flag and recommend geo exclusion. |

Low-volume geos (insufficient data for reliable comparison) should be flagged for monitoring, not actioned.


## Spend leakage severity

When campaigns deliver spend in unapproved or unintended geographies:

| Leakage share | Severity | Action |
|---------------|----------|--------|
| > 1% of campaign budget | High | Add geo exclusions immediately. The leakage is material enough to affect performance metrics and waste budget. |
| < 1% of campaign budget | Low | Flag for awareness, monitor. The amount is immaterial but may indicate a targeting misconfiguration worth noting. |

Leakage often stems from location targeting set to "Presence or interest" rather than "Presence only." Google Ads defaults to the broader option, which shows ads to users who have shown interest in a location without being physically present. Skills should flag the targeting mode alongside any leakage finding.


## Configuration parameters

Skills that use market partitioning should respect these configurable parameters:

```
non_best_share_high_pct: 30    -- NonBestSpendShare% threshold for Critical priority
non_best_share_low_pct: 5      -- NonBestSpendShare% threshold for Low priority
perf_gap_high_pct: 30          -- Performance gap threshold for Critical priority
min_events_conf: 20            -- Minimum events for confident assessment
tier_as_market: true           -- Whether tier tokens function as market keys
global_collides_with_named: false  -- Whether GLOBAL campaigns collide with named markets
```
