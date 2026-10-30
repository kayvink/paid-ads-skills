# Motion frameworks mapped to Google Ads

The structure this skill designs sits on one of three motion frameworks. Each splits marketing into four motions that run in parallel. Each motion has one objective, one primary metric and a defined set of channels. Google Ads serves only some of the motions in each framework. This file says which framework fits which business, which Google Ads campaign types serve each motion, what each campaign bids on and what it is graded on, the starting budget split, and the anti-patterns to design against.

Three rules hold in every framework:

1. **A channel can be shared across motions; a campaign cannot.** Google Ads serves several motions, so it runs several programs. Each campaign has exactly one motion, one brief, one conversion goal and one primary metric. A campaign that tries to serve two motions underperforms on both.
2. **Grade a campaign on its motion's metric, never on another motion's.** Paid search in a B2B account is graded on signups, not on pipeline. A brand video campaign is graded on reach and brand search, not on CPA. Cross-motion comparison is invalid by construction.
3. **Every motion produces a primary number.** A motion without a number does not get a budget line.

## Picking the framework

Read the business type from `wiki/company.md`. The values below are the same ones `google-ads-health-check` uses for its `primary-event-quality` check.

| Business type in `wiki/company.md` | Framework | Notes |
|---|---|---|
| `b2b-self-serve`, `b2b-sales-led`, `b2b-hybrid` | B2B four-motion | Multiple solutions, long sales cycle, marketable-contact gate |
| `b2c-ecommerce` (DTC, marketplace seller, retail-led, CPG ecommerce) | B2C ecommerce four-motion | Transactional, inventory-bound, promotional calendar |
| `b2c-subscription` (consumer SaaS, freemium apps, streaming, fitness, learning, consumer fintech, prosumer tools) | B2C growth four-motion | Recurring or engagement-driven revenue |
| Subscription DTC (physical product, recurring revenue) | B2C growth, plus the ecommerce inventory and promotional-calendar overlays | The bridge case: retention math dominates |
| Hybrid (subscription plus one-time, DTC plus retail) | The framework of the larger revenue line, borrowing overlays from the other | Ask the user which line Google Ads mainly serves |

If the business type is missing or ambiguous, ask once: "Is the business mainly B2B (self-serve, sales-led or both), transactional ecommerce, or a subscription or engagement-driven consumer product?" Offer to record the answer in `wiki/company.md`.

## The two-layer narrative

Every framework puts two narrative layers above the motions. In Google Ads they decide what the campaigns, ad groups and asset groups are cut by, and what the ads say.

