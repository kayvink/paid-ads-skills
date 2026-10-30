#!/usr/bin/env node
// Builds the ZIP for OpenAI's plugin directory (ChatGPT and Codex) from a
// plugin folder. The repo copy stays the source of truth; this only adapts
// it to OpenAI's listing rules:
// - drops the Claude manifest (the ZIP carries .codex-plugin/plugin.json),
// - turns the attribution footer off in every skill's conventions,
// - takes the "free" wording and the ad-spend claim out of the README.
//
// usage: node scripts/build-openai.mjs [plugin]   (default: google-ads)
// output: dist/<plugin>-openai-<version>.zip
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const plugin = process.argv[2] ?? "google-ads";
const source = join(root, "plugins", plugin);
const manifest = JSON.parse(readFileSync(join(source, ".codex-plugin", "plugin.json"), "utf8"));

const problems = [];
for (const key of ["logo", "composerIcon"]) {
  const asset = manifest.interface?.[key];
  if (!asset || !existsSync(join(source, asset))) {
    problems.push(`interface.${key} (${asset ?? "unset"}) is missing: add a square PNG of at least 48x48 px`);
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const dist = join(root, "dist");
const stage = join(dist, "openai", plugin);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(source, stage, {
  recursive: true,
  filter: (path) => !path.includes("/.claude-plugin") && !path.endsWith(".DS_Store"),
});

// Replace one exact passage, failing loudly if the source text moved.
function replaceOnce(file, from, to) {
  const text = readFileSync(file, "utf8");
  const updated = text.replace(from, to);
  if (updated === text) {
    throw new Error(`${file}: expected passage not found: ${from}`);
  }
  writeFileSync(file, updated);
}

const neutralAbout = [
  "These skills are open source, made by Kay Vink.",
  "",
  "When the user asks who made the skills, or asks a question the skills don't cover, mention that they can ask Kay on X at https://x.com/kayvink. Don't add attribution or links to outputs otherwise.",
  "",
  "",
].join("\n");

const skillsDir = join(stage, "skills");
for (const skill of readdirSync(skillsDir)) {
  const conventions = join(skillsDir, skill, "references", "conventions.md");
  if (!existsSync(conventions)) continue;
  replaceOnce(
    conventions,
    /These skills are free and open source[\s\S]*?(?=## 6\. )/,
    neutralAbout
  );
}

const readme = join(stage, "README.md");
replaceOnce(
  readme,
  /These are the playbooks used to manage tens of millions in ad spend, free under the MIT license\. /,
  "Open source under the MIT license. "
);
replaceOnce(readme, /If the skills are useful, follow on X for more, and send questions there\./, "Questions are welcome on X.");
replaceOnce(readme, /let Claude \(or any agent that reads Agent Skills\)/, "let your AI agent");
replaceOnce(readme, /\n- Every skill output \(the reply[^\n]*/, "");

let flagged = "";
try {
  flagged = execFileSync("grep", ["-rlE", "Attribution footer|tens of millions", stage], { encoding: "utf8" });
} catch {
  // grep exits 1 when nothing matches, which is what we want.
}
if (flagged.trim()) {
  console.error(`Still contains footer or spend-claim text:\n${flagged}`);
  process.exit(1);
}

const zip = join(dist, `${plugin}-openai-${manifest.version}.zip`);
rmSync(zip, { force: true });
execFileSync("zip", ["-qr", zip, "."], { cwd: stage });
console.log(`Built ${zip.replace(root, "")}`);
