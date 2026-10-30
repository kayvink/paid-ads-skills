---
name: google-ads-create-channel-rules
description: Create, import or revise per-group Google Ads rule files in ads/google/rules/ (brand, non-brand, Performance Max, Shopping, Display, Video, Demand Gen), each declaring the primary KPI and target, the budget cap and floor, and scale, reduce and pause thresholds, with targets anchored to the account's observed 30- and 90-day performance rather than textbook numbers. Use when the user asks to set targets, ROAS or CPA goals, or budget guardrails per campaign group, to review whether existing targets still fit, or when google-ads-check-pacing needs rules that don't exist yet.
---

# Create channel rules

> Seed per-channel-group performance rules at `ads/google/rules/<group>.md`: primary KPI + target + budget + health thresholds, per group (brand / non-brand / pmax / shopping / display / video / demand-gen). Targets are anchored to the account's observed performance, not textbook numbers.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

Produce (or update) per-group rule files that declare what each campaign group is optimised for, what budget it operates within, and what thresholds should trigger scale / reduce / pause decisions. Downstream skills (`google-ads-check-geo-targeting`, `google-ads-check-pacing`, performance audits) read these files to know what "good" looks like for each group; without them, audits fall back to vague "vs account average" comparisons.

## Scope

Google Ads. Rules for other channels are out of scope.

## Three modes

### Mode A: Bootstrap from observed performance (no rules yet)

The standard path. There's enough data to propose anchored rules from reality.

1. Read `ads/taxonomy.md` for declared groups (brand / non-brand / pmax / etc.). If the taxonomy is undeclared, stop and direct the user to run the `google-ads-check-naming-convention` skill first: rules are group-specific and need groups to be named.
2. Read `wiki/company.md` for business context. It sets the target KPI direction (e.g. lead-gen B2B → CPA focus; e-commerce → ROAS focus).
3. Pull 30- and 90-day performance per group via GAQL (queries below). Map campaigns to groups via the declared naming schema (brand / non-brand tokens from the taxonomy).
4. For each group, propose:
   - **Primary KPI:** match it to the bidding strategy in use and the business type. If brand campaigns run Target ROAS at 4.0 and achieve 5.2, propose `ROAS target ≥ 4.5` (current bidding target with slight stretch).
   - **Budget:** cap anchored to 30-day spend; floor at €30–50/day or whatever keeps bidding learning healthy.
   - **Health thresholds:** 120% / 70% / 50% of target at 14 / 14 / 30 days (standard scale / reduce / pause cadence).
5. Write one finding with the per-group proposals. When the user confirms, write each group's file.

### Mode B: Import from user-provided targets

The user already has documented targets (from a strategy doc, BI dashboard, or handed down from leadership) that should be codified.

1. The user pastes targets or states them in conversation ("brand should be ROAS > 5, non-brand > 2").
2. Parse them and reconcile with observed reality; flag mismatches ("you said brand ROAS > 5, current is 3.2: is the target aspirational or is current performance wrong?").
3. Propose rule files aligned to the user-declared targets, with observed performance alongside for context.

### Mode C: Update / revise (rules exist, periodic review)

Rules exist; the user wants to revise them or reality has shifted meaningfully.

1. Read the existing rule files.
2. Pull current 30-day performance per group.
3. Compare declared targets vs observed. Flag significant drift in either direction (target far easier than current reality = obsolete; target far harder than reality = aspirational but maybe wrong).
4. Propose updates. On confirmation, rename the old file to `<group>-<timestamp>.md` with `status: superseded`, and write the new current file.

## Inputs you need

1. **Business context:** `wiki/company.md`. Business type sets KPI direction.
2. **Taxonomy:** `ads/taxonomy.md`. Declared groups. **Required**: the skill cannot run without groups declared.
3. **Memory:** `ads/google/memory/MEMORY.md`. Scan for acknowledged targets or constraints; read the individual files for full context.
4. **Existing rule files:** list `ads/google/rules/` and read each file. Decides Mode A vs Mode C per group.
5. **Media plan:** `ads/media-plan.md` for total budget context; rule-level caps should sum to something reasonable against the media plan total.
6. **Primary conversion action:** `ads/google/index.md`.
7. **Live performance per group:** the queries below, for each account in scope. Proposed per-group targets (ROAS, CPA) are anchored to the **primary-action** count from query B when configured; otherwise proposals drift toward an aggregate that doesn't match what bidding strategies optimise for. Join in Python on `(customer_id, campaign.id)`.

Run each query twice: once for the last 30 complete days and once for the last 90. Don't select `segments.date`, so each campaign comes back as one row per window.

