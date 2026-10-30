#!/usr/bin/env node
// Copies shared docs into each skill so every skill folder is self-contained
// (skill installers copy one folder at a time).
//
// For every plugin in plugins/<name>/:
// - references/conventions.md in each skill = shared/conventions.md followed
//   by the plugin's shared/platform.md.
// - references/<doc>.md is copied in when the skill's SKILL.md (or one of
//   its own reference files) links `references/<doc>.md`. The plugin's
//   shared/references/ wins over the repo-wide shared/references/.
//
// Edit the files in shared/ folders, never the copies. Run with --check to
// fail instead of writing when a copy is missing or stale.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pluginsDir = join(root, "plugins");
const check = process.argv.includes("--check");
const problems = [];

function readDocs(dir) {
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => [f, readFileSync(join(dir, f), "utf8")])
  );
}

const coreConventions = readFileSync(join(root, "shared", "conventions.md"), "utf8");
const repoDocs = readDocs(join(root, "shared", "references"));

for (const plugin of readdirSync(pluginsDir)) {
  const pluginDir = join(pluginsDir, plugin);
  const skillsDir = join(pluginDir, "skills");
  if (!existsSync(skillsDir)) continue;

  const platformFile = join(pluginDir, "shared", "platform.md");
  const conventions = existsSync(platformFile)
    ? `${coreConventions.trimEnd()}\n\n---\n\n${readFileSync(platformFile, "utf8")}`
    : coreConventions;
  const shared = new Map([...repoDocs, ...readDocs(join(pluginDir, "shared", "references"))]);

  // SKILL.md plus the skill's own reference files (e.g. a check catalog) can
  // link shared docs; copies of shared docs don't count as linkers.
  const ownDocs = (dir) =>
    existsSync(dir)
      ? readdirSync(dir, { recursive: true })
          .filter((name) => name.endsWith(".md"))
          .filter((name) => name !== "conventions.md" && !shared.has(name))
          .map((name) => join(dir, name))
      : [];

  for (const skill of readdirSync(skillsDir)) {
    const skillMd = join(skillsDir, skill, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const refsDir = join(skillsDir, skill, "references");
    const label = `${plugin}/${skill}`;
    const body = [skillMd, ...ownDocs(refsDir)]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    const wanted = new Map([["conventions.md", conventions]]);
    for (const [, name] of body.matchAll(/references\/([a-z0-9-]+\.md)/g)) {
      if (wanted.has(name)) continue;
      if (shared.has(name)) {
        wanted.set(name, shared.get(name));
      } else if (!existsSync(join(refsDir, name))) {
        problems.push(`${label}: links references/${name}, which doesn't exist`);
      }
    }

    for (const [name, content] of wanted) {
      const target = join(refsDir, name);
      const current = existsSync(target) ? readFileSync(target, "utf8") : null;
      if (current === content) continue;
      if (check) {
        problems.push(`${label}: references/${name} is ${current ? "stale" : "missing"}`);
        continue;
      }
      mkdirSync(refsDir, { recursive: true });
      writeFileSync(target, content);
    }

    // Remove copies of shared docs the skill no longer links. Skill-specific
    // references (files with no counterpart in shared/) are left alone.
    if (!existsSync(refsDir)) continue;
    for (const name of readdirSync(refsDir)) {
      const isSharedCopy = name === "conventions.md" || shared.has(name);
      if (!isSharedCopy || wanted.has(name)) continue;
      if (check) {
        problems.push(`${label}: references/${name} is no longer linked`);
      } else {
        rmSync(join(refsDir, name));
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(check ? "References are in sync." : "References synced.");
