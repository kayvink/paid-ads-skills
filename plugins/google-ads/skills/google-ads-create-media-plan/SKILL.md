---
name: google-ads-create-media-plan
description: Create, import or revise the media plan file ads/media-plan.md that records the period, strategy (allocation, efficiency, hybrid or ceiling), spend allocations by country, channel, tier or product, flights and off-plan exclusions, drafted from observed Google Ads spend or translated from the user's own spreadsheet or deck, and validate an existing plan for drift. Use when the user asks to set up or update a media plan or budget allocation, roll the plan to a new period, or when google-ads-check-pacing or google-ads-check-geo-targeting needs a plan that doesn't exist yet.
---

# Create media plan

> Create or revise `ads/media-plan.md`: the declared strategy for spend allocation, constraints, and period. Every account has a plan; content density scales with complexity.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

Produce (or update) a canonical `ads/media-plan.md` that records the account's spend strategy in a form other skills (`google-ads-check-geo-targeting`, `google-ads-check-pacing`, budget allocation) can read. The plan is always present: even "no hard allocations, pace on efficiency" is a plan and gets recorded explicitly so downstream skills know what to check against.

## Scope

Spend and structural data come from Google Ads. The plan file is cross-channel: it sits next to `ads/taxonomy.md`, and other channels can add their own sections to the same file.

## Three modes

Pick the mode based on the situation.

### Mode A: Auto-propose from observed spend (no plan exists)

Simple to medium accounts. There's enough data to draft a plan from reality.

1. Read business context from `wiki/company.md`: industry, business type, scale hints.
2. Read `ads/taxonomy.md` for campaign groupings, declared markets, tier structure if any.
3. Pull the 30-day and 90-day spend distribution by country, channel, and campaign group (queries below).
4. **Detect scale** and choose the appropriate plan density. Use Python to count, over the last 30 days, the countries and channel types carrying spend:
   - 1 country, 1 channel → simple one-pager, probably efficiency-based strategy
   - 3–10 countries + multiple channels → medium allocation plan with per-country %
   - 10+ countries or declared tiers → hierarchical plan (by tier, then country within tier)
5. Propose the draft in the finding body. Ask confirming questions about intent: *"Current spend is NL 45% / DE 22%. Is this where you want to stay, or meant to shift?"*

### Mode B: Import from user-provided material (plan exists elsewhere)

Large accounts usually have a plan in a spreadsheet, BI tool, or slide deck, not in a markdown file. The job here is to translate it into `ads/media-plan.md` so the other skills can read it.

1. The user pastes or uploads their existing plan (spreadsheet paste, text dump, CSV, etc.).
2. Parse what you can (load tabular input into pandas), and ask clarifying questions about structure:
   - "I see country splits for NL/DE/FR but no channel split. Are these channel-agnostic, or is the channel split implicit?"
   - "Your tiers include IT but IT has no 30-day spend. Flight not started yet, or decommissioned?"
3. Propose a structured `ads/media-plan.md` matching their plan's structure.
4. On confirmation, write the file.

### Mode C: Update / revise (plan exists, needs refresh)

The plan exists; the user wants to roll to a new period or revise allocations.

1. Read the existing `ads/media-plan.md`.
2. Pull current 30-day spend vs declared allocations; identify drift (see "Drift" below).
3. Read `ads/google/memory/MEMORY.md` for any acknowledged shifts ("UK doubled budget in March for product launch").
4. Propose updates: period roll, allocation adjustments aligned to reality, new markets added / dropped markets removed.
5. On confirmation, write the new plan at `ads/media-plan.md` (the well-known path skills always read for the current plan). If an older plan existed, rename it first to `ads/media-plan-<old-period>.md` (sibling file, not a subfolder) and update its frontmatter to `status: superseded`. Multiple prior periods coexist as sibling files; the current one is always at the canonical path.

## Inputs you need

1. **Business context:** `wiki/company.md`. Scale, business type, service-area constraints.
2. **Taxonomy:** `ads/taxonomy.md`. Campaign groupings, declared markets, tier structure if any.
3. **Memory:** `ads/google/memory/MEMORY.md`. Scan for acknowledged decisions and strategic notes; read the individual files for full context.
4. **Existing plan:** `ads/media-plan.md`. May be a placeholder, partial, or full.
5. **User-provided material** (Mode B only): pasted or uploaded content from the user's existing plan.
6. **Primary conversion action:** `ads/google/index.md`.
7. **Live spend data:** the queries below, for each account in scope.

**Country-level spend over 30 and 90 days.** For pure allocation proposals (spend distribution), query A alone is enough; use `metrics.all_conversions_value` as a rough revenue proxy. When the plan is ROAS-anchored (`strategy: allocation` with ROAS targets), also run query B and compute per-country ROAS from primary-action `conversions_value` / spend.

**Query A: spend and funnel revenue proxy** (90 days; select `segments.date` so the 30-day slice can be cut from the same rows)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  geographic_view.country_criterion_id,
  segments.date,
  metrics.cost_micros,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