**Query A: spend, structure and funnel conversions**

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.advertising_channel_type,
  campaign.bidding_strategy_type,
  campaign.target_roas.target_roas,
  campaign.target_cpa.target_cpa_micros,
  campaign.maximize_conversion_value.target_roas,
  campaign.maximize_conversions.target_cpa_micros,
  campaign_budget.amount_micros,
  metrics.cost_micros,
  metrics.clicks,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<window start>' AND '<yesterday>'
```

The current bidding target lives in `target_roas` / `target_cpa` for the standalone Target ROAS / Target CPA strategies and in `maximize_conversion_value.target_roas` / `maximize_conversions.target_cpa_micros` when a target is set on Maximize Conversion Value / Maximize Conversions; take whichever is non-zero. Portfolio strategies keep their target on the `bidding_strategy` resource instead.

**Query B: primary-action conversions** (skip when no primary action is configured, and add `metrics.conversions` / `metrics.conversions_value` to query A instead)

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  segments.conversion_action_name,
  metrics.conversions,
  metrics.conversions_value
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<window start>' AND '<yesterday>'
  AND segments.conversion_action_name = '<primary_conversion_action>'
```

## Computing per-group performance

Use Python:

1. Map each campaign to its group via the taxonomy's declared naming schema (e.g. a regex for brand tokens; channel type for pmax / shopping / display / video / demand-gen). Print unmapped campaigns and their spend.
2. Aggregate per `(customer_id, group)` and window: total cost (from A), total primary conversions and primary conversion value (from B), total `all_conversions` (from A, funnel context for the finding body), the summed daily budgets (`campaign_budget.amount_micros / 1e6`), and the spend-weighted current bidding target.
3. Derive ROAS = primary conversion value / cost and CPA = cost / primary conversions from the sums (NaN with no conversions).
4. Print one row per group: 30-day and 90-day spend, conversions, ROAS or CPA, the bidding strategy mix, and the current bidding target.

## Proposing the numbers

Use Python to compute the proposals so the rule files carry consistent arithmetic:

- **Target:** start between the current bidding target and observed performance, with slight stretch. The brand example: bidding target 4.0, observed 5.2 → midpoint 4.6, proposed `≥ 4.5`. Round to a clean value. Without a bidding target, anchor to the observed 30-day value and check it against the 90-day value; propose a slight stretch from the more conservative of the two.
- **Monthly cap:** anchored to 30-day spend with small headroom (the brand example: €3,200 observed → €4,000 cap).
- **Daily floor:** €30–50/day (in the account currency), or whatever keeps bidding learning healthy.
- **Health thresholds** for a ROAS target `T`: scale when ROAS > 1.2 × T for 14 days, reduce when ROAS < 0.7 × T for 14 days, pause when ROAS < 0.5 × T for 30 days AND spend > €500. For a CPA target `T` (lower is better) apply the same ratios inverted: scale when CPA < T / 1.2, reduce when CPA > T / 0.7, pause when CPA > T / 0.5 (2 × T) for 30 days AND spend > €500.
- **Cap check:** sum the proposed monthly caps across groups and compare with the media plan's total monthly ceiling; say in the finding whether they fit.

## Rule file structure

Every `ads/google/rules/<group>.md` file has the same shape:

```markdown
---
title: "Brand campaign rules (current)"
type: rules
group: brand
status: current
created_at: 2026-04-24
---

# Rules — Brand campaigns

## Primary KPI and target
- **KPI**: ROAS
- **Target**: ≥ 4.5 (last-30d observed: 5.2; current bidding target: 4.0)
- **Bidding strategy**: Target ROAS (matches KPI)
- **Primary conversion**: `purchase_completed`

## Budget
- **Monthly cap**: €4,000 (last-30d spend: €3,200; small headroom for seasonal peaks)
- **Daily floor**: €50 (keeps Smart Bidding in active learning)
- **Notes**: uncapped exploration not appropriate for brand — conversion volume is stable.

## Health thresholds
- **Scale signal**: ROAS > 5.4 (120% of target) for 14 days → consider +20% budget
- **Reduce signal**: ROAS < 3.15 (70% of target) for 14 days → consider -20% budget
- **Pause signal**: ROAS < 2.25 (50% of target) for 30 days AND spend > €500 → pause pending review
```

