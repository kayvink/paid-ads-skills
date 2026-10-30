---
name: google-ads-health-check
description: Run the Google Ads health-check battery (account, Search, Shopping, Performance Max, Display, Video and Demand Gen checks from a built-in catalog), write one result file per check, and synthesize them into one prioritized read with cross-check root causes. Use when the user asks whether the Google Ads account is healthy, what is broken, to run a health check, or for a quick or full account check. To decide which failing checks deserve a root cause investigation afterwards, use google-ads-triage-health-checks.
---

# Health check

> Run the health-check battery and synthesize the per-check result files into a single prioritized read.

Read `references/conventions.md` first: it covers running GAQL through the Google Ads MCP, doing the analysis in Python, the workspace files, and the finding format. The checks themselves are defined in `references/checks/<channel>.md` (one file per channel); this skill says how to run them, record them and read across them.

## Goal

When a user asks "is the account healthy?", "what's broken?", "run a health check", run the battery of health checks from the catalog, read across the resulting per-check files, and produce **one** prioritized synthesis that surfaces:

- The handful of issues that matter most (spend-blocking > policy > tracking > performance > hygiene > opportunity)
- Cross-check patterns (e.g. five checks red because of one billing issue, not five separate problems)
- What's already been acknowledged (skip anything in `ads/google/memory/`)

This is **not** a full account audit: it doesn't read taxonomy, naming structure, business context, or campaign architecture. It runs the catalogued checks and reasons over their outputs. Broader audits live in other skills.

## Scope

Google Ads, every account in scope (conventions section 1). Each check is evaluated across all accounts at once and writes one file whose offending-items table carries the account name per row.

## Preconditions

- A Google Ads MCP is connected and `list_accessible_customers` returns at least one account.
- The accounts in scope are known. Read them from `ads/google/index.md`; if it doesn't list any, run `list_accessible_customers`, ask the user which accounts to include (or, unattended, take every account returned), and offer to record the answer in `ads/google/index.md`.

## Modes

| Mode | Runs | When |
|---|---|---|
| **Default** | Every check marked **Runs by default: yes** in the loaded catalog files | "Run a health check", scheduled runs |
| **Quick** | Only checks with **Urgency: high** that also run by default | The user wants a fast read, or the default battery is too large for the session (see step 4) |
| **Full** | Every check in the loaded catalog files, including **Runs by default: no** | The user asks for a "full" or "complete" check |
| **Targeted** | The check IDs the user (or another skill) names | "Re-run conversions-flowing", or a skill asking for specific checks |

Channel gating (step 2) applies in every mode: checks for a channel with no enabled, spending campaigns are not run.

## Inputs you need

1. **Memory:** `ads/google/memory/MEMORY.md` for the memory index. The user may have acknowledged exceptions ("auto-tagging only is fine, GA4 only"). Don't re-flag those; read the individual files for full context.
2. **Business context:** `wiki/company.md`. Tells you whether this is e-commerce, B2B, lead-gen, etc. Calibrates which findings matter most.
3. **Account index:** `ads/google/index.md`, for the accounts in scope, the manager ID, `primary_conversion_action`, `brand_terms`, and any high-level account summary the user already wrote. Several checks read the primary action and brand terms; their catalog entries say how.
4. **Previous results:** the existing files in `ads/google/health/`. Read each one's frontmatter before you overwrite it (step 7).
5. **Run results:** produced live by the procedure below.

## Procedure

### Step 1: Fix the run date and windows

Pick one run date (today) and compute every window the catalog uses from it once, ending yesterday: last 7, 14, 30 and 90 days, plus any other length an entry states. Fill every `'<start>'` / `'<end>'` placeholder from this one table. Using the same dates in every check is what lets identical queries be shared in step 4.

Ask once, when a user is present, whether to write the per-check files to `ads/google/health/` and the run summary to `ads/google/analyses/`. These are run output, like findings: once the user agrees, write them all without asking per file. Unattended, write them.

### Step 2: Detect which channels are live

For each account in scope, run:

```sql
SELECT
  customer.descriptive_name,
  customer.currency_code,
  campaign.id,
  campaign.name,
  campaign.advertising_channel_type,
  metrics.cost_micros
FROM campaign
WHERE campaign.status = 'ENABLED'
  AND metrics.cost_micros > 0
  AND segments.date BETWEEN '<start>' AND '<end>'
```

with the last-30-days window. `segments.date` is filtered but not selected, so each campaign comes back as one row with its 30-day total.

