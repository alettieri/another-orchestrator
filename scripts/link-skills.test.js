import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { linkSkills, parseSkillName } from "./link-skills.js";

const tempDirs = [];

async function createSkill(rootDir, relativeDir, name) {
  const skillDir = join(rootDir, relativeDir);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n\n# ${name}\n`,
  );
  return skillDir;
}

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "link-skills-"));
  tempDirs.push(dir);
  return dir;
}

describe("link-skills.js", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("parses skill names from frontmatter", () => {
    expect(
      parseSkillName("---\nname: github-issues\ndescription: Test\n---\n"),
    ).toBe("github-issues");
    expect(parseSkillName("# No frontmatter\n")).toBeNull();
  });

  it("links nested skills by declared name and removes stale flattened links", async () => {
    const rootDir = await createTempDir();
    const sourceDir = join(rootDir, "skills");
    const targetDir = join(rootDir, ".agents", "skills");
    await createSkill(sourceDir, "providers/linear", "linear");
    await createSkill(sourceDir, "providers/github-issues", "github-issues");
    await createSkill(sourceDir, "planner", "planner");
    await mkdir(targetDir, { recursive: true });

    await linkSkills({ sourceDir, targetDirs: [targetDir] });

    expect(await readlink(join(targetDir, "linear"))).toBe(
      "../../skills/providers/linear",
    );
    expect(await readlink(join(targetDir, "github-issues"))).toBe(
      "../../skills/providers/github-issues",
    );
    expect(await readlink(join(targetDir, "planner"))).toBe("../../skills/planner");

    await rm(join(targetDir, "linear"));
    await mkdir(join(rootDir, "external-dir"));
    await rm(join(targetDir, "github-issues"));
    await symlink(
      "../../skills/providers/linear",
      join(targetDir, "providers-linear"),
    );
    await symlink(
      "../../external-dir",
      join(targetDir, "external-skill"),
    );

    await linkSkills({ sourceDir, targetDirs: [targetDir] });

    expect(existsSync(join(targetDir, "providers-linear"))).toBe(false);
    expect(await readlink(join(targetDir, "linear"))).toBe(
      "../../skills/providers/linear",
    );
    expect(await lstat(join(targetDir, "external-skill"))).toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
  });
});
