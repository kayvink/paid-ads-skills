# Account structure document template

The target structure lives at `ads/google/strategy/account-structure.md`. Other skills read it: `google-ads-build-campaign` builds one row of the campaign map at a time, `google-ads-create-channel-rules` sets targets per group, `google-ads-create-media-plan` allocates budget, and audits use it to know what each campaign is for. Keep the section names and table columns stable so they can be parsed.

Density scales with the account. A single-market account with three campaigns gets a one-page doc: render only the sections that have content, but always keep the frontmatter, the motions table and the campaign map.

~~~markdown
---
title: "Google Ads account structure (current)"
type: account-structure
framework: b2b            # b2b | b2c-ecommerce | b2c-growth
business_type: b2b-hybrid # as recorded in wiki/company.md
period: 2026-Q3           # the quarter this mapping is locked for
status: current           # current | draft | superseded
created: 2026-07-01
updated: 2026-07-01
accounts: [Acme NL, Acme DE]
---

# Google Ads account structure

> One line: what the account is built to do, and the biggest change from the current state.

## Motions in Google Ads

| Motion | Primary metric (graded on) | Bids on (conversion action) | Campaign groups | Share of Google Ads budget |
|---|---|---|---|---|
| Awareness & Activation | Paid signups, free-to-paid % | `Paid signup` (primary), `Free signup` (secondary) | brand, non-brand, competitor | 70% |
| Contact Acquisition | Cost per qualified record | `Report download` | gated-content | 15% |
| Demand Generation | MQL-to-SQL %, sourced pipeline | `Qualified lead (offline import)` | remarketing | 10% |
| Authority | Share of voice | none (target CPM) | video-authority | 5% |
| (not in Google Ads) | | | | |

Motions with no Google Ads campaigns are listed with the reason ("Conversion: on-site CRO, not paid media").

## Narrative

**Point of view:** "The data team is now a product team." Lives in brand Search copy and the Authority video.

| Theme | Buyer language (validated against search terms) | Products mapped | Google Ads home |
|---|---|---|---|
| Ship faster with less plumbing | "data pipeline tool", "etl without code" | Ingestion, Transformation, Storage | `GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_NL_NL` |
| Trust the numbers | "data quality monitoring", "data governance" | Analytics, Governance, Storage | ad group in `GOOGLE_SEARCH_AA_GENERIC_TRUST_NL_NL` |
| Open the data to the business | "self-service analytics" | Analytics, Governance | ad group in `GOOGLE_SEARCH_AA_GENERIC_TRUST_NL_NL` |

## Campaign map

| Campaign (per taxonomy) | Type | Motion | Group | Theme | Market | Bid strategy (start → steady) | Conversion goal | Budget share | Expected conv / 30d | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| GOOGLE_SEARCH_AA_BRAND_ALL_NL_NL | Search | A&A | brand | all | NL | Target impression share → keep | Paid signup | 12% | 140 | keep |
| GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_NL_NL | Search | A&A | non-brand | Ship faster | NL | Max conversions → Target CPA | Paid signup | 30% | 45 | merge (from 3) |
| GOOGLE_PMAX_AA_GENERIC_ALL_NL_NL | PMax | A&A | pmax | asset groups by theme | NL | Max conversions → Target CPA | Paid signup | 18% | 60 | new |

`Status` is one of `keep`, `rename`, `merge (from N)`, `split`, `new`, `retire after migration`. `Expected conv / 30d` is computed (step A4 or B6), never guessed.

## Inside each campaign

### GOOGLE_SEARCH_AA_GENERIC_SHIPFASTER_NL_NL

| Ad group | Product or sub-theme | Landing page | Message (from the theme) |
|---|---|---|---|
| INGESTION | Ingestion | /product/ingestion | Ship pipelines without plumbing |
| TRANSFORMATION | Transformation | /product/transformation | ... |

For PMax: asset groups with theme, final URL, audience signal and search themes. For Shopping: listing-group split (category, margin tier, stock label).

## Routing rules

- Brand terms (`brand_terms` in `ads/google/index.md`) are exact-match negatives in every non-brand Search campaign and a brand exclusion list on every PMax campaign.
- Competitor terms live only in the competitor campaign: list kept in shared negative list `Competitors` applied to generic campaigns.
- Each theme's core terms are negatives in the sibling theme campaigns, so a query has one owner.

## Budget by motion

| Motion | Framework starting share (whole marketing) | Google Ads share (renormalised) | Proposed Google Ads share | Observed 30-day share | Why it differs |
|---|---|---|---|---|---|

## Migration plan

Present only for audit-and-restructure. One row per step, grouped by wave.

| Wave | Week of | Step | Campaigns touched | Spend touched (30d) | Learning-phase risk | Why this order | Rollback |
|---|---|---|---|---|---|---|---|

## Guardrails

The anti-patterns this structure is designed against, each with the check that would catch a regression.

## Decision log

- 2026-07-01: Structure adopted for 2026-Q3. Motion mapping locked until the quarter boundary.
~~~
