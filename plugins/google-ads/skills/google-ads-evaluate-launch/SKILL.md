---
name: google-ads-evaluate-launch
description: Read a product launch brief, check current Google Ads state, and write a paid search strategy for the launch to ads/google/strategy/launch-<slug>.md - new keyword opportunities, existing campaigns to update with fresh ad copy, whether a new campaign is warranted, and whether budget should shift - then tick the launch tracker. Use when the user asks what a launch, release or new feature means for Google Ads, how to support a launch with paid search, or to evaluate the Google Ads side of a launch.
---

# Evaluate launch (Google Ads)

> Read a launch brief, look at current Google Ads state, write a paid strategy recommendation, and tick the launch tracker.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

For a given launch (a directory at `launches/<YYYY-MM-DD>-<slug>/` in the workspace), produce a Google Ads strategy doc that answers: what new keyword opportunity does this open, which existing campaigns need updates, is a new campaign warranted, should budget shift. Output is a planning artefact — not applied changes. The launch tracker gets updated so the marketer sees something happened.

## Scope

The pattern, which other channels can follow the same way:

1. Read the launch brief
2. Look at current channel state
3. Produce a recommendation in the channel's home directory
4. Update the launch tracker (tick the stub + append to Updates + add an Appendix link)

This skill doesn't write the brief or open the tracker; it executes the Google Ads evaluation against a launch that already has them.

## Preconditions

- A launch brief exists: `launches/<YYYY-MM-DD>-<slug>/brief.md`, ideally with a `tracker.md` next to it. If the workspace has no `launches/` folder, ask the user to point at a brief file or paste the brief, and skip step 8 (there is no tracker to update).
- A Google Ads MCP is connected and `ads/google/index.md` lists the accounts in scope.
- `wiki/company.md`, product pages under `wiki/`, `solutions/` and `brand/tone.md` are populated, for context. Degrade gracefully if thin.

If the brief or the Google Ads connection is missing, surface that to the user and stop. Don't write a half-baked recommendation.

## Inputs you need

1. **The launch:** ask the user which launch to evaluate, or pick the most recent one in `launches/` if obvious. Read `launches/<slug>/brief.md` and `launches/<slug>/tracker.md`.
2. **Brief context via its Appendix links:** follow `### Products`, `### Solutions affected`, `### Personas affected` and read those pages.
3. **Brand voice:** read `brand/tone.md` and `brand/messaging.md` when present (for any ad copy suggestions).
4. **Live Google Ads state**, for each account in scope:
   - `list_accessible_customers` for what's connected; refer to accounts by `customer.descriptive_name`
   - GAQL: enabled campaigns + last-30-day spend + theme overlap with the launch (step 3)
   - GAQL: search-term and keyword performance for the launch's themes over the last 30 days (step 2)
   - Read `ads/google/index.md`, `ads/google/memory/MEMORY.md`, `ads/taxonomy.md`
   - List `ads/google/rules/` and read the files for performance targets per group

## Method

### Step 1 — Frame the evaluation

Read the brief. Identify:
- The hero capability (what users can now do)
- The 1-3 themes that map to keyword space (e.g. "invoice risk scoring" → invoice + risk + payment risk + credit risk)
- The persona being courted via paid (usually the buyer persona, not the user)
- The competitive angle if any (`closes-gap` etc.)

In one or two short lines, restate the launch back to the user in marketer-language and confirm the themes you'll evaluate against. Wait for confirmation before going deep. (In an unattended run, proceed with the themes as read and list them in the doc's open questions.)

### Step 2 — Keyword opportunity

Run the `google-ads-research-keyword-opportunities` skill:

1. Scope it to the launch's themes + the affected solution's market requirements
2. Take its output (recommended keywords with volume, KD, match types, proposed campaign placement) and weave the highlights into the strategy doc

Don't duplicate that skill's logic — orchestrate it. If it surfaces 30 candidates, narrow to the 5-10 most defensible for this launch.

Check what the account already sees for the themes:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  search_term_view.search_term,
  search_term_view.status,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions
