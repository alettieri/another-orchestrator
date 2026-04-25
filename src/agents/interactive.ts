import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AgentConfig, OrchestratorConfig } from "../core/types.js";

export interface SpawnInteractiveOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface InteractiveLaunchPlan extends SpawnInteractiveOptions {
  agentName: string;
}

export interface BuildInteractiveLaunchPlanOptions {
  agentName: string;
  agentConfig: AgentConfig;
  config: OrchestratorConfig;
  cwd: string;
  env: Record<string, string>;
}

type ClaudeMcpConfig = {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  >;
};

export interface PlanOptions {
  repo: string;
  workflow?: string;
  worktreeRoot?: string;
  configPath: string;
}

export function buildPlanEnv(
  config: OrchestratorConfig,
  opts: PlanOptions,
): Record<string, string> {
  const env: Record<string, string> = {
    ORCHESTRATOR_MODE: "plan",
    ORCHESTRATOR_STATE_DIR: config.stateDir,
    ORCHESTRATOR_WORKFLOW_DIR: config.workflowDir,
    ORCHESTRATOR_REPO: resolve(opts.repo),
    ORCHESTRATOR_SKILLS_DIR: config.skillsDir,
    ORCHESTRATOR_PROMPT_DIR: config.promptDir,
    ORCHESTRATOR_SCRIPT_DIR: config.scriptDir,
    ORCHESTRATOR_CONFIG_PATH: opts.configPath,
  };

  if (opts.workflow) {
    env.ORCHESTRATOR_WORKFLOW = opts.workflow;
  }

  if (opts.worktreeRoot) {
    env.ORCHESTRATOR_WORKTREE_ROOT = resolve(opts.worktreeRoot);
  }

  return env;
}

export async function buildInteractiveLaunchPlan(
  opts: BuildInteractiveLaunchPlanOptions,
): Promise<InteractiveLaunchPlan> {
  const args = [...opts.agentConfig.defaultArgs];

  if (
    opts.agentName === "claude" ||
    basename(opts.agentConfig.command) === "claude"
  ) {
    const systemPromptPath = join(
      opts.config.promptDir,
      "interactive-system.md",
    );
    try {
      const systemPrompt = await readFile(systemPromptPath, "utf-8");
      args.push("--append-system-prompt", systemPrompt);
    } catch {
      // No system prompt file -- proceed without it.
    }

    if (
      opts.config.mcpServers &&
      Object.keys(opts.config.mcpServers).length > 0
    ) {
      const mcpConfig: ClaudeMcpConfig = { mcpServers: {} };
      for (const [name, server] of Object.entries(opts.config.mcpServers)) {
        const entry: ClaudeMcpConfig["mcpServers"][string] = {
          command: server.command,
          args: server.args,
        };
        if (server.env) {
          entry.env = {};
          for (const [key, value] of Object.entries(server.env)) {
            entry.env[key] = value.replace(
              /\$\{(\w+)\}/g,
              (_match, varName) => {
                return process.env[varName] ?? "";
              },
            );
          }
        }
        mcpConfig.mcpServers[name] = entry;
      }

      const mcpJsonDir = join(opts.cwd, ".claude");
      const mcpJsonPath = join(mcpJsonDir, "mcp.json");
      await mkdir(mcpJsonDir, { recursive: true });
      await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
      args.push("--mcp-config", mcpJsonPath);
    }

    args.push("--add-dir", opts.config.skillsDir);
  }

  return {
    agentName: opts.agentName,
    command: opts.agentConfig.command,
    args,
    cwd: opts.cwd,
    env: opts.env,
  };
}

export function spawnInteractive(
  opts: SpawnInteractiveOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