| Layer | B2B | Ecommerce | Growth | Where it lives in Google Ads |
|---|---|---|---|---|
| Point of view (one, multi-year) | Category POV: where the market is heading. Sells no product; earns the meeting. | Brand POV: how the product fits the buyer's life. Sells no SKU. | Brand POV: how the product fits the user's life. Sells no feature. | Brand Search ad copy and sitelinks; YouTube and Demand Gen brand or authority creative; PMax brand-level headlines and video. Never a keyword list. |
| Themes (three or four, refreshed annually) | Solution themes: buyer-validated pain points, in buyer language, grouping the products | Use-case themes: occasions, problems or lifestyles, in buyer language | Use-case themes: moments, occasions or jobs, in user language | The cut for non-brand Search campaigns or ad groups, PMax asset groups and Demand Gen ad groups. The theme is the message of every ad inside it. |
| Inventory (rotates) | Products | Collections and SKUs | Features and plan tiers | Ad groups inside a theme (one product's keywords and landing page), Shopping and PMax listing groups, sitelinks. |

Rules for the theme layer:

- **Three or four themes, never more.** A new product maps to an existing theme. If it doesn't fit any, revisit whether the theme set is still right; don't add a fifth theme.
- **Buyer language, not product language.** A theme name a buyer wouldn't use to describe their problem is internal jargon. The search terms report is a cheap validation: themes whose words never appear in converting search terms are suspect.
- **One product, many themes is fine.** A product that serves two themes gets an ad group (or listing group) in each, with copy written to that theme's pain.
- **Single-product companies use one theme.** The motions still apply; the horizontal scaling doesn't.

## B2B four-motion framework

| Motion | Objective | Primary metric (graded on) | Google Ads campaigns | Bids on | Contribution window |
|---|---|---|---|---|---|
| Awareness & Activation (A&A) | Pull category-curious buyers to owned surfaces; convert self-serve users | Signup volume, free-to-paid conversion, unique visitors | Brand Search; non-brand Search by solution theme; competitor Search; PMax for self-serve signups; YouTube and Demand Gen prospecting | Self-serve: activation or paid signup when it clears the floor, else signup. Sales-led: the first hand-raise (demo or trial request), or a CRM-qualified lead imported offline when it clears the floor. | Signups within about 7 days |
| Contact Acquisition (CA) | Build the marketable contact database | Cost per qualified record, database growth rate | Search or Demand Gen promoting gated content, reports, assessments and webinars; Demand Gen and YouTube with lead form assets | The content download, webinar registration or lead form submit | Records within about 30 days |
| Demand Generation (DG) | Activate the marketable database into pipeline | MQL-to-SQL conversion, sourced pipeline value | Remarketing to marketable contacts: Customer Match and website lists on Display, Demand Gen and YouTube; RLSA bid layers on Search (observation, not a separate campaign) | A qualified lead or opportunity imported offline (`QUALIFIED_LEAD`, `CONVERTED_LEAD`); never the raw form fill | 60 to 90 days |
| Authority | Shift category perception; reach buyers who don't yet see the problem | Share of voice, executive contact acquisition | YouTube executive video and category POV films; Display or Demand Gen reach campaigns placing the category POV | No conversion bidding: target CPM, CPV or reach; Brand Lift studies where the account is eligible | Quarters |

Notes:

- **Paid search is Awareness & Activation.** It is graded on signups (or hand-raises) within the week, not on pipeline. Pipeline from those signups shows up in Demand Generation's numbers; don't use it to grade the Search campaign.
- **Contact Acquisition and Demand Generation are separate campaigns.** A gated-content Search campaign (graded on cost per record) and a remarketing campaign to marketable contacts (graded on MQL-to-SQL) never share a campaign or a conversion goal. A self-serve signup enters the database as a byproduct, but it is funded and graded as A&A.
- **YouTube runs as up to three programs:** paid prospecting (A&A), owned tutorial and demo content promoted for reach (A&A), executive video (Authority). Same channel, three briefs, three campaigns.
- **Authority campaigns are never put on Target CPA.** A reach campaign graded on signups will always lose, because the measurement is wrong, not the channel.

Starting budget split for the whole marketing budget, before tuning to stage: A&A 25%, Contact Acquisition 20%, Demand Generation 40%, Authority 15%. A new entrant in a defined category skews earlier (more A&A and Authority); an established brand skews later (more Demand Generation).

Anti-patterns, as they show up in Google Ads:

| Anti-pattern | Symptom in the account | How to detect |
|---|---|---|
| The vanity funnel | One report blending signups, leads and pipeline; campaigns compared across motions | Structure doc has no motion column; rules files grade every group on the same KPI |
| Channel sprawl | One Search campaign carrying signup, e-book and demo conversions as biddable goals | A campaign with conversions in categories that belong to different motions (step B4); `single-campaign-multi-motion-bidding` |
| Theme inflation | A non-brand campaign per product, each under the learning floor | More than four non-brand theme campaigns per market; `spend-fragmentation`, `smart-bidding-cold-start` |
| Authority cuts under pressure | YouTube or reach campaigns paused when pipeline misses | Authority campaigns paused in the last 90 days while A&A budgets held (ask; the API shows status, not intent) |
| Awareness graded on direct response | YouTube or Display reach campaigns on Target CPA, judged on CPA | Video or Display campaigns tagged Authority on a conversion bid strategy |
| Contact Acquisition graded on pipeline | Gated-content campaigns cut for low pipeline | Rules file for the CA group using a pipeline KPI |

## B2C ecommerce four-motion framework

Planning instrument: Revenue = Sessions × Conversion Rate × Average Order Value × Repeat Purchase Frequency. Every motion moves at least one variable.

| Motion | Objective | Primary metric (graded on) | Google Ads campaigns | Bids on | Notes |
|---|---|---|---|---|---|
| Brand | Build recognition and preference | Aided awareness, share of search, brand-search volume | YouTube and Demand Gen brand video (the CTV-like line); reach campaigns placing the brand POV | No conversion bidding: reach, CPM or CPV | Brand Search impression volume is this motion's readout, even though the brand Search campaign's spend sits in Performance |
| Performance | Qualified traffic and first purchase through paid acquisition | ROAS, CAC, new-customer revenue | Brand Search; non-brand Search by use-case theme; competitor Search; Shopping; PMax with the feed; dynamic remarketing on Display, Demand Gen or PMax | Purchase with dynamic order value; New Customer Acquisition goal where a Customer Match list of existing buyers exists (`nca-goal-config`) | Report brand Search ROAS separately from prospecting ROAS, always |
| Conversion | Turn visits into purchases; grow basket size | Conversion rate, AOV, cart-recovery rate | None. This is on-site engineering and CRO, not paid media. Cart-abandon remarketing is a Performance program. | n/a | Say so in the structure doc so nobody builds a "conversion" campaign |
| Retention | Repeat purchase, expansion, loyalty | Repeat-purchase rate, 90- and 365-day LTV, subscribe-and-save penetration | Customer Match win-back and replenishment campaigns (Demand Gen, YouTube); existing-customer value rules in PMax | Repeat purchase | Usually a small Google Ads line; most Retention spend is lifecycle email and SMS |

Overlays that change the Google Ads design:

- **Promotional calendar.** ROAS targets are set per calendar window, not annually; auction prices rise sharply in November and December. Freeze structural changes (merges, new campaigns, bid-strategy switches) in the weeks before peak; the migration plan schedules around it. Pre-peak Brand spend is protected; post-peak (January and February) is the largest first-time-buyer cohort, so Retention campaigns for it are planned in advance.
- **Inventory.** Shopping and PMax must not spend on out-of-stock SKUs. Design the listing groups so stock status and margin can be excluded or bid on separately (custom labels in the feed), and rule out stockouts before reading a ROAS drop as creative fatigue.
- **Margin.** Discount-led campaigns declare their margin cost. Where margin differs by product line, split listing groups (or PMax asset groups) by margin tier so one ROAS target doesn't treat a 20%-margin product like a 60%-margin one.

Starting budget split for the whole marketing budget: Brand 10–20% (higher for category creators and premium positioning), Performance 40–55% (highest early, declining as organic loops compound), Conversion 5–10% (engineering and tooling, not media), Retention 20–30%.

Anti-patterns, as they show up in Google Ads:

| Anti-pattern | Symptom in the account | How to detect |
|---|---|---|
| The vanity ROAS chart | Brand and prospecting ROAS blended into one number | Brand terms served by non-brand Search, Shopping or PMax; PMax without brand exclusions (`search-brand-leak`, `pmax-brand-exclusion`, `pmax-search-categories-split`) |
| ROAS harvesting | Spend concentrates on brand and remarketing while new-customer revenue falls | Brand + remarketing share of Performance spend rising across the 90-day window; no NCA goal |
| Brand starvation before peak | Brand video cut in September and October to fund November | Brand-motion campaigns paused or cut in the pre-peak window (ask the user to confirm intent) |
| Inventory-blind bidding | Spend on out-of-stock or zero-margin products | `shopping-ghost-products`, `shopping-high-spend-no-conv`, `pmax-product-matrix` |
| Catch-all product groups | One listing group carrying every product at one target | `shopping-catch-all-groups` |
| Discount addiction | Promotion assets running year-round | Promotion assets with no end date; ask about blended margin |

## B2C growth four-motion framework

Planning instrument: a growth equation decomposing the North Star metric, for example Engaged Paying Users = New Signups × Activation Rate × Day-30 Retention × Free-to-Paid Conversion. Activation is the central lever: acquisition without activation is wasted.

| Motion | Objective | Primary metric (graded on) | Google Ads campaigns | Bids on | Notes |
|---|---|---|---|---|---|
| Brand | Recognition and preference | Aided awareness, share of search, brand-search volume | YouTube and Demand Gen brand video; reach campaigns | No conversion bidding | Cut first when CAC rises; protect it, the damage shows two to four quarters later |
| Acquisition | Pull category-curious users to signup or install | Signups or installs, CAC, CAC payback | Brand Search; non-brand Search by use-case theme; competitor Search; App campaigns for installs; PMax for web signups; YouTube and Demand Gen acquisition | The activation event or the paid subscribe, not the raw install or signup, once it clears the floor; value per the growth section of `references/value-elicitation.md` | Graded against activation, not signup count |
| Activation | Turn signups into engaged users | Activation rate, time-to-value, Day-7 and Day-30 retention | None. Product and onboarding work. Its Google Ads footprint is the conversion action Acquisition bids on. | n/a | Say so in the structure doc |
| Retention | Keep engaged users active and paying | Cohort retention curve, gross revenue retention, LTV | Customer Match reactivation on Demand Gen or YouTube; App engagement campaigns for lapsed app users | Reactivation event | Usually small in Google Ads |

Starting budget split for the whole marketing budget: Brand 15–25%, Acquisition 35–50%, Activation 5–10% (engineering, not media), Retention 25–35%.

Anti-patterns, as they show up in Google Ads:

| Anti-pattern | Symptom in the account | How to detect |
|---|---|---|
| Acquisition graded on signups | Bidding on installs or signups while activated cohorts shrink | Primary conversion is `SIGNUP` or an install with no activation action defined (`primary-event-quality`) |
| Paid-only growth | Every campaign is a paid acquisition loop; CAC rises every quarter | No brand-motion campaigns; brand-search volume flat or falling across 90 days |
| Brand cuts under CAC pressure | Brand video paused when CAC rises | Brand-motion campaigns paused in the last 90 days (ask the user to confirm intent) |
| Loop blur | Brand and acquisition campaigns reviewed weekly on the same CPA | Rules files grading brand-motion groups on CPA |

## Google Ads campaign types, by role

| Campaign type | Typical role | Motion it usually serves | Split rule |
|---|---|---|---|
| Brand Search | Capture searches for the company's own name and products | A&A (B2B), Performance (ecommerce), Acquisition (growth) | Always its own campaign per market; brand terms negative everywhere else |
| Non-brand Search by theme | Capture category and problem demand, cut by solution or use-case theme | Same as brand Search | One campaign per theme only when each reaches the learning floor; otherwise one non-brand campaign with an ad group per theme |
| Competitor Search | Capture comparison and alternative searches | Same as brand Search | Its own campaign (different CPC and CVR, its own budget cap); never mixed into generic |
| Gated-content Search (B2B) | Promote reports, assessments, webinars | Contact Acquisition | Its own campaign with its own conversion goal |
| Performance Max | Feed-based or goal-based cross-inventory acquisition | Performance (ecommerce), A&A or Acquisition (self-serve) | Asset groups by theme; one campaign per market and margin or goal split; brand exclusions on |
| Shopping | Product-level control for retail | Performance | Use when product-level bids, priorities or a branded Shopping companion matter; otherwise PMax |
| Demand Gen | Visual, audience-led reach on YouTube, Discover and Gmail | Prospecting: A&A or Acquisition or Brand; with Customer Match: Demand Generation (B2B) or Retention (B2C) | Split prospecting from remarketing into separate campaigns |
| Display or Demand Gen remarketing | Re-engage site visitors and known contacts | Performance (ecommerce, dynamic), Demand Generation (B2B, marketable contacts) | Separate from prospecting; exclude converters (`display-no-converter-exclusion`) |
| YouTube reach and video views | Perception and recall | Authority (B2B), Brand (B2C) | No conversion bidding; frequency caps on |
| App campaigns | Installs and in-app actions | Acquisition (installs), Retention (engagement) | Separate install and engagement campaigns |
