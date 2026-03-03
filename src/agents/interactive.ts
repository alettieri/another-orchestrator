import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { OrchestratorConfig } from "../core/types.js";

export interface SpawnInteractiveOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

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

export interface RunPiOptions {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export async function runPiInteractive(opts: RunPiOptions): Promise<void> {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  try {
    process.chdir(opts.cwd);
    Object.assign(process.env, opts.env);

    const { main } = await import("@mariozechner/pi-coding-agent");
    await main(opts.args);
  } finally {
    process.chdir(originalCwd);
    // Restore env: remove keys we added, restore originals
    for (const key of Object.keys(opts.env)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  }
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
