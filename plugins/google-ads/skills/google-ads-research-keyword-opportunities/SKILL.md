---
name: google-ads-research-keyword-opportunities
description: Outside-in Google Ads keyword discovery that proposes 3 to 8 new Search keyword themes anchored to the business, real landing pages from the site's sitemap, and converting search terms, each with example EXACT keywords, a suggested landing page, ad copy direction and a volume band. Use when the user asks for new keyword ideas, keyword research, what else they could target, or themes for new ad groups or campaigns. For terms already arriving in the account without a keyword use google-ads-check-keyword-expansion instead.
---

# Research keyword opportunities

> Outside-in keyword discovery. Anchor proposals to the business, the customer's actual landing pages (via the fetched sitemap), and high-converting search terms. Output 3-8 theme clusters with example EXACT keywords, suggested LPs, ad copy direction, and volume bands. Proposal-quality: the user picks themes worth building; the actual ad-group creation happens in the platform.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format.

## Goal

Propose new keyword themes the account isn't yet targeting, anchored to (a) the declared business and products, (b) actual landing pages from the customer's sitemap, (c) existing high-converting search terms as a seed signal. The output is a curated list of 3-8 well-anchored themes, not a dump of 50 thinly justified ideas.

## Scope

Google Ads only. Search-focused: themes apply to Search keyword targeting. Touches PMax indirectly: themes can become candidate Search campaigns that siphon converting queries away from PMax (this overlaps with `google-ads-check-keyword-expansion` recommendations).

## Distinguished from `google-ads-check-keyword-expansion`

| Skill | Direction | Anchor | Output |
|---|---|---|---|
| `google-ads-check-keyword-expansion` | Reactive: what arrived in your account that you don't capture | Existing search terms with conversions | Specific terms to add as EXACT, themed ad groups for recurring tokens |
| `google-ads-research-keyword-opportunities` | Proactive: what themes the business could target that aren't on the radar yet | Business, sitemap and product files | Theme clusters with rationale, sample keywords, suggested LPs, ad copy direction |

Same category (`keywords`), both `kind: recommendation`. Run them together when you want both views; reuse the saved search-term and sitemap results so the second run doesn't re-query.

## Preconditions

- `wiki/company.md`: required. Without business context, the skill can't anchor proposals to anything other than imagination. If it's missing and the user is present, ask them to describe the business and offer to write `company.md` from the answer. In an unattended run, fail closed: write an `ok`-status finding noting the precondition gap.
- Product files (for example `wiki/entities/products/`): optional. They improve theme grounding when present; list the folder and read each file before phase 1.
- The customer's website domain (typically in `company.md`): strongly recommended. When it's known and the agent can fetch web pages, fetch the sitemap on the first run (see input 7) and reuse the saved copy for 7 days.
- `ads/taxonomy.md`: recommended. Used to know what's already declared and avoid proposing themes that duplicate existing taxonomy. Without it the skill runs in **bootstrap mode** (proposes themes without cross-checking declared structure, and flags the limitation in the finding body).

## Context

Ground truths for keyword research. Keyword research is a contested area where vendor narratives and AI-generated lists routinely produce noise; these guardrails matter.

**Anchoring discipline:**
- Don't generate keyword lists from imagination. Every theme must anchor to (a) a real sitemap URL, (b) an existing converting search term, or (c) a declared product. Generating "12 long-tail keyword ideas" untethered from these is hallucination dressed as research.
- Suggested LPs come from the actual sitemap, not invented URL paths. If the sitemap has no LP for a proposed theme, the recommendation includes "needs new LP" as an explicit precondition; don't paper over the gap with a guessed URL.
- 3-8 themes per finding, not 50. Quality over volume. A user evaluating a finding can absorb 5 well-anchored themes; 50 thinly justified ones get dismissed wholesale.

**Volume reality:**
- Volume estimates are bands (`low` / `med` / `high`), not absolutes. Keyword Planner is the only credible source for absolute monthly searches, and the Google Ads MCP doesn't expose it. If the user pastes Keyword Planner numbers, use them per row and keep the bands as a fallback where a keyword has none.
- "Low" doesn't mean skip: long-tail intent often outperforms head terms on conversion rate. Use the volume band as a sizing input, not a gatekeeper.

