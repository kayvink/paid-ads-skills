# Privacy policy

Last updated: 30 October 2026

The Google Ads skills are a set of instructions (Agent Skills) that run inside your own AI agent, such as Claude or Codex. They have no server, no account system and no analytics. The author, Kay Vink, receives no data from them.

## What the skills access

- **Your Google Ads data**, through the Google Ads MCP server you install and connect yourself (for example Google's official [googleads/google-ads-mcp](https://github.com/googleads/google-ads-mcp)). The skills only read data; they never change your account. Access is governed by the credentials you give that server and by Google's terms.
- **Files on your machine**: the skills write query results and analysis scripts to a temporary folder, and markdown notes (findings, reports, plans, business context) to a workspace folder in your project, by default `marketing/`.
- **Public web pages**, when a skill fetches your own landing pages or sitemap with your agent's web fetch tool, or runs a web search your agent supports.

## What the skills don't do

- They don't send your data to the author or to any service other than the ones above.
- They don't collect personal data, credentials or usage statistics.
- They don't store anything outside your machine and your agent.

Your AI agent's provider (for example Anthropic or OpenAI) processes the conversation under its own privacy policy.

## Retention and control

Everything the skills write stays in folders you control. Delete the workspace folder or the temporary folder at any time to remove it. Uninstalling the skills removes the instructions from your agent.

## Contact

Questions about this policy: open an issue at [github.com/kayvink/paid-ads-skills/issues](https://github.com/kayvink/paid-ads-skills/issues) or message [x.com/kayvink](https://x.com/kayvink).