```

**Query B: primary-action conversions** (only when computing ROAS-anchored allocations and a primary action is configured)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  geographic_view.country_criterion_id,
  segments.date,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM geographic_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 89 days>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

Resolve country IDs to names with `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.id IN (<ids>)`.

**Channel-level spend** (last 30 complete days; `segments.date` in the condition only, so each campaign returns one row)

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<yesterday minus 29 days>' AND '<yesterday>'
```

## Computing the distribution

Use Python to build the shares the plan is drafted from:

- **By country:** from query A, sum `cost` per `(customer_id, country)` for the last 30 and the last 90 days, and divide by the account total for each window: `share_pct = country cost / total cost × 100`. With query B, add per-country ROAS = primary `conversions_value` / cost.
- **By channel:** from the channel query, sum `cost` per `advertising_channel_type` and divide by the total.
- **By group:** map campaigns to taxonomy groups (naming schema in `ads/taxonomy.md`) and sum the same way.
- **By tier:** when tiers are declared, sum the country shares per tier.
- **Monthly level:** 30-day total cost, and 90-day total cost / 3, per account. Use these for `total_monthly_ceiling` proposals.

Print the 30-day and 90-day shares side by side. A large gap between the two windows means the mix is shifting: ask which one reflects intent before proposing allocations. Round proposed percentages so each allocation table sums to exactly 100%.

## Plan density scales with complexity

The output file stays at `ads/media-plan.md`. Its structure adapts: don't force density the account doesn't need.

### Simple (1 country, 1 channel, or very small budget)

Minimal doc. Record intent, not allocations.

```markdown
---
title: "Paid ads media plan — Q2 2026 (current)"
type: media-plan
period: 2026-Q2
status: current
created_at: 2026-04-24
strategy: efficiency
---

# Media plan — Q2 2026

## Strategy
Single market (NL), single channel (Search). No fixed allocations — spend what converts at target CPA. Total monthly ceiling: €2,000.

## Markets in scope
NL

## Off-plan
None relevant.
```

### Medium (3–10 countries, multiple channels)

Allocation tables with rationale.

```markdown
---
title: "Paid ads media plan — Q2 2026 (current)"
type: media-plan
period: 2026-Q2
status: current
created_at: 2026-04-24
strategy: allocation
total_monthly_ceiling: €40000
---

# Media plan — Q2 2026

## Strategy
Allocation-based. Primary KPI: blended ROAS ≥ 3.0. Spend paced to declared %; ±10% drift triggers review.

## Allocation by country
| Country | % | Rationale |
|---|---|---|
| NL | 40% | Core market, mature |
| DE | 25% | Tier 1 growth market |
| FR | 20% | Tier 1 growth market |
| UK | 15% | Secondary, English creative reuse |

## Allocation by channel
| Channel | % | Notes |
|---|---|---|
| Search | 60% | Brand + generic |
| PMax | 30% | Retargeting + prospecting |
| Display | 10% | Remarketing only |

## Off-plan exclusions
- AT, CH — no localised landing pages; exclude by geo targeting.
```

### Large (10+ countries, tiers, multiple business units, product lines)

Hierarchical sections.

```markdown
---
title: "Paid ads media plan — Q2 2026 (current)"
type: media-plan
period: 2026-Q2
status: current
created_at: 2026-04-24
strategy: hybrid
total_monthly_ceiling: €250000
---

# Media plan — Q2 2026

## Strategy
Hybrid: tier-level allocations set by leadership; within-tier allocations driven by efficiency.

## Tier-level allocation
| Tier | % | Countries |
|---|---|---|
| Tier 1 | 55% | US, UK, CA, AU |
| Tier 2 | 30% | DE, FR, NL, IT, ES |
| Tier 3 | 15% | Rest |

## Within-tier breakdown
### Tier 1 (55% of €250k = €137.5k)
Efficiency-based; no fixed country %. Bid up where ROAS > 3.5, down where < 2.5.

### Tier 2 (30% of €250k = €75k)
Country fixed at: DE 35%, FR 30%, NL 20%, IT 10%, ES 5%.

### Tier 3 (15% of €250k = €37.5k)
Monitor only. Pause any country <€500/mo with no conversions after 60 days.

## Product line allocations (within total)
| Product | % |
|---|---|
| Product A | 60% |
| Product B | 25% |
| Product C | 15% |

## Flights / seasonal
- Black Friday push Nov 20 – Dec 5: +30% spend across Tier 1 for Product A.

## Off-plan / excluded
- Russia, Belarus, Iran, North Korea — sanctions / policy.
```

Adapt automatically to the account scale detected. Don't render sections that don't apply.

Optional frontmatter that `google-ads-check-pacing` reads: `pacing` (`linear` / `front-loaded` / `back-loaded` / `custom`, default `linear`), `pacing_tolerance` (default 10), `plan_discipline` (`strict` / `flexible`, default `flexible`), and a per-month budget breakdown for quarterly periods. Add them when the user states a preference.

## Strategy field: always declared

`strategy` in the frontmatter captures the overall approach. Valid values:

- `allocation`: fixed % splits per declared dimension (country / channel / product)
- `efficiency`: no hard %; spend driven by performance targets, constrained by caps
- `hybrid`: some dimensions allocated, others efficiency-based
- `ceiling`: total cap only, no positive allocation

Downstream skills (`google-ads-check-geo-targeting`, `google-ads-check-pacing`) read this and behave accordingly. An `efficiency` strategy means the geo-targeting skill won't flag "spend drift vs plan": there's no % plan to drift from.

## Plan validation

Whenever you read an existing `ads/media-plan.md`, validate it. Parse the allocation tables into Python and check:

- **Sums:** if `strategy: allocation` and % tables are present, each table sums to 100% (tolerance ±0.5%). Flag if off.
- **Country coverage:** every country with more than €500/month of 30-day spend (or the equivalent in the account currency) appears in the plan OR is explicitly in `off_plan_exclusions` with a rationale. Flag mismatches.
- **Period:** the `period` frontmatter field is present and isn't stale (warn if it ended more than 6 months ago).
- **No duplicates:** the same country or channel appearing in multiple allocation rows.
- **Tier consistency:** if tiers are declared in `ads/taxonomy.md`, the plan's tier list matches the taxonomy's tier definitions.

Validation results go into the finding body as "things to fix in the plan".

## Drift

When a plan exists (Mode C), use Python to compare each declared allocation with the observed 30-day share on the same dimension: `drift_pp = actual_30d_pct - declared_pct`. Severity: more than 10pp high, 5–10pp medium, under 5pp low.

## Pending or ok

This is an authoring skill, not a diagnostic audit, but it still uses the pending / ok pattern:

- **Pending finding** when there's work to do: no plan exists, the plan is stale, validation failed, the user requested a revision, or an auto-proposed draft needs the user's approval.
- **OK finding** when the current plan is valid, aligned with reality (no significant drift), and the period is current. The body states what was checked ("plan structure valid, all spending countries covered, period is Q2 2026, current").

## Output

One finding: `category: structure` (the plan is account structure), `kind: recommendation` (a proposal to adopt, not an audit diagnostic). Fill the standard body with:

**Wrap-up:** the state the plan is in + the action proposed.
Example: *"No media plan declared. Drafted a proposal based on 90-day spend: NL 42% / DE 24% / FR 19% / UK 15% at €38k/month. Confirm to write to ads/media-plan.md."*

**General improvements** (plan-level, if a plan exists):
- "Current plan period is stale (2025-Q4, today is 2026-Q2); roll to a new period."
- "Plan declares 4 countries but 30-day spend includes 6; update or acknowledge the drift."
- "Strategy field missing from frontmatter; add `strategy: allocation` or `efficiency`."

**Recommendations:** the specific changes to adopt (the draft plan, or the revisions to the existing plan, shown as the proposed file content).

**Details table:** drift analysis (only when a plan exists and Mode C is running):

| account | dimension | declared | actual_30d | drift | severity | recommendation |
|---|---|---|---|---|---|---|

`dimension` = country / channel / tier / product, `declared` = plan %, `actual_30d` = observed %, `drift` = percentage-point difference.

**Pending example, Mode A (bootstrap):**
- title: *Draft media plan for Q2 2026 covering NL, DE, FR and UK*
- summary: *Proposed from 90-day spend: NL 42% / DE 24% / FR 19% / UK 15%. Total €38k/month. Confirm the allocation or adjust.*

**Pending example, Mode C (update):**
- title: *Plan drift: UK +8pp vs declared, DE -6pp; period stale*
- summary: *Declared NL 40% / DE 25% / FR 20% / UK 15% (Q4 2025); actual last 30 days NL 38% / DE 19% / FR 20% / UK 23%. Roll to Q2 2026 and update allocations.*

**OK example (plan valid, current, no drift):**
- title: *Media plan current and aligned; period Q2 2026*
- summary: *Validated structure; all spending countries covered; allocation drift under 5pp on every dimension; period matches today's date.*
- The body describes what was checked and why it passed.

## Workspace writes (when the user confirms)

- The user confirms a draft or revision → write `ads/media-plan.md` with the agreed plan content.
- The user acknowledges intentional drift ("we deliberately shifted UK up for a launch, don't re-flag this") → write a new file under `ads/google/memory/` with a dated note, then add a one-line entry to `MEMORY.md`.
- When rolling periods, before writing the new plan: rename `ads/media-plan.md` to `ads/media-plan-<old-period>.md` (sibling file, no subfolder), change its frontmatter `status: current` to `status: superseded`, and append `(superseded)` to its title. Then write the new plan at `ads/media-plan.md` with `status: current`. Prior periods accumulate as siblings; the current plan is always at the canonical path.

On an unattended run, never write or rename `ads/media-plan.md`; put the proposed plan in the finding.

## Evidence rule

Every proposal cites evidence: *"Proposing UK 15% because 90-day spend was 14.8% and business context marks UK as Tier 1."* Don't propose allocations the data or the declared taxonomy doesn't support. Drift flags cite declared vs actual numbers.