**Output quality:**
- Ad copy is *direction*, not headlines. RSAs need 15 headlines tested per ad group; LLM-written headlines at proposal stage are throwaway. Output *direction* (tone, primary value prop, USP angle, urgency cue); the build step writes copy.
- EXACT-led match strategy. Same ground truth as `google-ads-check-keyword-performance`: independent data shows EXACT outperforms BROAD on ROAS, CPA and CTR for about 75% of accounts. Theme proposals output EXACT keywords; BROAD goes in only when explicitly justified by Smart Bidding maturity, conversion volume and budget for exploration.

## Inputs you need

1. **Business context:** `wiki/company.md`. If missing, ask the user (or fail closed in an unattended run).
2. **Products:** list the product files (for example `wiki/entities/products/`) and read each. Skip silently if there are none.
3. **Taxonomy:** `ads/taxonomy.md` for declared groupings and current campaign tier names. Brand vs non-brand uses `brand_terms` from `ads/google/index.md`. Missing taxonomy means bootstrap mode.
4. **Memory:** `ads/google/memory/MEMORY.md`. Scan for previously rejected themes and "we don't go after X" notes; read the individual files for full context.
5. **Existing keyword inventory:** the full list of EXACT, PHRASE and BROAD keywords across enabled Search campaigns, for cross-checking and deduplication. Same query as step 1c of `google-ads-check-keyword-expansion`:

   ```sql
   SELECT
     customer.descriptive_name,
     campaign.id, campaign.name,
     ad_group.id, ad_group.name,
     ad_group_criterion.keyword.text,
     ad_group_criterion.keyword.match_type,
     ad_group_criterion.status
   FROM ad_group_criterion
   WHERE campaign.status = 'ENABLED'
     AND campaign.advertising_channel_type = 'SEARCH'
     AND ad_group_criterion.type = 'KEYWORD'
     AND ad_group_criterion.negative = FALSE
   ```

