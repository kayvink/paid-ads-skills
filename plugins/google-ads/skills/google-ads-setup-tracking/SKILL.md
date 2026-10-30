---
name: google-ads-setup-tracking
description: Set up or audit Google Ads and GA4 conversion tracking in the code of the user's product repository - decide the conversion spec, find where events fire, fix gclid capture, enhanced conversions, offline uploads, Consent Mode and cross-domain handoff, then validate. Use when the user is in their codebase and says tracking is broken, asks to audit or implement conversions, mentions gclid, enhanced conversions, offline upload, Smart Bidding values or Consent Mode, or wants to move from tCPA to tROAS. Picks up the brief written by google-ads-conversion-tracking when it exists.
---

# Setup Google Ads Tracking

Walk the user through diagnosing, reviewing, implementing, and validating Google Ads + GA4 conversion tracking for this product. Output two artifacts in the workspace: `ads/google/conversion-tracking.md` (the spec for what counts as a conversion) and `ads/google/tracking-status.md` (per-event status mapping spec to reality). Together these become the source of truth that the other Google Ads skills, and anyone reviewing the account, read when they recommend bid changes, report metrics, or plan campaigns.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. This skill works mostly on code in the user's repository, so the GAQL and Python parts of the conventions apply only to the steps that read account data (steps 7, 10 and 18). Its output is the two workspace files above rather than a finding. The workspace usually lives in the same repository (`marketing/` by default); if it lives elsewhere, ask for its path once.

The conversion event you optimise toward is not a tracking implementation detail — it is the single most important input into how the ad platform learns. Get it wrong and no amount of bidding tuning recovers the campaign. This skill makes the strategic decisions explicit before writing code.

## How these files are used

When you finish, the two files describe the user's conversion contract: which events count, what their values are, how they're attributed. Reporting skills read the spec as the primary metric definition; bidding and pacing skills read it to ground their recommendations. If the spec says activation is primary, no skill should suggest optimising toward signup volume.

You are not writing marketing copy. You are writing a measurement specification a senior consultant could hand to an engineering team. Be specific. Vague specs produce vague optimisation downstream.

## Terminology

- **Conversions spec** (`ads/google/conversion-tracking.md`): the strategic decisions — motion, primary event, secondary events, value model, attribution stance, enhanced conversions stance, identifier propagation requirements. The `google-ads-conversion-tracking` skill writes the same file as a brief from the account side; this skill fills in its implementation sections.
- **Tracking status** (`ads/google/tracking-status.md`): per-event reality check — is the event firing correctly, is it attributing correctly, what's broken, what's the suggested fix.
- **Motion**: the user's go-to-market shape — B2C ecommerce, B2C subscription, B2B self-serve, B2B sales-led, or B2B hybrid. Drives every default in this skill (see appendix A).

## Phase 1 — Diagnosis

Goal: produce a draft conversions spec in `ads/google/conversion-tracking.md` that captures the strategic decisions, before touching any code.

### Step 1 — Read context, confirm product, confirm prerequisites

**Determine which product this run is for.** Read the repo and proceed. Don't ask. If the workspace covers several products, derive a kebab-case slug from `package.json` `name` (or the repo directory if no package.json) and suffix both artifact file names with it (`conversion-tracking-<slug>.md`, `tracking-status-<slug>.md`) so products don't collide.

**Read the product context.** Read `wiki/company.md` and any product page under `wiki/` that matches this repo. This is the canonical product context. If it is missing or a placeholder, read the repo's README, marketing pages and pricing page, then ask the user to confirm the motion and the conversion events before going further.

**Read the existing spec if any.** Read `ads/google/conversion-tracking.md`.

- If it has a filled "Recommended conversion spec" (from `google-ads-conversion-tracking`) or a filled spec from an earlier run of this skill, this run is an update, not a first-time setup: treat that spec as the current state, confirm it in one line, and go to phase 2 review against the latest codebase.
- If not found, this is a first-time setup.

**Confirm prerequisites.** The platform-side checks in phases 2 and 4 need a Google Ads MCP connected in this agent (conventions section 1). If none is connected, ask the user to connect one. If they can't, continue with the codebase phases and mark every platform-side check in the status doc as "not run: no Google Ads access".

### Step 2 — Confirm the motion in one line

