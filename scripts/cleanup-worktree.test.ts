import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(new URL("./cleanup-worktree.sh", import.meta.url));

async function runGit(args: string[], cwd: string) {
  return execFile("git", args, { cwd });
}

async function createRepo() {
  const repoDir = await mkdtemp(join(tmpdir(), "cleanup-worktree-repo-"));
  await runGit(["init", "-b", "main"], repoDir);
  await runGit(["config", "user.name", "Test User"], repoDir);
  await runGit(["config", "user.email", "test@example.com"], repoDir);
  await writeFile(join(repoDir, "README.md"), "base\n");
  await runGit(["add", "README.md"], repoDir);
  await runGit(["commit", "-m", "initial"], repoDir);
  return repoDir;
}

describe("cleanup-worktree.sh", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupPaths.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    cleanupPaths.length = 0;
  });

  it("removes the worktree and deletes the local branch", async () => {
    const repoDir = await createRepo();
    cleanupPaths.push(repoDir);
    const worktreeDir = await mkdtemp(join(tmpdir(), "cleanup-worktree-remove-"));
    cleanupPaths.push(worktreeDir);

    await runGit(["worktree", "add", worktreeDir, "-b", "feature/remove-me"], repoDir);

    const result = await execFile(scriptPath, [worktreeDir, "feature/remove-me"]);

    expect(result.stdout).toContain(`Worktree removed: ${worktreeDir}`);
    expect(result.stdout).toContain("Branch removed: feature/remove-me");
    expect(existsSync(worktreeDir)).toBe(false);
    const branches = await runGit(["branch", "--list", "feature/remove-me"], repoDir);
    expect(branches.stdout.trim()).toBe("");
  });

  it("logs a clean outcome when the branch ref is already missing", async () => {
    const repoDir = await createRepo();
    cleanupPaths.push(repoDir);
    const worktreeDir = await mkdtemp(join(tmpdir(), "cleanup-worktree-missing-"));
    cleanupPaths.push(worktreeDir);

    await runGit(["worktree", "add", worktreeDir, "-b", "feature/already-gone"], repoDir);
    await runGit(["update-ref", "-d", "refs/heads/feature/already-gone"], repoDir);

    const result = await execFile(scriptPath, [worktreeDir, "feature/already-gone"]);

    expect(result.stdout).toContain(`Worktree removed: ${worktreeDir}`);
    expect(result.stdout).toContain("Branch already removed: feature/already-gone");
    expect(existsSync(worktreeDir)).toBe(false);
  });

  it("fails explicitly when git refuses to delete an unmerged branch", async () => {
    const repoDir = await createRepo();
    cleanupPaths.push(repoDir);
    const worktreeDir = await mkdtemp(join(tmpdir(), "cleanup-worktree-refuse-"));
    cleanupPaths.push(worktreeDir);

    await runGit(["worktree", "add", worktreeDir, "-b", "feature/not-merged"], repoDir);
    await writeFile(join(worktreeDir, "feature.txt"), "not merged\n");
    await runGit(["add", "feature.txt"], worktreeDir);
    await runGit(["commit", "-m", "feature work"], worktreeDir);

    await expect(
      execFile(scriptPath, [worktreeDir, "feature/not-merged"]),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining(`Worktree removed: ${worktreeDir}`),
      stderr: expect.stringContaining(
        "Git refused to delete branch feature/not-merged after worktree cleanup.",
      ),
    });

    expect(existsSync(worktreeDir)).toBe(false);
    const branches = await runGit(["branch", "--list", "feature/not-merged"], repoDir);
    expect(branches.stdout).toContain("feature/not-merged");
  });
});