6. **Converting search terms (seed):** a 30-day window ending yesterday, written as an explicit `BETWEEN` range, for each account in scope:

   ```sql
   SELECT
     customer.descriptive_name,
     customer.currency_code,
     campaign.id, campaign.name,
     ad_group.id, ad_group.name,
     search_term_view.search_term,
     search_term_view.status,
     metrics.clicks,
     metrics.cost_micros,
     metrics.conversions,
     metrics.conversions_value,
     metrics.all_conversions,
     metrics.all_conversions_value
   FROM search_term_view
   WHERE campaign.status = 'ENABLED'
     AND campaign.advertising_channel_type = 'SEARCH'
     AND segments.date BETWEEN '<start>' AND '<end>'
   ```

   If a primary event is configured, also run the primary-event query from the two-query pattern in `google-ads-write-gaql-queries` (same resource and window, `segments.conversion_action_name = '<primary_conversion_action>'`, selecting `metrics.conversions` and `metrics.conversions_value`), and left-join it in Python on `(customer_id, campaign.id, ad_group.id, search_term_view.search_term)`. Use Python to sort by primary conversions descending (Google's `metrics.conversions` when no primary is set), drop brand terms, and keep the top 50 as the seed list.

7. **Sitemap:** if `company.md` carries a website domain and the agent can fetch web pages, fetch `https://<domain>/sitemap.xml` (or the `Sitemap:` URL listed in `https://<domain>/robots.txt`), following sitemap index files to their child sitemaps. Save the URL list to the scratch folder and reuse it for 7 days. Use Python to parse the `<loc>` entries and group them into sections by the first one or two path segments (`/products/eco/`), printing the section names and URL counts rather than every URL. If the site can't be fetched, say so and run with reduced anchoring.
8. **Optional competitor URLs:** when the user is present, ask *"any competitor URLs you'd like me to check for theme inspiration?"* and fetch each. Auto-discovering competitors is out of scope.

## Modes

- **Bootstrap:** taxonomy missing or website unknown. Note the cold-start state in the finding body, ask for the missing piece when the user is present, or proceed with reduced anchoring (themes from business and products only) and flag the limitation. Bands remain valid; there is just less cross-checking against declared structure.
- **Verify:** taxonomy and sitemap present. The full pipeline; proposed themes are cross-checked against the existing keyword inventory and declared groupings to avoid duplicates. *"Verify" doesn't mean "audit existing themes"*: it means "verify proposals don't collide with declared structure".

## Phases

1. **Sources:** read business, products and sitemap. Build a working list of what the company sells, serves and publishes.
2. **Existing coverage:** read the taxonomy and the keyword inventory. List the declared tiers and the keywords each currently targets.
3. **Seed signal:** take the 30-day converting terms. Identify themes already proven to convert that may or may not be in keyword targeting. Use Python to mark which seed terms are covered by the inventory (normalise both sides: lowercase, strip punctuation, drop a trailing plural "s" per word, sort the words; covered when the normalised forms match).
4. **Theme proposal:** cluster ideas by intent and audience. Each theme fills the full slot list (see *Theme shape*).
5. **Standalone candidates:** single high-intent terms that don't cluster but warrant attention.
6. **Gaps:** themes the business and sitemap suggest but where preconditions are missing (no LP yet, no campaign tier in the taxonomy yet, and so on). An honest "what's not ready" section.

## Theme shape

Every theme in the output table fills these slots:

- **Name:** a short noun phrase (for example *"Eco-friendly running shoes"*).
- **Rationale anchor:** which inputs drove the theme. One or more of `sitemap`, `converting term`, `product`, `combined`. *Required*; a theme without an anchor is not a theme.
- **Example keywords:** 3-5 EXACT keyword examples, comma-separated in the table cell. Drawn from the anchor sources, not invented.
- **Suggested LP:** a real URL from the sitemap. If no fit exists, write `needs new LP` explicitly; do NOT invent a URL path. To find the fit, use Python to score each sitemap URL by how many of the theme's keyword tokens appear in its path, and take the best non-zero match.
- **Ad copy direction:** a one-line tone and value-prop hint (for example *"Sustainability angle, lifecycle focus, no urgency cue"*). NOT finished headlines.
- **Volume band:** `low` / `med` / `high`, with "confirm with Keyword Planner". Reasoned from the count of converting terms in the account on the theme, the count of LPs on the site for it (both counted in Python), and judgement from the anchor.
- **Coverage gap:** one line on what's currently missing in the keyword inventory or taxonomy that this theme would fill.
- **Severity:** `high` / `medium` / `low`. See the interpretation rules.
- **Recommendation:** a one-line action. Examples: *"Build new ad group in Non-Brand Generic FR"*, *"Brief LP first, then build"*, *"Add to Generic FR as a sub-cluster"*.

## Theme clustering rules

- Cluster by intent and audience, not by surface keyword similarity. *"Eco running shoes"*, *"sustainable running shoes"* and *"recycled running shoes"* are one theme (same intent: an environmentally minded buyer); *"eco running shoes"* and *"eco hiking boots"* are two themes (different intent and audience even though they share the "eco" token).
- Drop themes where the anchor is too speculative: a single converting term with no sitemap fit and no product file is a standalone candidate at most, not a theme.
- Don't propose a theme that duplicates an existing keyword inventory entry. Cross-reference the inventory (input 5) before finalising, using the same normalisation as phase 3. If a theme's example keywords are mostly already in the inventory, drop it or refine it to focus on uncovered variants.
- Don't propose a theme acknowledged as "we don't go after X" in memory. Respect declined themes.

## Interpretation rules

- **Severity:**
  - `high`: high volume band + clear LP fit (an existing sitemap URL) + zero current coverage; the biggest opportunities.
  - `medium`: med volume OR partial LP fit OR partial coverage in an adjacent ad group.
  - `low`: low volume OR a speculative anchor (only one source) OR an LP gap (`needs new LP`).
- **Respect memory:** previously declined themes stay declined until the user explicitly lifts the acknowledgement.
- **Respect the existing keyword inventory:** a theme that proposes adding 5 EXACT keywords where 4 already exist as EXACT in the account isn't a theme; it's noise.
- **Don't estimate business impact in euros or dollars.** Volume bands and the coverage gap are sizing signals; the user decides what to value at €X.
- **Don't write copy.** Direction only. The build step writes RSAs.

## Output

One finding: `category: keywords`, `kind: recommendation`. Fill the standard body as follows.

**Wrap-up:** one line with the theme count and the biggest-opportunity headline.
Example: *"6 theme clusters proposed (3 ready to build, 2 need LPs, 1 needs taxonomy expansion); biggest opportunity 'eco-friendly [X]': the sitemap has 4 LPs, 2 converting terms in the account, no current campaign tier."*

**Per-account summary:** only if multi-account.

**General improvements:** structural notes. Examples:
- *"3 product categories from the sitemap (`/products/eco/*`, `/products/refurbished/*`, `/products/bundles/*`) have zero current keyword coverage."*
- *"The existing 'Generic' tier lumps 4 distinct intents; proposed themes 1, 3 and 4 below could become sub-groups within Generic or a new tier."*

**Recommendations:** strategic. Examples:
- *"Create a new 'Eco' campaign tier in `ads/taxonomy.md` to house themes 1 and 4."*
- *"Theme 5 ('B2B procurement') has no LP; brief an LP before the keyword build."*

**Details table, per theme cluster:**

| theme | rationale_anchor | example_keywords | suggested_lp | ad_copy_direction | volume_band | coverage_gap | severity | recommendation |
|---|---|---|---|---|---|---|---|---|

Sort by severity descending, then volume band descending (high, med, low). Cap at about 10 themes per finding (the 3-8 target lives in the Goal; allow up to 10 when the account genuinely warrants it).

**Standalone candidates section:** the same columns, with `theme: "(standalone)"`. Reserved for single high-intent terms that don't cluster.

**Gaps section:** what the skill noticed but couldn't act on:
- Sitemap-vs-LP gaps (*"The 'Eco' theme has 4 LPs, but they all return 404: site prune in progress?"*)
- Missing inputs (*"`wiki/company.md` doesn't describe the ideal customer; themes are anchored to product only, and an ICP would sharpen messaging direction"*)
- Taxonomy gaps (*"no 'Audience' axis in the taxonomy; proposed themes assume a single audience, so consider declaring audience tiers for a B2B/B2C split"*)

**Suggested next steps:** an explicit label per theme for the user to answer with: `Accept` / `Refine in chat` / `Acknowledge as not relevant` / `Dismiss`. Per-theme labels make it actionable rather than a whole-finding accept or reject.

**Pending example:**
- title: *6 keyword theme clusters; 3 ready to build, 2 need LPs first*
- summary: *Themes anchored to the sitemap (234 URLs across 6 sections) and 12 high-converting search terms over 30 days. Biggest opportunity 'eco-friendly [X]' (4 LPs, no current coverage). 1 standalone candidate worth an EXACT keyword ('vegan running shoes'). Volume bands only; no Keyword Planner data.*

**OK example** (rare for this skill; research usually returns at least a few small things):
- title: *No new theme proposals; current taxonomy covers visible opportunities*
- summary: *Reviewed the sitemap (234 URLs across 6 sections), 47 converting search terms and the declared taxonomy. Existing tiers (Brand, Generic FR, Generic EN, Eco) cover all themes the inputs surfaced. 2 standalone candidates noted but below the severity threshold; logged for future reruns.*
- Body: what was checked (sources, sitemap section count, converting term count, declared taxonomy tiers) and why it passed.

The finding's markdown body carries the full theme list (the per-theme details table, gaps section and recommendations); there is no separate structured payload.

## Workspace writes (when the user confirms)

- The user approves a theme to build → write a new file under `ads/google/memory/` with a dated note, then add a one-liner to `MEMORY.md`. Example: "approved theme 'Eco-friendly running shoes', anchor sitemap+converting; build deferred."
- The user declines a theme as not relevant → write a rejection note under `ads/google/memory/` so the next run doesn't re-propose it. Example: "declined theme 'Refurbished outlet', tested in 2024, low intent in FR."
- The user confirms a sitemap-vs-LP gap is intentional ("we deprecated /products/eco/ pages on purpose") → write it under `ads/google/memory/` so the skill stops flagging it.

In an unattended run, write only the finding; leave memory untouched.

## Evidence rule

Every theme cites: anchor source(s) (sitemap URL, converting term, or product file path), 3-5 example keyword texts, the suggested LP path (real, from the sitemap, or an explicit `needs new LP`), the volume band and its reason, and the coverage gap (what's currently missing in the keyword inventory or taxonomy).

Example:

> *"Theme 'Eco-friendly running shoes': anchored to sitemap section `/products/eco/` (4 URLs) and converting term 'eco running shoes' (3 conversions over 30 days, ROAS 4.1 vs Generic FR avg 3.2). Example keywords: 'eco-friendly running shoes' (EXACT), 'sustainable running shoes' (EXACT), 'recycled running shoes' (EXACT). Suggested LP: `https://example.com/products/eco/running` (closest sitemap match). Ad copy direction: sustainability angle, lifecycle focus, no urgency cue. Volume band: med (≥ 2 converting terms in the account, ≥ 4 LPs on site, no Keyword Planner data). Coverage gap: no current ad group on the 'eco' theme; Generic FR would not segment performance cleanly. Severity: high (clear anchor + LP fit + zero coverage)."*

No "promising opportunity" claims without the anchor, the LP check and the coverage statement.
