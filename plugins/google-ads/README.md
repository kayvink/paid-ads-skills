# Google Ads skills

55 skills that let Claude (or any agent that reads Agent Skills) run a Google Ads account the way an experienced PPC lead would: account structure, campaign builds, a 128-check health check, audits, testing plans, bidding, pacing, reporting and conversion tracking. They read your account through Google's official Google Ads MCP server, do every calculation in Python, and keep what they learn about your business in a folder of markdown files so each run builds on the last.

These are the playbooks used to manage tens of millions in ad spend, free under the MIT license. This project is not affiliated with or endorsed by Google.

Made by [Kay Vink](https://x.com/kayvink). If the skills are useful, follow on X for more, and send questions there.

## What you need

1. **The Google Ads MCP server.** Install Google's official server, [googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp), and connect it to your agent. Follow its README for credentials (a Google Cloud project with the Google Ads API enabled, and OAuth or application default credentials). It is read-only: the skills recommend changes and you apply them in Google Ads.
2. **Python.** Claude Code and claude.ai both run Python; the skills use pandas for the analysis.
3. **A workspace folder** (optional but recommended). The skills read and write markdown files under `marketing/` in your project: business context, naming taxonomy, media plan, per-group targets, acknowledged exceptions, plans and findings. Missing files are fine; skills fall back to best-practice defaults and offer to create them.

## Install

**Claude Code**, as a plugin:

```
/plugin marketplace add kayvink/paid-ads-skills
/plugin install google-ads@paid-ads-skills
```

**Any agent that supports Agent Skills** (Claude Code, Cursor, Codex, GitHub Copilot and others):

```bash
npx skills add kayvink/paid-ads-skills
```

**claude.ai**: add `kayvink/paid-ads-skills` as a plugin marketplace under Customize > Plugins, or upload individual skill folders.

**Codex**: the repo includes a Codex marketplace (`.agents/plugins/marketplace.json`) and manifest (`.codex-plugin/plugin.json`). Add `kayvink/paid-ads-skills` as a plugin marketplace in Codex, then install `google-ads` from `/plugins`.

## Where to start

- New account: `google-ads-design-account-structure`, then `google-ads-build-campaign` for each campaign.
- Existing account: `google-ads-configure-conversion-action`, then `google-ads-health-check`, which runs 128 checks across every channel you use and ranks what matters.
- Weekly rhythm: `google-ads-weekly-report`, `google-ads-optimize-search-campaign`, `google-ads-check-pacing`.
- Growth: `google-ads-plan-tests`, `google-ads-find-scale-candidates`, `google-ads-choose-bid-strategy`.

Just ask in plain language ("why did CPA jump last week?", "which search terms are wasting money?", "how should this account be structured?"); the agent picks the right skill.

## Skills

**Structure and builds**

| Skill | What it does |
|---|---|
| `google-ads-design-account-structure` | Designs a new account or restructures an existing one around your business's motions, with a migration plan |
| `google-ads-build-campaign` | Turns a planned campaign into a launch-ready Search or PMax build spec with pre-launch QA |
| `google-ads-write-ad-copy` | Writes and refreshes RSA and PMax text assets from keywords, landing pages and asset performance |
| `google-ads-create-media-plan` | Writes the media plan from observed spend or your existing plan |
| `google-ads-create-channel-rules` | Per campaign group targets, budgets and health thresholds |

**Health and monitoring**

| Skill | What it does |
|---|---|
| `google-ads-health-check` | Runs the 128-check battery (account, Search, Shopping, PMax, Display, Video, Demand Gen) and synthesises one prioritised read |
| `google-ads-triage-health-checks` | Clusters health-check results by root cause and decides what to investigate |
| `google-ads-investigate-health-cluster` | Digs into one cluster of related failures with a hypothesis ledger |
| `google-ads-ad-disapprovals` | Finds disapproved and limited ads and assets, with policy reasons and fixes |
| `google-ads-campaigns-not-spending` | Diagnoses enabled campaigns with zero or near-zero delivery |
| `google-ads-daily-pacing` | Quick daily check of budget delivery against daily and monthly budgets |
| `google-ads-fluctuation-detection` | Day-over-day and week-over-week alerts on spend, conversions and CPA |
| `google-ads-diagnose-trend-drift` | Explains a sustained drift in performance against the change history |

**Optimisation and deep audits**

| Skill | What it does |
|---|---|
| `google-ads-optimize-search-campaign` | The full 17-step Search optimisation routine, end to end |
| `google-ads-check-search-terms` | Wasted and inefficient search terms, negatives, shared-list themes |
| `google-ads-check-keyword-performance` | Six-bucket keyword classification with scale, monitor and pause actions |
| `google-ads-check-keyword-expansion` | Converting queries not yet covered by keywords |
| `google-ads-analyze-segments` | Day of week, hour, device, location, audience and demographic performance |
| `google-ads-analyze-auction-insights` | Competitor overlap, outranking and new entrants |
| `google-ads-check-naming-convention` | Naming schema coverage and hygiene |
| `google-ads-check-utm-tagging` | UTM coverage and precedence |
| `google-ads-check-geo-targeting` | Location settings, plan compliance and leakage |
| `google-ads-check-pacing` | Spend against plan and performance against target |
| `google-ads-check-variance` | Three-phase WoW, MoM and YoY variance investigation |
| `google-ads-check-spend-fragmentation` | Whether budgets are spread too thin for Smart Bidding |

**Quick audits**

`google-ads-audit-ad-relevance`, `-audience-strategy`, `-channel-performance`, `-creative-lp-consistency`, `-geo-strategy`, `-keyword-cannibalisation`, `-keyword-expansion`, `-keyword-performance`, `-match-type-strategy`, `-naming-convention`, `-negative-strategy`, `-placement-exclusions`, `-pmax-search-themes`, `-search-term-cannibalisation`, `-spend-fragmentation`: each answers one question about the account with a priority-tiered result.

**Bidding, testing and growth**

| Skill | What it does |
|---|---|
| `google-ads-choose-bid-strategy` | Picks the right bid strategy and target per campaign, with a migration path and learning-phase rules |
| `google-ads-plan-tests` | A prioritised test backlog with sample size, duration and stop rules from your real volumes |
| `google-ads-read-test-results` | Reads out an experiment with lift, confidence intervals and power, and calls it |
| `google-ads-measure-incrementality` | Designs and analyses geo-holdout lift tests |
| `google-ads-find-scale-candidates` | Campaigns performing well with room to spend more |
| `google-ads-find-new-opportunities` | Keyword, launch and test opportunities in one shortlist |
| `google-ads-research-keyword-opportunities` | Outside-in keyword research anchored to your business and site |
| `google-ads-budget-allocation` | Compares allocation to plan and marginal performance, proposes moves |
| `google-ads-evaluate-launch` | Assesses a product launch for paid search |
| `google-ads-approve-growth-plan` | Turns opportunities into the first three actions and a test backlog |

**Conversion tracking**

| Skill | What it does |
|---|---|
| `google-ads-configure-conversion-action` | Picks the primary conversion action reports and audits judge against |
| `google-ads-conversion-tracking` | Strategy brief for what to track and how to value it |
| `google-ads-setup-tracking` | Implements and validates Google Ads and GA4 tracking in your codebase: enhanced conversions, offline conversions, Consent Mode v2, cross-domain |

**Reporting and reference**

| Skill | What it does |
|---|---|
| `google-ads-weekly-report` | The weekly performance report |
| `google-ads-write-gaql-queries` | GAQL syntax, field compatibility and API gotchas |

## What the skills do and don't do

- They read your Google Ads data through the MCP server you connect, write analysis scripts and data to a temporary folder, and write markdown files to your workspace folder. Nothing is sent anywhere else.
- They never change your account. Every recommendation is a table you apply yourself.
- Some skills fetch your own landing pages or sitemap with the agent's web fetch tool, and keyword research may use web search if your agent has it.
- Every skill output (the reply and every file it writes, such as findings, reports and plans) ends with a one-line footer crediting Kay Vink with a link to follow on X, the same way Claude Code credits itself in commits. To turn it off, add `attribution: false` to `marketing/ads/google/index.md`, or just ask the agent to remove it.

## Support and privacy

- Questions and bugs: [open an issue](https://github.com/kayvink/paid-ads-skills/issues) or ask on X at [x.com/kayvink](https://x.com/kayvink).
- Privacy: the skills have no server and send nothing to the author. See [PRIVACY.md](PRIVACY.md).

## License

MIT
