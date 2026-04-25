import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrchestratorConfig } from "../core/types.js";
import {
  buildInteractiveLaunchPlan,
  buildPlanEnv,
  spawnInteractive,
} from "./interactive.js";

const mockConfig: OrchestratorConfig = {
  defaultAgent: "claude",
  agents: {
    claude: { command: "claude", defaultArgs: ["--verbose"] },
  },
  orchestratorHome: "/abs/home",
  stateDir: "/abs/state",
  logDir: "/abs/logs",
  workflowDir: "/abs/workflows",
  workflowSearchPath: ["/abs/workflows"],
  promptDir: "/abs/prompts",
  promptSearchPath: ["/abs/prompts"],
  scriptDir: "/abs/scripts",
  skillsDir: "/abs/skills",
  pollInterval: 10,
  maxConcurrency: 3,
  ghCommand: "gh",
};

const tempDirs: string[] = [];
const originalMcpToken = process.env.MCP_TOKEN;

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orchestrator-interactive-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (originalMcpToken === undefined) {
    delete process.env.MCP_TOKEN;
  } else {
    process.env.MCP_TOKEN = originalMcpToken;
  }
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("buildPlanEnv", () => {
  it("includes required env vars", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      configPath: "/home/.orchestrator/config.yaml",
    });

    expect(env.ORCHESTRATOR_MODE).toBe("plan");
    expect(env.ORCHESTRATOR_STATE_DIR).toBe("/abs/state");
    expect(env.ORCHESTRATOR_WORKFLOW_DIR).toBe("/abs/workflows");
    expect(env.ORCHESTRATOR_REPO).toBe(resolve("/my/repo"));
  });

  it("includes resource directory env vars", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      configPath: "/home/.orchestrator/config.yaml",
    });

    expect(env.ORCHESTRATOR_SKILLS_DIR).toBe("/abs/skills");
    expect(env.ORCHESTRATOR_PROMPT_DIR).toBe("/abs/prompts");
    expect(env.ORCHESTRATOR_SCRIPT_DIR).toBe("/abs/scripts");
  });

  it("includes config path", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      configPath: "/home/.orchestrator/config.yaml",
    });

    expect(env.ORCHESTRATOR_CONFIG_PATH).toBe(
      "/home/.orchestrator/config.yaml",
    );
  });

  it("includes workflow when provided", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      workflow: "standard",
      configPath: "/cfg/config.yaml",
    });

    expect(env.ORCHESTRATOR_WORKFLOW).toBe("standard");
  });

  it("excludes workflow when not provided", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      configPath: "/cfg/config.yaml",
    });

    expect(env.ORCHESTRATOR_WORKFLOW).toBeUndefined();
  });

  it("includes worktree root when provided", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      worktreeRoot: "/my/worktrees",
      configPath: "/cfg/config.yaml",
    });

    expect(env.ORCHESTRATOR_WORKTREE_ROOT).toBe(resolve("/my/worktrees"));
  });

  it("excludes worktree root when not provided", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "/my/repo",
      configPath: "/cfg/config.yaml",
    });

    expect(env.ORCHESTRATOR_WORKTREE_ROOT).toBeUndefined();
  });

  it("resolves relative repo path to absolute", () => {
    const env = buildPlanEnv(mockConfig, {
      repo: "./my-project",
      configPath: "/cfg/config.yaml",
    });

    expect(env.ORCHESTRATOR_REPO).toBe(resolve("./my-project"));
    expect(env.ORCHESTRATOR_REPO).toMatch(/^\//);
  });
});

describe("buildInteractiveLaunchPlan", () => {
  it("preserves Claude interactive setup behind a launcher", async () => {
    const repoDir = await createTempDir();
    const promptDir = await createTempDir();
    await writeFile(
      join(promptDir, "interactive-system.md"),
      "You are the planning agent.",
    );

    process.env.MCP_TOKEN = "secret-token";

    const config: OrchestratorConfig = {
      ...mockConfig,
      promptDir,
      skillsDir: "/abs/skills",
      mcpServers: {
        linear: {
          command: "linear-mcp",
          args: ["--stdio"],
          env: { TOKEN: "$" + "{MCP_TOKEN}" },
        },
      },
    };

    const plan = await buildInteractiveLaunchPlan({
      agentName: "claude",
      agentConfig: { command: "claude", defaultArgs: ["--verbose"] },
      config,
      cwd: repoDir,
      env: { ORCHESTRATOR_MODE: "plan" },
    });

    expect(plan).toMatchObject({
      agentName: "claude",
      command: "claude",
      cwd: repoDir,
      env: { ORCHESTRATOR_MODE: "plan" },
    });
    expect(plan.args).toContain("--verbose");
    expect(plan.args).toEqual(
      expect.arrayContaining([
        "--append-system-prompt",
        "You are the planning agent.",
        "--add-dir",
        "/abs/skills",
      ]),
    );

    const mcpConfigIndex = plan.args.indexOf("--mcp-config");
    expect(mcpConfigIndex).toBeGreaterThan(-1);
    const mcpConfigPath = plan.args[mcpConfigIndex + 1];
    expect(mcpConfigPath).toBe(join(repoDir, ".claude", "mcp.json"));
    const mcpConfig = JSON.parse(await readFile(mcpConfigPath, "utf-8"));
    expect(mcpConfig).toEqual({
      mcpServers: {
        linear: {
          command: "linear-mcp",
          args: ["--stdio"],
          env: { TOKEN: "secret-token" },
        },
      },
    });
  });

  it("uses a generic subprocess launch plan for non-Claude agents", async () => {
    const plan = await buildInteractiveLaunchPlan({
      agentName: "codex",
      agentConfig: { command: "codex", defaultArgs: ["--model", "gpt-5.2"] },
      config: mockConfig,
      cwd: "/repo",
      env: { ORCHESTRATOR_MODE: "plan" },
    });

    expect(plan).toEqual({
      agentName: "codex",
      command: "codex",
      args: ["--model", "gpt-5.2"],
      cwd: "/repo",
      env: { ORCHESTRATOR_MODE: "plan" },
    });
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
