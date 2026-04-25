#!/usr/bin/env node

// Creates symlinks for each skill directory under skills/ in:
// - .claude/skills/ for repo-local Claude Code auto-discovery
// - skills/.claude/skills/ for bundled Claude-facing skill discovery
// - .agents/skills/ for local agent skill discovery

import { readdir, mkdir, symlink, rm, lstat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const skillsSrc = join(rootDir, "skills");
const repoClaudeTargetDir = join(rootDir, ".claude", "skills");
const agentsTargetDir = join(rootDir, ".agents", "skills");
const managedSkills = [];

for (const targetDir of [repoClaudeTargetDir, agentsTargetDir]) {
  await mkdir(targetDir, { recursive: true });
}

async function createLink(targetDir, skillName, fullPath) {
  const linkPath = join(targetDir, skillName);
  try {
    const stat = await lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      console.warn(`  skipped: ${linkPath} already exists and is not a symlink`);
      return;
    }
    await rm(linkPath, { recursive: true, force: true });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const relTarget = relative(targetDir, fullPath);
  await symlink(relTarget, linkPath);
  console.log(`  linked: ${linkPath} -> ${relTarget}`);
}

async function collectSkills(srcDir, prefix = "") {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".claude") continue;
    const fullPath = join(srcDir, entry.name);
    const skillName = prefix ? `${prefix}-${entry.name}` : entry.name;

    // Check if this directory has a SKILL.md (it's a leaf skill)
    const children = await readdir(fullPath);
    if (children.includes("SKILL.md")) {
      managedSkills.push({ skillName, fullPath });
    }

    // Recurse into subdirectories (e.g., providers/linear/)
    await collectSkills(fullPath, skillName);
  }
}

async function removeManagedLinks() {
  for (const { skillName } of managedSkills) {
    for (const targetDir of [repoClaudeTargetDir, agentsTargetDir]) {
      const linkPath = join(targetDir, skillName);
      try {
        const stat = await lstat(linkPath);
        if (stat.isSymbolicLink()) {
          await rm(linkPath, { recursive: true, force: true });
        }
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
    }
  }
}

console.log(
  "Linking skills into .claude/skills/ and .agents/skills/",
);
await collectSkills(skillsSrc);
await removeManagedLinks();
for (const { skillName, fullPath } of managedSkills) {
  await createLink(repoClaudeTargetDir, skillName, fullPath);
  await createLink(agentsTargetDir, skillName, fullPath);
}
console.log("Done.");
