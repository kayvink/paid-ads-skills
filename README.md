# Paid ads skills

Free, open-source skills that turn Claude (or any agent that reads Agent Skills) into an experienced paid ads lead. Built from playbooks used to manage tens of millions in ad spend.

Made by [Kay Vink](https://x.com/kayvink). If the skills are useful, follow on X for more, and send questions there.

## Plugins

| Plugin | What it covers | Install (Claude Code) |
|---|---|---|
| [`google-ads`](plugins/google-ads/) | 55 skills: account structure, campaign builds, a 128-check health check, audits, testing, bidding, pacing, reporting and conversion tracking, through Google's official Google Ads MCP | `/plugin install google-ads@paid-ads-skills` |

More ad platforms will follow as their own plugins in this marketplace.

Add the marketplace once:

```
/plugin marketplace add kayvink/paid-ads-skills
```

Or install individual skills into any agent that supports Agent Skills:

```bash
npx skills add kayvink/paid-ads-skills
```

## How the collection is built

Every skill follows the same conventions: it pulls data through the platform's MCP server, does every calculation in Python, keeps account knowledge in a markdown workspace (`marketing/` in your project), and ends each run with one finding file. Cross-channel knowledge (business context, naming taxonomy, media plan) is shared by all platforms; each platform keeps its own memory, rules and findings under `ads/<platform>/`.

```
shared/
  conventions.md            Platform-neutral conventions every skill gets
  references/               Cross-platform background docs (attribution models, priority tiers, …)
plugins/
  <platform>/
    .claude-plugin/plugin.json
    shared/platform.md      How to get data from this platform; its settings
    shared/references/      Platform-specific background docs
    skills/<platform>-<skill>/SKILL.md
scripts/sync-references.mjs
```

### Adding a platform

1. Create `plugins/<platform>/` with a `.claude-plugin/plugin.json`, a README, a LICENSE and `shared/platform.md` describing the platform's MCP server, query language, money units and settings file (`ads/<platform>/index.md`).
2. Add skills as `plugins/<platform>/skills/<platform>-<skill>/SKILL.md`. Link background docs as `references/<name>.md`.
3. Add the plugin to `.claude-plugin/marketplace.json`.
4. Run `node scripts/sync-references.mjs`. It builds each skill's `references/conventions.md` from `shared/conventions.md` plus the platform file, and copies every linked reference into the skill folder so each skill installs on its own.

Edit files in the `shared/` folders, never the copies inside skills. `node scripts/sync-references.mjs --check` fails when a copy is stale.

## License

MIT. Not affiliated with or endorsed by Google or any other ad platform.
