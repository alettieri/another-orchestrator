#!/usr/bin/env node

// Creates symlinks for each skill directory under skills/ in:
// - .claude/skills/ for repo-local Claude Code auto-discovery
// - skills/.claude/skills/ for bundled Claude-facing skill discovery
// - .agents/skills/ for local agent skill discovery

import {
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");
const skillsSrc = join(rootDir, "skills");
const repoClaudeTargetDir = join(rootDir, ".claude", "skills");
const agentsTargetDir = join(rootDir, ".agents", "skills");

export async function createLink(targetDir, skillName, fullPath) {
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

export function parseSkillName(markdown) {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    return null;
  }

  const name = frontmatter[1].match(/^name:\s*["']?([^"'\r\n#]+)["']?/m);
  return name?.[1]?.trim() || null;
}

async function readSkillName(fullPath, fallbackName) {
  try {
    const skillMarkdown = await readFile(join(fullPath, "SKILL.md"), "utf-8");
    return parseSkillName(skillMarkdown) ?? fallbackName;
  } catch {
    return fallbackName;
  }
}

export async function collectSkills(srcDir, prefix = "") {
  const managedSkills = [];
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".claude") continue;
    const fullPath = join(srcDir, entry.name);
    const fallbackName = prefix ? `${prefix}-${entry.name}` : entry.name;

    // Check if this directory has a SKILL.md (it's a leaf skill)
    const children = await readdir(fullPath);
    if (children.includes("SKILL.md")) {
      const skillName = await readSkillName(fullPath, fallbackName);
      managedSkills.push({ skillName, fullPath });
    }

    // Recurse into subdirectories (e.g., providers/linear/)
    managedSkills.push(...(await collectSkills(fullPath, fallbackName)));
  }

  return managedSkills;
}

async function removeManagedLinks(managedSkills, targetDirs) {
  const managedNames = new Set(managedSkills.map(({ skillName }) => skillName));
  const managedTargets = new Set(
    managedSkills.map(({ fullPath }) => resolve(fullPath)),
  );

  for (const targetDir of targetDirs) {
    const entries = await readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      const linkPath = join(targetDir, entry.name);
      try {
        const stat = await lstat(linkPath);
        if (!stat.isSymbolicLink()) {
          continue;
        }

        const linkTarget = await readlink(linkPath);
        const resolvedTarget = resolve(targetDir, linkTarget);
        if (
          managedNames.has(entry.name) ||
          managedTargets.has(resolvedTarget)
        ) {
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

function assertUniqueSkillNames(managedSkills) {
  const names = new Set();
  for (const { skillName } of managedSkills) {
    if (names.has(skillName)) {
      throw new Error(`Duplicate skill name: ${skillName}`);
    }
    names.add(skillName);
  }
}

export async function linkSkills({
  sourceDir = skillsSrc,
  targetDirs = [repoClaudeTargetDir, agentsTargetDir],
} = {}) {
  for (const targetDir of targetDirs) {
    await mkdir(targetDir, { recursive: true });
  }

  const managedSkills = await collectSkills(sourceDir);
  assertUniqueSkillNames(managedSkills);
  await removeManagedLinks(managedSkills, targetDirs);

  for (const { skillName, fullPath } of managedSkills) {
    for (const targetDir of targetDirs) {
      await createLink(targetDir, skillName, fullPath);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log("Linking skills into .claude/skills/ and .agents/skills/");
  await linkSkills();
  console.log("Done.");
}
