import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AgentConfig, OrchestratorConfig } from "../core/types.js";
import { type PreparedMcpLaunch, prepareMcpLaunch } from "./mcp.js";

interface InteractiveLaunchPlanBase {
  agentName: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  warnings: string[];
}

export interface SubprocessInteractiveLaunchPlan
  extends InteractiveLaunchPlanBase {
  mode: "subprocess";
  command: string;
}

export interface SpawnInteractiveOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type InProcessInteractiveRunner = (opts: {
  args: string[];
  cwd: string;
  env: Record<string, string>;
}) => Promise<void>;

export interface InProcessInteractiveLaunchPlan
  extends InteractiveLaunchPlanBase {
  mode: "in-process";
  runner: InProcessInteractiveRunner;
}

export type InteractiveLaunchPlan =
  | SubprocessInteractiveLaunchPlan
  | InProcessInteractiveLaunchPlan;

export interface BuildInteractiveLaunchPlanOptions {
  agentName: string;
  agentConfig: AgentConfig;
  config: OrchestratorConfig;
  cwd: string;
  env: Record<string, string>;
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

export async function buildInteractiveLaunchPlan(
  opts: BuildInteractiveLaunchPlanOptions,
): Promise<InteractiveLaunchPlan> {
  const provider =
    basename(opts.agentConfig.command).toLowerCase() ||
    opts.agentName.toLowerCase();
  const mcpLaunch = await prepareMcpLaunch({
    config: opts.config,
    provider,
    cwd: opts.cwd,
  });

  if (opts.agentName === "claude" || provider === "claude") {
    return buildClaudeInteractiveLaunchPlan(opts, mcpLaunch);
  }

  if (opts.agentName === "codex" || provider === "codex") {
    return buildGenericInteractiveLaunchPlan(opts, mcpLaunch.warnings, [
      ...opts.agentConfig.defaultArgs,
      ...mcpLaunch.launchData.args,
    ]);
  }

  if (opts.agentName === "pi" || provider === "pi") {
    return buildPiInteractiveLaunchPlan(opts, mcpLaunch.warnings);
  }

  return buildGenericInteractiveLaunchPlan(opts, mcpLaunch.warnings);
}

async function buildClaudeInteractiveLaunchPlan(
  opts: BuildInteractiveLaunchPlanOptions,
  mcpLaunch: PreparedMcpLaunch,
): Promise<SubprocessInteractiveLaunchPlan> {
  const args = [...opts.agentConfig.defaultArgs];

  const systemPromptPath = join(opts.config.promptDir, "interactive-system.md");
  try {
    const systemPrompt = await readFile(systemPromptPath, "utf-8");
    args.push("--append-system-prompt", systemPrompt);
  } catch {
    // No system prompt file -- proceed without it.
  }

  args.push(...mcpLaunch.launchData.args);

  args.push("--add-dir", opts.config.skillsDir);

  return {
    mode: "subprocess",
    agentName: opts.agentName,
    command: opts.agentConfig.command,
    args,
    cwd: opts.cwd,
    env: opts.env,
    warnings: mcpLaunch.warnings,
  };
}

function buildPiInteractiveLaunchPlan(
  opts: BuildInteractiveLaunchPlanOptions,
  warnings: string[],
): InProcessInteractiveLaunchPlan {
  return {
    mode: "in-process",
    agentName: opts.agentName,
    runner: runPiInteractive,
    args: [...opts.agentConfig.defaultArgs],
    cwd: opts.cwd,
    env: opts.env,
    warnings,
  };
}

function buildGenericInteractiveLaunchPlan(
  opts: BuildInteractiveLaunchPlanOptions,
  warnings: string[],
  args = [...opts.agentConfig.defaultArgs],
): SubprocessInteractiveLaunchPlan {
  return {
    mode: "subprocess",
    agentName: opts.agentName,
    command: opts.agentConfig.command,
    args,
    cwd: opts.cwd,
    env: opts.env,
    warnings,
  };
}

export async function runPiInteractive(opts: {
  args: string[];
}): Promise<void> {
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<Record<string, unknown>>;
  const pi = await dynamicImport("@mariozechner/pi-coding-agent");
  const runner = pi.runInteractive ?? pi.interactive ?? pi.main ?? pi.default;

  if (typeof runner !== "function") {
    throw new Error(
      "PI interactive module does not export runInteractive, interactive, main, or default",
    );
  }

  await runner(opts.args);
}

export async function spawnInteractive(
  opts: InteractiveLaunchPlan | SpawnInteractiveOptions,
): Promise<number> {
  if ("mode" in opts && opts.mode === "in-process") {
    return runInProcessInteractive(opts);
  }

  const subprocessOpts =
    "mode" in opts
      ? opts
      : {
          mode: "subprocess" as const,
          agentName: basename(opts.command),
          command: opts.command,
          args: opts.args,
          cwd: opts.cwd ?? process.cwd(),
          env: opts.env ?? {},
        };

  return new Promise((resolve, reject) => {
    const child = spawn(subprocessOpts.command, subprocessOpts.args, {
      cwd: subprocessOpts.cwd,
      env: { ...process.env, ...subprocessOpts.env },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function runInProcessInteractive(
  opts: InProcessInteractiveLaunchPlan,
): Promise<number> {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  try {
    process.chdir(opts.cwd);
    Object.assign(process.env, opts.env);
    await opts.runner({
      args: opts.args,
      cwd: opts.cwd,
      env: opts.env,
    });
    return 0;
  } finally {
    process.chdir(originalCwd);
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  }
}
