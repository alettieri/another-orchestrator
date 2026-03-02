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
  };

  if (opts.workflow) {
    env.ORCHESTRATOR_WORKFLOW = opts.workflow;
  }

  if (opts.worktreeRoot) {
    env.ORCHESTRATOR_WORKTREE_ROOT = resolve(opts.worktreeRoot);
  }

  return env;
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