FROM search_term_view
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  ad_group.id, ad_group.name,
  ad_group_criterion.keyword.text,
  ad_group_criterion.keyword.match_type,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions
FROM keyword_view
WHERE ad_group_criterion.status = 'ENABLED'
  AND campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use Python to filter both results to rows whose search term or keyword text contains any theme token (lowercase, whole-word match), then sum clicks, cost and conversions per theme and per campaign. A theme with converting search terms but no matching keyword is evidence for a keyword opportunity; a theme already covered by keywords is evidence against a new campaign. If the research skill isn't installed, use these results plus the brief as the keyword source and say that volume and KD weren't researched.

### Step 3 — Existing campaign fit

Pull current active campaigns over the last 30 days ending yesterday. Leave `segments.date` out of the `SELECT` so each campaign comes back as one 30-day row (impression share is a ratio and can't be summed over days):

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id, campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign_budget.amount_micros,
  metrics.cost_micros,
  metrics.impressions,
  metrics.conversions,
  metrics.conversions_value,
  metrics.search_impression_share,
  metrics.search_budget_lost_impression_share,
  metrics.search_rank_lost_impression_share
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND segments.date BETWEEN '<start>' AND '<end>'
```

Use Python to find the overlapping campaigns: a campaign overlaps when its name, or a keyword or search term in it from step 2, contains a theme token. Print for each: spend, conversions, search impression share, and budget and rank lost impression share.

For each overlapping campaign, two questions:

a) **Ad copy** — does the launch's hero capability suggest fresh ad copy / sitelinks / callouts? If yes, list 2-3 specific copy angles drawn from `What's new` in the brief, written in the brand voice.

b) **Impression-share constraint** — is `metrics.search_impression_share` materially below 1.0 for this campaign? If yes, the launch's theme is reaching budget/rank limits. Flag for the budget-shift step, and say which loss (budget or rank) dominates.

### Step 4 — New campaign candidate

Only flag a new campaign when:
- `launch_type: major` in the brief, OR
- The keywords surfaced in step 2 are clearly outside the structure of any existing campaign (different audience, different funnel stage, different geo)

