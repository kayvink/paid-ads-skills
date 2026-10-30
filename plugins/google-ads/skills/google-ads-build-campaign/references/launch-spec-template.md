# Launch spec template

The build spec lives at `ads/google/strategy/launch-<slug>.md`. It is the document the user follows in the Google Ads UI (or an editor import) to build the campaign, and the record `google-ads-health-check` and later audits compare the live campaign against. Keep the section names and table columns stable.

Render only the sections that apply: a PMax spec has asset groups and no keyword tables; a Search spec has no listing groups.

~~~markdown
---
title: "Launch spec: GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_FR_FR"
type: campaign-build
campaign: GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_FR_FR
campaign_type: search          # search | performance_max
structure_slot: GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_FR_FR   # row in account-structure.md, or "none"
motion: Awareness & Activation
market: FR
status: draft                  # draft | ready | launched
created: 2026-07-01
updated: 2026-07-01
accounts: [Acme FR]
---

# Launch spec: GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_FR_FR

> One line: what this campaign is for, what it bids on, its starting budget, and the date it can launch.

## Role

- **Motion and metric:** Awareness & Activation, graded on paid signups within 7 days.
- **Bids on:** `Paid signup` (primary, counted once per click). `Free signup` stays secondary.
- **Theme and message:** "Ship faster with less plumbing." Point of view carried in sitelinks and the brand-voice description lines.
- **Owns these queries:** pipeline and ETL tooling searches in French, in France. Brand, competitor and the "Trust the numbers" theme belong to other campaigns.

## Settings

| Setting | Value | Why | Check |
|---|---|---|---|
| Networks | Google Search only; Search partners off; Display off | Partners tested later against Search CPA | `network-leak-on-search` |
| Locations | France; Presence only | Serve people in the market | `geo-targeting-type` |
| Languages | French | Matches the ad language | |
| Bid strategy | Maximize conversions, no target; add Target CPA €95 after 2–4 stable weeks | New campaign, no history on this goal | `smart-bidding-cold-start` |
| Budget | €103/day (€3,120/month) | Computed below | `account-budget-cap` |
| Conversion goals | Campaign-specific: Paid signup only | One motion per campaign | `single-campaign-multi-motion-bidding` |
| Ad schedule | All hours | The bidder prices time of day itself | |
| Ad rotation | Optimise | | `ad-rotation-mode` |
| Final URL suffix | `utm_source=google&utm_medium=paid_search&utm_campaign=google_search_aa_generic_shipfaster_fr_fr&utm_term={keyword}&utm_content={creative}` | Taxonomy UTM schema | `utm-tagging` |
| Auto-apply recommendations | Off for this account, or limited to approved types | | `auto-apply-settings` |

## Budget and bidding

| Input | Value | Source |
|---|---|---|
| Target CPA | €95 | `ads/google/rules/non-brand.md` |
| Expected clicks / month | 1,300 | 3 comparable campaigns, 90 days |
| Expected CPC | €2.40 | comparable campaigns |
| Expected CVR | 3.1% | comparable campaigns |
| Floor | 30 conversions / 30 days | Search |

| Output | Value |
|---|---|
| Demand-capped spend / month | €3,120 |
| Floor spend / month | €2,850 |
| Media plan allotment / month | €3,500 |
| Recommended budget | €3,120 / month = €103 / day (demand-capped; under the plan allotment, above the floor) |
| Expected conversions / 30 days | 40 |

## Ad groups

| Ad group | Landing page | Keywords | Message |
|---|---|---|---|

## Keywords

| Ad group | Keyword | Match type | Source | Overlap with existing | Action |
|---|---|---|---|---|---|

## Negatives

| Level | List or campaign | Negative | Match type | Reason |
|---|---|---|---|---|

## Routing changes elsewhere (apply at launch)

| Campaign | Change | When | Why |
|---|---|---|---|

## Assets

| Asset | Required | Planned | Status |
|---|---|---|---|

Copy itself: link to the `google-ads-write-ad-copy` output, or paste it here with the character-count check.

## Audiences

| Audience | Type | Size (Search / Display) | Mode | Why |
|---|---|---|---|---|

## Tracking

- Conversion action, status, counting type, last conversion recorded.
- Auto-tagging, tracking template, final URL suffix.

## Pre-launch QA

- [ ] Item (check ID): result

## After launch

| Day | What to look at | Don't |
|---|---|---|
| 1–3 | Serving, impressions, disapprovals, conversions recording | Change bids, targets or budget |
| 7 | Search terms against negatives; routing (no brand or sibling-theme leak) | Judge CPA |
| 14 | First CPA read against the target, with the stability window | Tighten the target by more than 5–10% |
| 28 | Add or tighten the target if volume clears the floor | Switch bid strategy and goal together |

## Open questions
~~~