Group-specific notes (optional, only where there's something distinctive):
- **brand:** keyword discipline (exact match + full negative coverage), landing page alignment
- **non-brand:** query quality monitoring cadence, negative keyword review frequency
- **pmax:** audience signal dependency, brand exclusion setup
- **shopping:** product-group segmentation approach, merchant feed linkage
- **display:** placement exclusion list location, frequency capping
- **video:** view-through attribution consideration, creative length expectations

Add these inline only where relevant; don't pad every file with irrelevant sections.

## Per-group default KPIs (when business context is clear)

| Business | Brand | Non-brand | PMax | Shopping | Display | Video |
|---|---|---|---|---|---|---|
| E-commerce | ROAS | ROAS | ROAS | ROAS | ROAS (view-through) | ROAS or CPV |
| B2B lead-gen | CPA (MQL) | CPA (MQL) | CPA | n/a | CPL | CPV |
| SaaS subscription | CPA (trial) | CPA (trial) | CPA | n/a | CPA (view-through) | CPV |

These are defaults: actual targets come from current performance + slight stretch, not textbook numbers.

## Density scales with complexity

Same principle as the media plan. File content scales:
- **Simple** (1 group active): one file, short. Maybe just the primary KPI + monthly cap. Health thresholds declared but minimal.
- **Medium** (3–5 groups): the full three-section file per group. Every group gets its own file.
- **Large** (6+ groups, multiple business units): full files per group, plus any cross-group notes if business constraints exist (e.g. *"brand budget should not exceed 30% of non-brand spend, reviewed monthly"*). Record such cross-group notes in the finding for now rather than in a rules file.

## Validation

When reading existing rule files, check in Python against the observed 30-day numbers:
- **Target vs reality sanity:** if the declared target is more than 3× harder than observed (e.g. target ROAS 10 when observed is 3; for CPA, a target below one third of observed CPA), flag it as aspirational: is this intentional?
- **Target vs bidding alignment:** the KPI should match the bidding strategy. A ROAS target with Manual CPC bidding is a mismatch.
- **Budget cap vs observed spend:** the cap should be reasonable (not 10× current spend, or 0.5× current spend, without explanation).
- **Stale period:** `created_at` more than 6 months old → recommend review.
- **Missing groups:** every group in the taxonomy should have a rules file; flag missing ones.

In Mode C, a target within 20% of observed performance counts as current (`drift_pct = (observed - target) / target × 100`).

## Output

One finding: `category: structure`, `kind: recommendation`. Fill the standard body with:

**Wrap-up:** the state of rule coverage + the top issue or proposal.
- Mode A: *"No rules declared. Drafted 4 rule files (brand, non-brand, pmax, shopping) with targets anchored to last-30-day performance. Confirm to write."*
- Mode C: *"3 of 6 rule files have drifted meaningfully from observed reality; 2 are stale (more than 6 months old)."*

**General improvements** (ruleset level, in Mode C):
- "Brand target ROAS 4.0 was set in Q3 2025; the last 90 days average 5.8. Raise the target to 5.0?"
- "Non-brand rules file missing; the group exists in the taxonomy with 28% of spend."
- "PMax KPI is CPA but the bidding strategy is Maximize Conversion Value: mismatch."

**Recommendations:** the specific rule file changes, with the proposed file content.

**Details table:** drift analysis (Mode C) or proposal summary (Mode A):

| account | group | current_target | observed_30d | proposed_target | severity | recommendation |
|---|---|---|---|---|---|---|

**Pending example (Mode A bootstrap):**
- title: *Draft rules for 4 groups: brand, non-brand, pmax and shopping*
- summary: *Targets anchored to last-30-day performance: brand ROAS 4.5, non-brand 2.0, pmax 3.0, shopping 4.2. Total monthly cap aligned with the €38k media plan ceiling.*

**Pending example (Mode C update):**
- title: *3 rule files have drifted; 2 stale (more than 6 months old)*
- summary: *Brand target ROAS 4.0 vs observed 5.8; non-brand target CPA €45 vs observed €28; pmax file last edited Q3 2025. Roll the period and adjust.*

**OK example (rules valid, current):**
- title: *Rules current across 5 groups; targets within a reasonable range of observed performance*
- summary: *All declared groups have rule files; targets differ from observed by under 20%; all periods recent.*
- The body describes what was checked per group and why each passed.

## Workspace writes (when the user confirms)

- The user confirms a draft or revision → write `ads/google/rules/<group>.md` for each group with the agreed content.
- When updating a group's rules: before writing, rename `ads/google/rules/<group>.md` to `ads/google/rules/<group>-<old-timestamp>.md`, change its frontmatter `status: current` to `status: superseded`, and append `(superseded)` to its title. Then write the new current file. Prior versions accumulate as siblings; the current one is always at the canonical path.
- The user acknowledges intentional target divergence ("we're keeping brand at ROAS 4 as the target even though we hit 6, because we want to protect impression share") → write a new file under `ads/google/memory/` with a dated note, then add a one-line entry to `MEMORY.md`.

On an unattended run, never write or rename files in `ads/google/rules/`; put the proposals in the finding.

## Evidence rule

Every proposed target cites observed performance: *"Proposing ROAS ≥ 4.5 for brand because the last 30 days were 5.2 and the current bidding target is 4.0: the midpoint, with stretch headroom."* Don't propose targets that can't be justified from data + business context + bidding strategy.
