import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { OrchestratorConfig } from "../core/types.js";
import { buildPlanEnv, spawnInteractive } from "./interactive.js";

const mockConfig: OrchestratorConfig = {
  defaultAgent: "claude",
  agents: {
    claude: { command: "claude", defaultArgs: ["--verbose"] },
  },
  stateDir: "/abs/state",
  logDir: "/abs/logs",
  workflowDir: "/abs/workflows",
  promptDir: "/abs/prompts",
  scriptDir: "/abs/scripts",
  pollInterval: 10,
  maxConcurrency: 3,
  ghCommand: "gh",
};

describe("buildPlanEnv", () => {
  it("includes required env vars", () => {
    const env = buildPlanEnv(mockConfig, { repo: "/my/repo" });

    expect(env.ORCHESTRATOR_MODE).toBe("plan");
    expect(env.ORCHESTRATOR_STATE_DIR).toBe("/abs/state");
    expect(env.ORCHESTRATOR_WORKFLOW_DIR).toBe("/abs/workflows");
    expect(env.ORCHESTRATOR_REPO).toBe(resolve("/my/repo"));
  });

  it("includes workflow when provided", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      workflow: "standard",
    });

    expect(env.ORCHESTRATOR_WORKFLOW).toBe("standard");
  });

  it("excludes workflow when not provided", () => {
    const env = buildPlanEnv(mockConfig, { repo: "/my/repo" });

    expect(env.ORCHESTRATOR_WORKFLOW).toBeUndefined();
  });

  it("includes worktree root when provided", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      worktreeRoot: "/my/worktrees",
    });

    expect(env.ORCHESTRATOR_WORKTREE_ROOT).toBe(resolve("/my/worktrees"));
  });

  it("excludes worktree root when not provided", () => {
    const env = buildPlanEnv(mockConfig, { repo: "/my/repo" });

    expect(env.ORCHESTRATOR_WORKTREE_ROOT).toBeUndefined();
  });

  it("resolves relative repo path to absolute", () => {
    const env = buildPlanEnv(mockConfig, { repo: "./my-project" });

    expect(env.ORCHESTRATOR_REPO).toBe(resolve("./my-project"));
    expect(env.ORCHESTRATOR_REPO).toMatch(/^\//);
  });
});

describe("spawnInteractive", () => {
  it("runs a command and returns exit code 0", async () => {
    const code = await spawnInteractive({
      command: "true",
      args: [],
    });

    expect(code).toBe(0);
  });

  it("returns non-zero exit code on failure", async () => {
    const code = await spawnInteractive({
      command: "false",
      args: [],
    });

    expect(code).not.toBe(0);
  });

  it("passes env vars to the child process", async () => {
    const code = await spawnInteractive({
      command: "bash",
      args: ["-c", 'test "$MY_TEST_VAR" = "hello"'],
      env: { MY_TEST_VAR: "hello" },
    });

    expect(code).toBe(0);
  });
});