Use Python to sum `cost_micros / 1e6` per `(customer_id, campaign.advertising_channel_type)` and print the channel types with spend per account. Map them to catalog files:

| `advertising_channel_type` | Catalog file |
|---|---|
| (always) | `references/checks/account.md` |
| `SEARCH` | `references/checks/search.md` |
| `SHOPPING` | `references/checks/shopping.md` |
| `PERFORMANCE_MAX` | `references/checks/performance-max.md` |
| `DISPLAY` | `references/checks/display.md` |
| `VIDEO` | `references/checks/video.md` |
| `DEMAND_GEN` (older accounts may still report `DISCOVERY`) | `references/checks/demand-gen.md` |

`account.md` loads even when nothing spent: several account checks (campaigns not spending, conversions flowing) exist to catch exactly that. Any other channel type with spend (`HOTEL`, `LOCAL`, `SMART`, `MULTI_CHANNEL`, `TRAVEL` and so on) has no catalog file: list it in the run summary as "not covered" with its spend.

Save this result like any other query (step 4): some checks use the same campaign list.

### Step 3: Build the run list

Read only the catalog files from step 2. A channel's catalog may be split into parts (for example `account-part1.md` and `account-part2.md`); load every file whose name is the channel's file name or starts with it followed by `-part`. From each entry take the ID, name, category, channel (the file's channel: Account, Search, Shopping, Performance Max, Display, Video, Demand Gen), urgency, the **Runs by default** flag, the settings, the queries, the analysis steps and the result rules. Settings take the defaults the entry gives unless the user overrides one; record the values you used.

Filter the entries by the mode. Use Python to print the run list: one row per check with ID, channel, urgency, and the number of queries it needs.

### Step 4: Plan the queries once, then share results

A default battery is many queries, and many checks ask for the same thing (the same campaign list, the same 30-day campaign metrics). Run each distinct query once per account and give every check that needs it the same saved result.

- **Key each result by query text and account.** With the placeholders already filled, collapse whitespace in the GAQL and hash it together with the customer ID. Two entries that produce the same normalized text share one result. Don't lowercase: string literals in `WHERE` are case-sensitive.
- **Merge only when the grain is unchanged.** Two queries on the same resource with the same `WHERE` that differ only in the `metrics.*` or attribute fields they select can run as one query with the union of fields. Adding a `segments.*` field changes the row grain, so never merge across different segment sets. When in doubt, keep them separate.
- **Save once, read many.** Store each result under the scratch folder from conventions section 2 with an index that maps every check to the result files it reads:

```python
import hashlib, json, pathlib, re

RUN = pathlib.Path("/tmp/google-ads/health-check/<YYYY-MM-DD>")
CACHE = RUN / "results"
CACHE.mkdir(parents=True, exist_ok=True)

def result_path(gaql: str, customer_id: str) -> pathlib.Path:
    norm = re.sub(r"\s+", " ", gaql.strip())
    key = hashlib.sha1(f"{customer_id}|{norm}".encode()).hexdigest()[:16]
    return CACHE / f"{key}-{customer_id}.json"

# plan: {check_id: [gaql, ...]} built from the catalog entries in the run list.
# Before running a query, skip it if result_path(gaql, cid) already exists.
# After running it, write {"query": norm, "customer_id": cid, "rows": rows}
# (or {"error": "<message>"} when the MCP rejects it) to that path.
```

Use Python to print the plan before running anything: checks in the run list, distinct queries per account after de-duplication, and total MCP calls (distinct queries × accounts).

**Batching.** Work account by account: run every distinct query for the first account, save each result as it returns, then move to the next account. Keep raw rows out of the conversation. When a user is present and the plan is large (dozens of calls per account, or many accounts), state the call count and offer quick mode, or a narrower set of accounts, before starting. If the session runs low on room partway through, finish the current account, analyse what you have, and mark the checks for the remaining accounts as covering a subset (step 6).

When a query fails on one account, record the error in its result file and continue. When it fails on every account with a field or syntax error, check the field with `get_resource_metadata` (or the `google-ads-write-gaql-queries` skill), fix the query once, and retry; if it still fails, the check depending on it ends as `error`.

### Step 5: Run the analysis for each check

For each check in the run list, follow its **Analyse with Python** steps exactly, loading the result files the index maps to it and concatenating accounts with a `customer_id` column. Keep every threshold and setting the entry gives. Write one function per check (in one script per channel is fine) that returns:

```python
{
  "observations": [
    {
      "kind": "fail",            # fail | warn | opportunity | info
      "title": "Campaigns with zero impressions",
      "count": 3,                # headline count, when the entry has one
      "message": "...",          # plain language, from the entry's Report line
      "action": "...",           # the entry's Action line
      "metrics": {"spend_at_risk": 1240.0},   # optional chips
      "items": [ {...}, ... ],   # offending rows; account name first
    },
  ],
  "unknown_reason": None,        # set when the entry's unknown rule applies
}
```

Then derive the status in Python, the same way for every check:

- `unknown` when `unknown_reason` is set: the entry's **unknown** rule applies (no campaigns of the type, no data, a required setting missing), or its queries returned errors on every account. Where a catalog file states its own rule for query errors, follow it.
- `error` when the check itself could not be completed for a reason the entry doesn't anticipate: a query the API rejects as invalid even after the step 4 retry, or analysis that raises and can't be fixed. Record the error message.
- `ok` when there are no observations, or only `info` ones.
- Otherwise the worst observation kind, in the order `fail` > `warn` > `opportunity`.

**Partial coverage.** If some accounts failed and the rest succeeded, evaluate the check on the accounts that succeeded and list the failed ones in `accounts_failed`. If the result would be `ok`, write `unknown` instead, with `unknown_reason: ok on <accounts read>, could not read <accounts failed>`: a clean result on a subset is not a clean result.

**Channel-gated checks.** A check that wasn't run because its channel had no spend gets no new file. If an older file for it exists in `ads/google/health/`, rewrite it as `unknown` with `unknown_reason: no enabled <channel> campaigns with spend in the last 30 days`, so a stale `fail` doesn't linger for triage. Checks skipped only because of the mode (quick or targeted) keep their existing file untouched.

### Step 6: Cap the offending tables

Sort each observation's `items` the way the entry says (usually by spend, descending), cap them at the entry's cap, and never write more than 100 rows for one observation. Keep `count` as the full total, not the capped length. Put the account name in the first column; drop raw customer IDs from the table unless two accounts share a name.

### Step 7: Write one file per check

Path: `ads/google/health/<check-id>.md`, where `<check-id>` is the catalog ID (for example `ads/google/health/conversions-flowing.md`). Overwrite the previous version, but read its frontmatter first and carry these over:

- `previous_status`: the old file's `status`. Omit it when there was no old file.
- `status_unchanged_since`: if the old status equals the new status, keep the old file's `status_unchanged_since` (or its `checked` date when that field is missing). Otherwise, and on the first run, set it to today's run date.

**Frontmatter:**

```yaml
---
check_id: conversions-flowing
check_name: Conversions flowing
status: fail                    # ok | warn | fail | opportunity | unknown | error
checked: 2026-10-30
checked_at: 2026-10-30T09:14:00Z
category: conversions           # the entry's category
channel: Account                # Account | Search | Shopping | Performance Max | Display | Video | Demand Gen
urgency: high                   # the entry's urgency
mode: default                   # default | quick | full | targeted
accounts: [Acme NL, Acme DE]    # accounts the check read
accounts_failed: []
previous_status: ok
status_unchanged_since: 2026-10-30
config:                         # the settings used, omit when the entry has none
  lookback_days: 7
observations:                   # omit when there are none
  - kind: fail
    title: Conversions stopped
    count: 2
counts:                         # observations per kind
  fail: 1
  warn: 0
  opportunity: 0
  info: 0
total_items: 2                  # sum of observation counts (or item rows when no count)
unknown_reason: ...             # only when status is unknown
error_message: ...              # only when status is error
---
```

Quote any value that contains a colon, a `#` or leading spaces.

**Body:**

1. `# <check name>, <YYYY-MM-DD>`
2. A one-line lead: `**FAIL.** <the first observation's message>` (or `**OK.** All checks passing.`, `**UNKNOWN.** The check could not be evaluated this run.`, `**ERROR.** The check did not complete, see the Error section below.`).
3. `## What good looks like`: the entry's **Good looks like** text, always, so a reader knows the bar.
4. `## What this check does`: one or two sentences from the entry, naming the window and the thresholds used.
5. `## Error` (the error message in a code block) or `## Unknown` (the reason), when they apply.
6. One section per observation: `## <title>, <count> (<kind>)`, then the message, `**How to fix:** <action>`, a `**Metrics:**` bullet list when there are metrics (money in the account's currency), and the offending-items table. When the table is capped, say `Sample (<shown> of <total>):` above it.
7. When nothing was flagged: `## Result` with "All checks passing, nothing to flag."

**Status history.** When the new status differs from `previous_status` (including the first run), append one line to `ads/google/health/.<check-id>.log.md`, creating it with the heading `# History: <check name>` if it doesn't exist:

```
2026-10-30T09:14:00Z fail (was ok)
```

Write nothing there when the status is unchanged. Triage reads this file to spot flapping checks (status changed 3 or more times in 14 days).

### Step 8: Write the run summary

Write `ads/google/analyses/health-check-YYYY-MM-DD.md` (add `-2` for a second run on the same day):

- Frontmatter: `title`, `date`, `mode`, `accounts`, `accounts_failed`, `channels_live` (with 30-day spend each), `checks_run`, and a count per status.
- A table of every check run: channel, category, check (linked to its file), status, count, previous status, unchanged since. Sort by status (`fail`, `error`, `warn`, `unknown`, `opportunity`, `ok`), then urgency.
- The checks not run, grouped by reason: channel not live, not in this mode, channel type not covered by the catalog.

Generate the table in Python from the frontmatter of the files you just wrote, not from memory.

### Step 9: Read across the per-check files

List `ads/google/health/` and read every file written or rewritten in this run. Each file's frontmatter carries:

- `status` (`ok` / `warn` / `fail` / `opportunity` / `unknown` / `error`)
- `category` (hygiene / approvals / targeting / creative / bidding / monitoring / conversions / efficiency / growth)
- `channel` (Account / Search / Performance Max / Shopping / Display / Video / Demand Gen)
- `previous_status` and `status_unchanged_since`, for trend reasoning ("flapping all week" vs. "just broke"); the `.log.md` history gives the full sequence
- `observations`: kind, title and count per issue

The body holds the full narrative and offending-items table. Read everything; don't sample.

Use Python to load all frontmatter into one DataFrame (one row per check) and, from each observation's metrics and tables, the spend at stake per check where a spend or cost column exists, summed per account in its currency. This gives the "rough weight" the ranking and the wrap-up need.

### Step 10: Cluster and prioritize

Apply this severity ladder, in order:

1. **Spend-blocking:** anything that means money is being wasted *right now*: campaigns not spending despite intent, broken landing pages, disapproved ads, conversions stopped flowing (for example `campaigns-not-spending`, `video-campaign-not-spending`, `lp-reachability`, `disapproved-ads`, `conversions-flowing`).
2. **Compliance / policy:** disapprovals, restricted approvals, anything that could escalate to account-level action (the `approvals` category).
3. **Tracking / measurement gaps:** conversion actions, conversion volume, anything that means decisions are being made on bad data (most of the `conversions` category).
4. **Performance leaks:** underperforming ad groups, low quality scores, fragmented spend, missing negatives (for example `ad-group-underperformer`, `quality-score`, `spend-fragmentation`, `negative-kw-coverage`).
5. **Hygiene & setup:** naming conventions, geo targeting type, demographic exclusions (for example `naming-convention`, `geo-targeting-type`, `demographic-exclusions`).
6. **Opportunities:** ad groups ready to scale, smart bidding graduation candidates, A/B test readiness (status `opportunity`, for example `ad-group-scale-candidate`, `smart-bidding-readiness`).

Place a check by what its observations say, not only by its category: a `monitoring` check reporting that spend stopped is spend-blocking.

Within each tier, sort by `count × estimated impact`: a check flagging 47 disapproved ads beats one flagging 2. Use Python: impact is the spend at stake from step 9 where the check has one, otherwise the count alone; sort descending within the tier.

### Step 11: Detect cross-check patterns

Before producing the output, scan for shared root causes:

- All approval-related checks red simultaneously: likely a billing or policy issue, not 47 separate problems.
- `conversions-flowing` red AND `conv-rate-fluctuation` red AND `lp-conv-rate-outlier` red: a tracking change, not three independent regressions.
- Multiple "campaigns not spending" + "low quality scores" + "match types unbalanced" on the same campaigns (`campaigns-not-spending`, `quality-score`, `match-type-strategy`): that campaign is the single root cause.

Use Python to find the shared entities: collect `(account, campaign)` from the offending tables of every non-ok check and list the campaigns that appear in two or more checks, most checks first. Compare `status_unchanged_since` across the red checks: several turning red on the same date is a strong sign of one cause.

Surface the pattern explicitly. Better to say "your tracking broke last Tuesday and it's lighting up three checks" than dump three separate findings.

### Step 12: Cross-reference memory

For each candidate issue, search `ads/google/memory/MEMORY.md` for the underlying topic. If the user has acknowledged it before, **drop it from the output** (or downgrade to a "previously acknowledged" mention if material has changed). The per-check files still record the raw status; memory only affects the synthesis.

## Output content

The standard finding body from conventions section 4. This skill specifies:

**Wrap-up:** one paragraph the user can read in five seconds.

- Total checks run, how many failing / warning / passing / unknown, and the mode.
- The single biggest issue (in plain English, with the rough weight in the account's currency from step 9).
- One sentence of trend ("status hasn't moved in a week" or "this is new since yesterday"), from `previous_status` and `status_unchanged_since`.

Example: *"Ran 31 checks across 3 accounts. 4 failing, 7 warning, 18 passing. The big one: 47 disapproved ads sitting on €2.4k/mo of spend, all in the Acme NL account, all hitting the same trademark policy, likely one fix. Status has been red since Tuesday."*

**Cross-check patterns:** one section per detected root cause (skip if none). Lead with the pattern, then list the symptom checks. Keeps the user from chasing five separate fixes for one underlying issue.

**Top fixes (ranked):** three to five items max. Each:

- Title (specific, not category-generic)
- One-sentence why-it-matters (tie to spend or conversion impact)
- Link to the source check files (`ads/google/health/<check-id>.md`)
- Suggested next action (single concrete verb, not a checklist)

**Per-check details table:** one row per check, sorted by severity. Columns: `channel`, `category`, `name`, `status`, `count`, `previous_status`, `unchanged_since`, `file`. Render only checks that emitted at least one observation; collapse the all-clear ones into a count at the bottom. Also note any accounts that failed and any live channel the catalog doesn't cover.

**Suggested next steps:** for material clusters, `google-ads-triage-health-checks` (or `google-ads-investigate-health-cluster` for a single cluster); for a specific topic, its dedicated skill.

**Knowledge writes:** none by default beyond the health files and the run summary. If the user reacts to a finding ("yeah we know about that, ignore it"), write a new file under `ads/google/memory/` with a date-stamped acknowledgment and update `MEMORY.md`. Don't pre-commit.

## Finding shape for this skill

One finding per run, written to `ads/google/findings/YYYY-MM-DD-google-ads-health-check.md`.

- `kind: audit`.
- `category`: the conventions category of the top fix: `tracking` for measurement issues, `budget` for spend-blocking delivery and budget issues, `creative` for disapprovals and assets, `keywords` for search terms, negatives and match types, `bids` for bidding, `structure` otherwise and for a clean run.
- `status: pending` when anything failed or warned, or opportunities were found; `ok` when everything passed.
- Add `urgency`, derived from the worst tier triggered:
  - High: spend-blocking, compliance, or tracking failures present
  - Medium: performance leaks or 5+ hygiene issues
  - Low: opportunities only

Title leads with the headline number, summary adds the dominant theme.

**Title + summary (issues found):**

- `title`: `"4 failing, 7 warning across 31 checks"`
- `summary`: `"47 disapproved ads + 12 broken landing pages, both spend-blocking, both new this week."`

**Title + summary (clean):**

- `title`: `"All 31 checks passing"`
- `summary`: `"No failures, no warnings across <accounts>. Last failing check resolved <X> ago."` (from the history files)

Body mirrors the **Output content** section above: wrap-up, cross-check patterns, top fixes, per-check table.

## Evidence-forcing rule

Every claim in the synthesis must trace to a specific check file. No "the account is in good shape" without naming what you read. No "tracking is broken" without `ads/google/health/conversions-flowing.md` and the specific count and window from its frontmatter and body. The numbers come from the Python output over those files, never from a reading of them in your head. The synthesis only works if it is auditable against the underlying files.

## What this skill is NOT

- **Not** a full account audit. A real audit reads taxonomy, naming structure, business context, campaign architecture, and tracking setup, not just the catalogued checks. Defer those to other skills.
- **Not** a deep-dive on any one finding. If the user wants to drill into a specific topic (e.g. "tell me more about UTM tagging"), defer to that topic's dedicated skill (e.g. `google-ads-check-utm-tagging`).
- **Not** an action loop. This skill produces findings; the user decides what to do about them. The Google Ads MCP is read-only, so recommendations are for the user to apply.