Read the motion from the product context and state it back: *"You're a B2B sales-led product targeting mid-market revops teams — confirm?"* Only ask the full diagnostic question if the context is genuinely ambiguous (rare; usually means the product has both a self-serve and sales-led path the website doesn't surface).

The motion drives every default downstream. See appendix A for the variant table.

### Step 3 — Walk the three opinionated decisions

For each decision, present the motion-specific default with a one-line *why*, then ask the user to accept or override. Don't ask all three at once — work through them sequentially.

**Decision 1: Primary conversion event.** What single event does the bidder optimise toward? This is the event bid recommendations will be judged against; the choice is strategic, not technical.

- B2B self-serve → activation, not signup. Signup volume looks healthy and predicts almost nothing about revenue. Activation predicts paid conversion.
- B2B sales-led → MQL with a real lead-score filter (not raw form-fill). Form-fill volume is dominated by tire-kickers; MQL is where the funnel narrows to actual prospects. The CRM is the source of truth, not the form.
- B2C ecommerce → purchase with dynamic value from the order total. Default and obvious.
- B2C subscription → initial subscription event with LTV proxy as value. Bidding on free signup volume optimises for unprofitable users.
- B2B hybrid → two parallel conversion actions (one self-serve, one sales-led). Run separate campaigns; do not blend.

If a motion calls for multiple primaries (B2B hybrid is the only default case), they must have **distinguishable values**. Smart Bidding balances multiple primaries in proportion to their values; if every primary carries the same value (or no value), the bidder collapses to whichever has the most volume and starves the others. Multiple primaries at $1 each is functionally the same as having a single primary set to whichever fires most often. Either pick a single primary, or give each primary a value that reflects its relative economics (e.g. self-serve `paid_conversion` at fixed-tier proxy, sales-led `mql_qualified` at close-rate × ACV proxy).

**Decision 2: Secondary events.** Funnel events that you track but the bidder does not optimise on. These exist to (a) feed funnel reporting and (b) support cohort analysis. Defaults follow the motion (see appendix A).

**Decision 3: Value model.** The most consequential decision after primary event. Without a value field on every conversion, the bidder cannot differentiate $100 customers from $10,000 ones — Smart Bidding's ceiling is tCPA, and tCPA blocks the platform from acquiring high-LTV customers it would otherwise win. Pick the simplest value model that is non-flat:

- **Dynamic from payload** (purchase amount, deal size). Use when the value is known at event time — ecommerce, subscription pricing, deal close.
- **LTV proxy** (close-rate × ACV; expected_revenue × probability). Use when the deal value is not known at event time but a credible estimate is — B2B sales-led at MQL, freemium activation.
- **Fixed per tier** (plan-tier buckets: Free $0, Pro $200, Enterprise $2000). Use when the user has discrete pricing tiers and no per-customer dynamic data.
- **No value** is not an option for v1. If the user pushes back, default to fixed-per-tier with the simplest bucketing that works.

Apply two further defaults without asking:

- **Attribution stance** → data-driven where conversion volume allows (Google's threshold is ~300/month per conversion action, summed across all campaigns in the account — not per campaign). Below that, default to last-click. Distinct from Smart Bidding's volume requirements (~30/campaign for tCPA, ~50/campaign for tROAS): DDA gates how credit is split across touches; Smart Bidding gates whether bids can be set at all. The user can override if their account is mid-migration.
- **Enhanced conversions** → on for any logged-in or identified user (email, phone, or hashed user_data on the conversion payload). This is non-negotiable for any account with EU traffic, lead-gen, or a meaningful logged-in cohort.

### Step 4 — Draft the spec in `ads/google/conversion-tracking.md`

Write the draft now. The user reviews and edits it locally using normal IDE diff tools before phase 2 starts.

- If the file already holds a brief from `google-ads-conversion-tracking`, keep its structure and record the decisions from step 3 in its "Recommended conversion spec" section (update only what changed, and say what changed).
- Otherwise create the file with `status: draft` frontmatter and this structure:

```
# Google Ads conversions spec

## Motion
{B2C ecommerce | B2C subscription | B2B self-serve | B2B sales-led | B2B hybrid}
{One-line description of the user's specific motion}

## Primary event
- Name: {snake_case, e.g. mql_qualified}
- Trigger: {when this fires, in plain English}
- Payload requirements: value, currency, transaction_id (= deal_id for B2B), gclid, hashed user_data
- Value model: {dynamic | LTV proxy | fixed per tier}
- Why this not signup/form_fill/purchase: {one line}

## Secondary events
{table: name | trigger | payload | reason for tracking}

## Attribution stance
{data-driven | last-click}

## Enhanced conversions
{on | off}, {scope: all conversions | logged-in only | none}

## Identifier propagation requirements
- gclid: persisted to {cookie | localStorage | server session | user record}
- transaction_id (= deal_id): unique per conversion, threaded into CRM
- user_id: stable across sessions, threaded into GA4

## Current implementation status

## Validation log

## Remaining fixes
```

End phase 1. Do not touch code yet.

## Phase 2 — Review

Goal: produce a draft `ads/google/tracking-status.md` that maps the spec from phase 1 to what's actually true in the user's codebase and Google Ads account, before writing any new code.

### Step 5 — Discover what's in the codebase

Grep / ripgrep across the repo for the major analytics signatures:

```
gtag\\(           dataLayer\\.push    window\\.dataLayer
fbq\\(            analytics\\.track   posthog\\.capture
mixpanel\\.track  amplitude\\.track   rudderanalytics\\.track
segment\\.track
```

Also look for:
- The GTM container snippet (`googletagmanager\\.com/gtm\\.js` or `gtm/ns\\.html`)
- Hardcoded GA4 measurement IDs (`G-XXXXXXX`)
- Hardcoded Google Ads conversion IDs (`AW-XXXXXXXXX`) — flag any that appear in test or staging code
- Server-side conversion API calls (`google-ads-api`, `googleads-node`, raw `fetch` to `googleads.googleapis.com`)
- CRM webhook handlers (`/api/webhooks/{salesforce,hubspot,pipedrive,attio,close}` or similar)
- gclid / gbraid / wbraid handling — explicit param read at landing, persistence to a cookie or store, and threading onto the conversion payload

For each spec event, classify the implementation as **missing**, **partial**, **broken**, or **correct**.

### Step 6 — Diagnose the firing layer

Common failure modes — flag any you see:

| Pattern | What's wrong |
| --- | --- |
| Conversion fires on form load (`useEffect` on mount) | Should fire on submit success, not mount |
| Same event fires from both client and server with no `event_id` | Double-counts; bidder trains on inflated numbers |
| Event payload missing `value` where spec calls for dynamic value | Bidder cannot run tROAS; all conversions look identical |
| Hardcoded prod conversion ID present in test or staging code | Test traffic pollutes Smart Bidding |
| gclid captured at landing but not persisted | Downstream events lose attribution |
| gclid lowercased before storage | Case-sensitive; Google's gclid is case-sensitive — preserve the original |
| Cookie path scoped narrower than `/` | Other pages can't read the gclid back |
| Enhanced conversions configured on tag but no hashed user_data sent | Silently misses every match |

### Step 7 — Diagnose the attribution layer

Attribution is checked in two halves because the failure can sit on either side.

**Platform side** — query through the Google Ads MCP, for each account in scope:

```sql
SELECT
  customer.descriptive_name,
  customer.auto_tagging_enabled,
  customer.tracking_url_template
FROM customer
```

```sql
SELECT
  customer.descriptive_name,
  campaign.id, campaign.name,
  campaign.tracking_url_template,
  campaign.final_url_suffix
FROM campaign
WHERE campaign.status = 'ENABLED'
```

```sql
SELECT
  customer.descriptive_name,
  conversion_action.id,
  conversion_action.name,
  conversion_action.status,
  conversion_action.type,
  conversion_action.primary_for_goal,
  conversion_action.include_in_conversions_metric
FROM conversion_action
WHERE conversion_action.status != 'REMOVED'
```

```sql
-- Last-fire evidence, last 30 days ending yesterday
SELECT
  customer.descriptive_name,
  segments.conversion_action_name,
  segments.date,
  metrics.all_conversions
FROM campaign
WHERE segments.date BETWEEN '<start>' AND '<end>'
```

Check:

- `customer.auto_tagging_enabled` — must be true; otherwise no gclid arrives at all
- Customer- and campaign-level `tracking_url_template` — flag any final-URL-stripping logic
- Linked GA4 property — must be present and active for cross-product attribution. GAQL doesn't expose the link directly: actions with a `type` starting `GOOGLE_ANALYTICS_4` show GA4 is linked and imported; otherwise ask the user to confirm under Tools → Data manager → Google Analytics
- Per-conversion-action: status (active / paused / archived), `include_in_conversions_metric`, last-fire date, primary/secondary flag

Use Python for last-fire dates: load the last query, keep rows with `all_conversions > 0`, and take the max `segments.date` per `(customer_id, segments.conversion_action_name)`. Join to the conversion action list on `(customer_id, conversion_action.name)`; an enabled action with no row has not fired in 30 days.

**Codebase side** — once the signal arrives, does the app preserve it?

- `utm_source`, `utm_medium`, `utm_campaign` — read at landing, persisted across navigation, threaded onto the conversion payload
- `gclid`, `gbraid`, `wbraid` — same pattern
- Consent integration: cookie banner blocks the right scripts before consent, and consent state propagates to the analytics calls (otherwise Consent Mode signal is invalid)
- Identifier propagation: `transaction_id` = deal_id in B2B; `user_id` stable across sessions; `order_id` required on every offline upload (otherwise adjustments are impossible later)

### Step 8 — Detect cross-domain split

Read the product context and the codebase for the registrable-domain layout. Three buckets:

- **Same eTLD+1** (marketing site and conversion-firing surface share one registrable domain) — first-party cookies carry gclid across naturally; verify cookie scope and SameSite.
- **Cross-domain, same controller** (e.g. `example.com` marketing site → `app.example.io` product). Cookies cannot bridge; must use GA4's cross-domain measurement (linker decoration adds `_gl` query param) or a backend handoff (server-side capture of gclid + persistence to user record at signup).
- **Cross-domain with redirect hops** (SSO, OAuth, payment gateway in the chain). Marketing params get stripped en route. Requires capturing gclid before the redirect chain (e.g. on the marketing-site signup CTA, write to a server-side session keyed by a stable identifier the user carries through the SSO flow).

Classify the user's project and flag the bucket in the status doc.

### Step 9 — Detect CMP and consent posture

Consent Mode v2 is part of the spec for every project — assume EU traffic exists until proven otherwise (it almost always does, even in products targeting other markets). The question is *how the project gets there*, not *whether*.

Look for a CMP in the codebase: Cookiebot, OneTrust, Cookieyes, Iubenda, Klaro, Termly, Usercentrics, or a custom equivalent. Three states:

- **CMP present + Consent Mode wired** → working as intended. Verify the CMP fires `gtag('consent', 'update', …)` on grant/deny and that defaults are set before tags load (see step 15 for the verification list).
- **CMP present, no Consent Mode** → measurement loss on every consented EU session that should have produced an attributed conversion (vendor estimates 15–50%; account-specific). Wire it in step 15.
- **No CMP** → critical phase-2 finding. Flag it in the status doc; without a CMP, Consent Mode itself can't function (defaults `denied` blocks everyone; defaults `granted` violates EEA law). CMP selection is out of scope for this skill — recommend a Google-certified CMP, mark step 15 as blocked-on-CMP, and return to it once a CMP is installed.

Flag in the status doc which mode is in use:

- **No Consent Mode** → measurement loss on every EU visitor who declines or is in a jurisdiction requiring opt-in. Recommend Basic mode minimum.
- **Basic mode** → trackers blocked entirely until consent; cookieless pings still send conversion modelling signal to Google. Acceptable default.
- **Advanced mode** → trackers fire pre-consent in cookieless mode and switch to full mode on grant. Requires careful CMP wiring; misconfigurations are common (no `default` consent state set, `update` called before user interaction, `gcd` parameter missing on hits). Verify these specifically.

### Step 10 — Cross-check against source of truth

If the user has an accessible primary source of truth (order DB, CRM, application logs), run a spot-check: pull the conversion count for the last 14 days from both sides, compare. The Google Ads side is `metrics.all_conversions` for the primary action over the same 14 days (the last query in step 7 with the window narrowed, filtered to `segments.conversion_action_name = '<primary action>'`); the source-of-truth side comes from the user's system or from the user.

Use Python for the comparison: sum both sides over the same dates and compute `gap = (google_ads - source_of_truth) / source_of_truth`.

- Wide gaps (>30%) usually mean attribution is structurally broken (one path firing, another missing).
- Large duplication (Google Ads count > source of truth) usually means double-firing.
- Modest gaps (<15%) are normal — don't chase a perfect match.

Skip this step if no accessible source of truth.

### Step 11 — Draft `ads/google/tracking-status.md`

Write the draft with `status: draft` frontmatter. Per-event table:

```
| Event | Firing | Attribution | File paths | Issues | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| mql_qualified | partial | utm-broken | app/api/webhooks/hubspot/route.ts:42 | gclid not persisted at signup; UTM not threaded onto payload | Add gclid capture middleware + persist to user record; thread on offline upload |
```

Plus a "platform state" subsection (auto-tagging on/off, conversion actions list with last-fire dates, GA4 link state) and a "cross-domain bucket" / "consent posture" line at the top.

Also write a short summary of the per-event classification into the "Current implementation status" section of `ads/google/conversion-tracking.md`, pointing to `ads/google/tracking-status.md` for the detail.

The user reviews this draft before any code is written.

## Phase 3 — Implementation

Goal: write the code (or modify existing code) so each spec event meets its contract. Use the framework conventions already in this repo — match the existing patterns rather than introducing a new analytics library or refactor. The constraints below name what *correct* looks like for each event; apply them within whatever stack you're already in.

### Step 12 — Implement online events

For each spec event marked missing or broken, write or fix the implementation following these constraints:

- **Where it fires** — server-side preferred for high-value events (purchase, subscribe, mql_qualified, paid_conversion); ad-blocker-resistant client-side fallback for funnel events. For server-side, fire on the actual lifecycle event (Stripe webhook, deal close, MQL flip in CRM), not on a UI confirmation page.
- **Payload** — always: `value`, `currency`, `transaction_id` (= order_id / deal_id), `gclid` if available; for enhanced conversions: hashed `email` and/or `phone` and/or `address` (see normalisation recipe below).
- **What must not happen** — no firing on `useEffect` mount, no firing in test or staging environments (gate on the app's environment setting), no double-fire without dedup.
- **Dedup contract** — if both client and server emit the same logical conversion, both must include the same `event_id` (or `transaction_id`). Google de-duplicates within 24 hours when matched.

### Step 13 — Inline recipe: enhanced conversions normalisation

This is the canonical SHA-256 hashing rule. Get any step wrong and matches silently fail.

```python
import hashlib, re

def normalize_email(e: str) -> str:
    e = e.strip().lower()
    user, _, domain = e.partition("@")
    if domain in ("gmail.com", "googlemail.com"):
        user = user.split("+", 1)[0].replace(".", "")
    return f"{user}@{domain}"

def normalize_phone(p: str) -> str:
    digits = re.sub(r"\D", "", p)
    return f"+{digits}"  # E.164; assumes country code present

def normalize_name_or_address(s: str) -> str:
    return s.strip().lower()

def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()
```

Hash: email, phone, first_name, last_name, street_address. **Do not hash**: country, state, city, zip — these are sent in clear. Phone must be E.164 (`+14155551234`) before hashing — sending `(415) 555-1234` raw produces zero matches.

### Step 14 — Implement offline conversions and server-side events

For motions with offline conversions (B2B sales-led, B2B hybrid):

- **Capture gclid at first marketing-site visit** — write to a first-party cookie scoped to `/` with `SameSite=Lax`, lifetime 90 days. Also write to localStorage as a backup (some ad-blocker / ITP scenarios blow away the cookie).
- **Persist gclid to user record at signup** — read from cookie/localStorage at the signup form submit, write to the user/lead record alongside the email. This is the gclid that survives.
- **Wire a single CRM webhook handler** with three branches:

| Lifecycle event | Action | Adjustment type |
| --- | --- | --- |
| MQL flip / lead qualified | Initial `ConversionUpload` with `order_id = deal_id`, value = proxy (close_rate × ACV) | n/a — original upload |
| Closed-won within ~7 days | `ConversionAdjustment` with adjusted_value = real ARR | RESTATEMENT |
| Closed-lost / disqualified / churn within 55 days | `ConversionAdjustment` setting value to 0 | RETRACTION |
| Expansion within 55 days | Second `ConversionAdjustment` with new total | RESTATEMENT |
| Anything past 55 days | Log to CRM, do not push to Google | n/a — past adjustment window |

Critical fact: **Smart Bidding only re-reads adjustments made within 7 days** of the original conversion. Adjustments on days 8–55 update reporting but the bidder ignores them. For sales cycles longer than a week (almost all B2B), the close-won restatement is a *reporting fix*, not a bidding signal — which means **the proxy value at MQL upload must be credible**, not `$0` or `$1`. The bidder learns from the credibility of that initial value.

`order_id` is **non-negotiable** on the original upload. Without it, no adjustment is ever possible — the conversion is locked to its original value forever.

For B2C and B2B self-serve motions without offline conversions, this step is skipped entirely. GA4 Measurement Protocol covers the parallel need where `gtag` cannot run (e.g. a Stripe webhook firing `paid_conversion` server-side):

```
POST https://www.google-analytics.com/mp/collect?measurement_id=G-XXXXXXX&api_secret=<API secret>
{
  "client_id": "<persisted GA4 client_id>",
  "user_id": "<stable user id>",
  "timestamp_micros": <unix microseconds>,
  "events": [{
    "name": "paid_conversion",
    "params": { "value": 200, "currency": "USD", "transaction_id": "deal-12345" }
  }]
}
```

For sales-led, send close-won **directly** to Google Ads via offline upload — do not substitute Measurement Protocol + the GA4-to-Ads import. The import path loses gclid attribution and adds a day of latency in the bidder's feedback loop.

### Step 15 — Implement Consent Mode v2

If step 9 flagged the project as no-CMP, stop here — record the gap in the status doc and resume once a CMP is installed. Consent Mode without a CMP is non-functional.

Otherwise wire Consent Mode for every user — the CMP handles when (and where) consent is required. Basic mode minimum:

```html
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  // Set defaults BEFORE any tag fires
  gtag('consent', 'default', {
    'ad_storage': 'denied',
    'ad_user_data': 'denied',
    'ad_personalization': 'denied',
    'analytics_storage': 'denied',
    'wait_for_update': 500
  });
</script>
<!-- Then load gtag.js / GTM -->
<!-- On user grant, call gtag('consent', 'update', { ... 'granted' ... }) -->
```

Common mistakes to avoid: setting defaults *after* tags load (too late — ping fires unconsented); calling `update` before the user has interacted (model assumes consented); omitting `wait_for_update` (causes a race condition with synchronous tag firing). The four signals (`ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`) must all be set explicitly — not just the first two.

### Step 16 — Implement cross-domain handoff

Apply the bucket from step 8:

- **Same eTLD+1** — verify cookie domain is set to the parent (`.example.com`), `SameSite=Lax`, path `/`. Done.
- **Cross-domain, no redirect** — enable GA4 cross-domain in admin (Configure → Data streams → Configure tag settings → Configure your domains). Verify the linker adds `_gl` query param to outbound links. Add explicit `get_linker` calls for any programmatic redirects.
- **Cross-domain with redirect hops** — capture gclid server-side at the marketing-site signup CTA, write to a server-side session keyed by a stable identifier (signup form's email or a generated request_id). Read it back on the application side after the redirect chain completes; thread onto the user record.

### Step 17 — Optional: regression tests

Offer to write one regression test per primary conversion event in whatever framework the repo already uses (Playwright, Cypress, Vitest with mocked dataLayer). Each test simulates the trigger and asserts the right event fires with the right payload — value present, transaction_id unique, gclid threaded, no double-fire. This catches drift at PR time rather than weeks later when conversion volume drops.

Ask before writing — some teams have strong opinions about mocking analytics globals in their test suite, and an unwanted PR doing it is worse than no tests. If the user declines, validation in phase 4 covers the same ground manually.

## Phase 4 — Validation

Goal: confirm the implementation is correct before finalising the artefacts. Run as much as possible directly; fall back to a manual checklist only for items that genuinely require ad-platform UI access.

### Step 18 — Validate

What this environment usually exposes for validation:
- **Read access to Google Ads** through the Google Ads MCP (conversion counts, conversion action config, offline upload summaries). The MCP is read-only: it cannot upload conversions or adjustments, even in `validate_only` mode.
- **No CRM, no application DB, no source-of-truth access** unless the repo itself has it. Anything that requires CRM-side data, the user provides directly in the conversation — a deal_id, a count, a sample row, or a path to a fixture file in the repo.

Inventory the verification tooling available in this environment, then run every check the tooling supports. Do not punt the whole list to the user when most of it is automatable.

- **Browser automation** — Playwright or Cypress in the repo, an IDE preview pane / debug mode, Claude Code computer-use / Chrome MCP. Any of these lets you trigger flows on a running dev server and intercept network requests.
- **Shell** — for grep-style checks; always available.
- **Google Ads MCP** — for GAQL reads (conversion counts, conversion action config, upload summaries).
- **The repo's own Google Ads API client** — if the app already uploads offline conversions, its upload path can be exercised with `validate_only=true` against `ConversionUploadService` / `ConversionAdjustmentUploadService`. Don't run it yourself and never read the app's credentials: prepare the exact command or script call, and ask the user to run it in their dev environment and paste back the response.

Each check below specifies what you do, what data you need (and where it comes from), and what "pass" means. Skip motion-specific checks for motions where they don't apply (offline upload + adjustment lifecycle are sales-led / hybrid only).

**Agent-runnable:**

| Check | Method | Data source | Pass criteria |
| --- | --- | --- | --- |
| Event fires on submit with correct payload | Run dev server; browser automation triggers the conversion flow (form submit, purchase, etc.); intercept request to `googleads.g.doubleclick.net` or `googletagmanager.com` | All from the running app | Request sent within 5s of trigger; payload contains `value`, `currency`, `transaction_id`, `gclid` if available, `event_id` if dedup contract applies |
| No fire on page load | Browser automation: load the conversion page, do not interact | Running app | No outbound request to Google Ads or GA4 within 5s of page load |
| Test-environment isolation | Set `NODE_ENV=test` (or staging-equivalent for the user's stack); browser automation triggers the conversion | Running app under test env | No outbound request contains the production conversion ID `AW-XXXXXXXXX`; request blocked or routed to a test ID |
| Consent Mode `gcd` parameter | Browser automation: load page, grant consent via the CMP UI, trigger conversion; intercept Google Ads ping | Running app + CMP | `gcd` parameter present on the request and matches the granted consent state |
| Production ID hygiene in test/staging code | Shell: `grep -rn "AW-XXXXXXXXX" --include='*.{ts,tsx,js,jsx}' . | grep -E '(test\|staging\|fixture\|mock\|spec)/'` — substitute the actual prod ID | Repo | Empty output |
| Offline upload validates *(sales-led / hybrid only)* | Ask the user for one sample row (deal_id, gclid, value, conversion_date, hashed email if EC enabled). Prepare a call to the repo's own upload client for `ConversionUploadService.uploadClickConversions` with `validate_only=true` (a write service, so not through the read-only MCP), and ask the user to run it and paste back the response. If the repo has no client yet or the user declines, record the check as not run | User-provided sample row | API response has no `partial_failure_error` rows |
| Triangulation against source of truth | GAQL via the MCP: `SELECT segments.conversion_action_name, segments.date, metrics.all_conversions FROM campaign WHERE segments.date BETWEEN '<start>' AND '<end>' AND segments.conversion_action_name = '<primary action>'` over the last 7 days ending yesterday; sum in Python. Ask the user for the same window's count from their source of truth (CRM, order DB, app logs) | GAQL for Google Ads side; user provides source-of-truth number | `abs(google_ads − source_of_truth) / source_of_truth ≤ 0.30`, computed in Python |
| Adjustment landed *(sales-led / hybrid only)* | Ask the user for the deal_id (= order_id) of a recent closed-won. Query the offline upload summaries via the MCP (`offline_conversion_upload_conversion_action_summary`; check its fields with `get_resource_metadata`) for adjustment success and error counts on the action; per-order adjustment history isn't exposed through GAQL, so confirm the order itself from the repo's upload logs or the Google Ads UI | User-provided deal_id; GAQL lookup; upload logs | At least one `RESTATEMENT` adjustment recorded for that order_id with the expected `adjusted_value` |
| Conversion action UI configuration matches the spec | GAQL via the MCP: `SELECT conversion_action.name, conversion_action.primary_for_goal, conversion_action.value_settings.default_value, conversion_action.attribution_model_settings.attribution_model, conversion_action.status FROM conversion_action` for each action in `ads/google/conversion-tracking.md` | GAQL | Every field in the response matches the spec; flag any drift |
| Conversion appears in Google Ads reporting | After a staging conversion, GAQL via the MCP: `metrics.all_conversions` by `segments.conversion_action_name` and `segments.date` for the staging day, filtered to the conversion action | GAQL; ~3-hour reporting latency means re-run after a wait | At least one matching conversion on the staging day for that action |

**Hybrid** — the agent does the trigger / setup, the user confirms a UI-only signal:

- **GA4 DebugView**
  - **Agent:** trigger the primary event on staging via browser automation with `debug_mode: true` set in the payload; record the timestamp and the parameters sent.
  - **User:** open GA4 admin → Configure → DebugView. Reply with "yes, see it with the right params" or paste the parameter list back.
  - **Pass:** event visible in DebugView with the parameters the agent recorded (`value`, `currency`, `transaction_id`).
- **Final UI sanity check** (only if the conversion-report API check above didn't run, e.g. tooling unavailable)
  - **Agent:** trigger or instruct the user to trigger a staging conversion; record timestamp.
  - **User:** ~3 hours later, open Google Ads → Tools → Conversions → [Action] (online) or Recent Uploads (offline). Confirm in the conversation.
  - **Pass:** user confirms the conversion is visible.

**Validation is passed when all of these are true:**

1. Every agent-runnable check applicable to the user's motion has run and passed (or, if the tooling is unavailable, the equivalent has been completed in the hybrid form above).
2. Every hybrid check has been confirmed by the user in the conversation — ask each one and wait for confirmation. Do not assume.
3. All findings (passes, fails, skipped-due-to-tooling) are recorded in `ads/google/tracking-status.md` with timestamps, and summarised in the "Validation log" section of `ads/google/conversion-tracking.md`.

If any check fails, do not proceed to step 19. Return to phase 3, fix the underlying issue, and re-run validation from step 18.

Triangulation note: don't chase perfect parity. Google Ads applies its attribution model, lookback windows, and unconsented-session modelling; the source of truth applies its own definition of "counted." A ≤30% gap is normal; >30% indicates something structurally wrong.

### Step 19 — Finalise the artefacts

Once validation passes, finalise both files in the workspace so other skills read a settled spec rather than a draft:

- In `ads/google/conversion-tracking.md`: set `status: final` in the frontmatter (add frontmatter if the file has none), and fill "Current implementation status", "Validation log" and "Remaining fixes".
- In `ads/google/tracking-status.md`: set `status: final` and record the validation date.

Path convention: `ads/google/` is the Google Ads part of the workspace (alongside `rules/`, `strategy/`, `reports/`, `analyses/`). For multi-product workspaces, use the slug-suffixed file names from step 1.

If the workspace lives in this repository, suggest committing the two files together with the tracking code so the spec and the implementation stay in step.

### Step 20 — Confirm to the user and exit

Confirm what was written, what was tested, and what remains for the user to do manually:

- Conversion actions in the Google Ads UI must be created or updated to match the spec — primary/secondary flags, value model, attribution stance. The Google Ads MCP is read-only, so list each change as a table (action, current setting, spec setting) for the user to apply.
- If the spec's primary action differs from `primary_conversion_action` in `ads/google/index.md`, say so; the `google-ads-configure-conversion-action` skill updates it.
- For B2B sales-led, the CRM webhook handler must be deployed and reachable from the CRM platform.
- The validation checklist above runs once after the first deployment, then again on any change to the spec.

Then exit and return the user to their normal IDE flow.

## Appendix A — Motion variants

Defaults applied in phase 1 step 3. Override path is always available; the row's *why* explains the default's reasoning.

### B2C ecommerce

| Field | Default |
| --- | --- |
| Primary event | `purchase` |
| Secondary | `add_to_cart`, `begin_checkout`, `view_item` |
| Value model | Dynamic from order total |
| Attribution | Data-driven |
| Enhanced conversions | On |
| Offline upload | No |

*Why:* purchase is the obvious primary; dynamic value enables tROAS out of the box. Funnel events feed cohort analysis and remarketing audiences.

### B2C subscription

| Field | Default |
| --- | --- |
| Primary event | `subscribe` (initial) |
| Secondary | `trial_start`, `signup` |
| Value model | LTV proxy (e.g. expected_arpu × expected_lifetime_months) |
| Attribution | Data-driven |
| Enhanced conversions | On |
| Offline upload | Usually no (subscribe captured at-tier in browser) |

*Why:* bidding on free signup volume optimises for unprofitable users. LTV proxy lets the bidder differentiate plan tiers and channel quality. Use value rules to vary by plan if no per-customer prediction is available.

### B2B self-serve SaaS

| Field | Default |
| --- | --- |
| Primary event | `activation` (product-defined: workspace created, first integration, first key action) |
| Secondary | `signup`, `paid_conversion` |
| Value model | Fixed per tier or close_rate × ACV proxy |
| Attribution | Data-driven where volume allows, last-click otherwise |
| Enhanced conversions | On |
| Offline upload | Usually no |

*Why:* signup volume looks healthy and predicts almost nothing about revenue. Activation is the leading indicator of paid conversion and survives the 30-day attribution window. Paid conversion volume is usually too low for the bidder to learn from directly — it goes in as secondary, not primary. This is the most opinionated default here; if the user has high paid-conversion volume (≥300/month) and a clear preference, override to `paid_conversion` as primary.

### B2B sales-led

| Field | Default |
| --- | --- |
| Primary event | `mql_qualified` (CRM-flipped, with real lead-score filter) |
| Secondary | `form_fill`, `demo_booked` |
| Value model | LTV proxy at MQL (close_rate × ACV); restate within 7 days at closed_won where possible |
| Attribution | Last-click (sales-cycle length usually outside data-driven attribution's reliable window) |
| Enhanced conversions | On |
| Offline upload | Yes — closed_won via offline upload + adjustments |

*Why:* form-fill volume is dominated by tire-kickers; the CRM is the source of truth for what's actually a lead. The 7-day Smart Bidding restatement window means close-won updates after a 30+ day cycle are too late to retrain the bidder — so the proxy value at MQL upload must be credible (close_rate × ACV), not `$0` or `$1`. The closed-won restatement is then a reporting fix, not a bidding signal. Wire the CRM webhook with three branches: MQL → upload, closed-won → RESTATEMENT, closed-lost → RETRACTION.

### B2B hybrid

| Field | Default |
| --- | --- |
| Primary event | Two parallel actions: self-serve = `paid_conversion`, sales-led = `mql_qualified` |
| Secondary | Per parallel motion |
| Value model | Per parallel motion |
| Attribution | Per parallel motion |
| Enhanced conversions | On |
| Offline upload | For the sales-led action only |

*Why:* the two motions have different value curves, sales cycles, and bidder economics. Blending them into one conversion action means the bidder optimises toward whichever has more volume (almost always self-serve), starving the higher-LTV sales motion. Run separate campaigns, separate budgets, separate primary actions.

## Closing notes

Run once during onboarding and re-run on drift. The two workspace files are the durable output. On a re-run, treat the existing `ads/google/conversion-tracking.md` as the current spec, re-run phase 2 review against the latest codebase, and propose changes only if motion or product has materially shifted.