If yes, propose:
- Campaign type (Search / PMax / Demand Gen — usually Search for B2B feature launches)
- Initial budget range (anchor to existing similar campaigns' daily budgets and spend from step 3; don't fabricate)
- 3-5 starter keywords with match types (from step 2's output)
- 1-2 starter ad copy options drawn from the brief's hero claim, in brand voice

If no, write: "No new campaign recommended — keywords fit existing structure. See campaign updates in step 3."

### Step 5 — Budget shift

If step 3 surfaced an impression-share-constrained campaign AND `competitive_angle: closes-gap` in the brief, propose a 30-day budget shift:
- Source (which campaign / theme to shift from) — pick the lowest-marginal-return one in `ads/google/rules/` if available, otherwise the lowest-converting active campaign in the last 30 days. In Python, rank the non-destination campaigns from step 3 by CPA (highest first; or by ROAS, lowest first, for value-based groups) and take the top one.
- Destination (the constrained campaign relevant to the launch)
- Magnitude — modest by default (10-20% shift); bigger only if the constraint is severe (search_impression_share < 0.5). Compute the amount from the source campaign's daily budget (`amount_micros / 1e6`).
- Expected impact — qualitative ("more impressions on the launch theme", not fabricated forecasts)

Otherwise omit this section.

### Step 6 — Open questions

What you couldn't determine from data and need user input on. E.g. "is there an embargo on the invoice risk scoring launch externally? — affects whether we update ad copy now or after press date."

### Step 7 — Write the strategy doc

Path: `ads/google/strategy/launch-<slug>.md`.

Frontmatter:
```yaml
---
title: Google Ads strategy for <launch title>
type: ad-strategy
launch_id: <slug>           # back-reference so the launch tracker can find this
created: <today>
updated: <today>
---
```

Body sections:
1. `# Google Ads strategy for <launch title>`
2. One-line BLUF blockquote — what we recommend for paid in light of this launch
3. `## Launch context` — one short paragraph summarising the brief in paid terms
4. `## Keyword opportunity` — table from step 2: Keyword | Volume (mo) | KD | Match type | Proposed campaign
5. `## Existing campaigns to update` — per-campaign block: current state, what to change, why
6. `## New campaign candidate` — populated if step 4 flagged one; otherwise the explicit "not needed" line
7. `## Budget shift recommendation` — populated if step 5 applies; otherwise omit
8. `## Open questions` — from step 6
9. `## Appendix`
   - `### Brief` — link to `launches/<slug>/brief.md`
   - `### Sources` — links to product / solutions / competitor pages used
   - `### Related findings` — any open Google Ads findings in `ads/google/findings/` touching this theme

Use plain relative links between workspace files.

Also write the run's finding (conventions section 4, `kind: recommendation`, `category: keywords` or `structure`): the wrap-up is the BLUF line, the recommendations table lists the changes the user would apply, and the body points to the strategy doc.

### Step 8 — Update the launch tracker

Read `launches/<slug>/tracker.md`. Make three targeted edits, using the link style the tracker already uses (wikilinks or relative markdown links):

1. **Tick the stub inline.** In the `## Paid (Google Ads)` section, replace:
   ```
   - [ ] Evaluate google ads changes
   ```
   with:
   ```
   - [x] Evaluate google ads changes → [launch-<slug>](../../ads/google/strategy/launch-<slug>.md)
   ```
   If the team's tracker template doesn't have a Paid section (they removed it), skip this step — they explicitly opted out of paid tracking. Just append the Updates entry and the Appendix link.

2. **Append to `## Updates`:**
   ```markdown
   ### YYYY-MM-DD — `google-ads-evaluate-launch`
   <one-paragraph summary in plain English>. Detail in [launch-<slug>](../../ads/google/strategy/launch-<slug>.md).
   ```
   The summary should call out the headline finding: how many keyword opportunities surfaced, which existing campaign needs an update, whether a budget shift is recommended. No GAQL, no campaign IDs — descriptive names only.

3. **Append a link to `## Appendix → Channel work for this launch`:**
   ```markdown
   - [launch-<slug>](../../ads/google/strategy/launch-<slug>.md)
   ```

With the user present, show the three edits and make them when the user agrees. In an unattended run, make them (the tracker is a work log, not one of the protected files in conventions section 3).

### Step 9 — Confirm and exit

Tell the user:
- Path the strategy doc landed at
- Tracker updated (which stub ticked, what was appended)
- Headline finding (one or two lines)
- Suggested next step: review the strategy doc; apply the recommended changes in the Google Ads UI, or walk through specific campaigns in a follow-up conversation.

## Plain-language rule

The user is a marketer. Translate Google Ads internals to plain language in the conversation:

| Internal | Say |
|---|---|
| GAQL / customer ID | (drop — refer to accounts by descriptive name) |
| `metrics.search_impression_share` | "this campaign is hitting its budget / rank ceiling" |
| `keyword.match_type: EXACT` | "exact match" |
| `metrics.cost_micros` | currency amounts (divided by 1,000,000) |
| `campaign.status: ENABLED` | "active" |
| Customer ID 123-456-7890 | "your Acme Search NL account" (descriptive name) |

Customers and accounts always go by their **descriptive name**, never by ID.

## Don't

- Don't apply changes. This skill writes a recommendation; the Google Ads MCP is read-only and the user makes the changes.
- Don't fabricate metrics or forecasts. If you don't know expected impact, write a qualitative description.
- Don't tick a stub that doesn't exist. If the team's tracker template doesn't have a Paid section, the user opted out — just write the Updates entry + Appendix link.
- Don't overwrite the strategy doc on re-run. If `ads/google/strategy/launch-<slug>.md` exists, surface that to the user and ask whether to update or treat as a fresh draft (in an unattended run, append a dated `## Update YYYY-MM-DD` section instead).
- Don't surface engineering / system terms in the conversation — see Plain-language rule.
