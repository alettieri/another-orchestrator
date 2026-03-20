import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import YAML from "yaml";
import {
  type OrchestratorConfig,
  OrchestratorConfigSchema,
  RawOrchestratorConfigSchema,
} from "./types.js";

export interface LoadConfigOptions {
  configPath?: string;
  packageDir: string;
}

export function resolveOrchestratorHome(): string {
  return process.env.ORCHESTRATOR_HOME ?? join(homedir(), ".orchestrator");
}

export function findConfigFile(explicitPath?: string): string {
  // 1. Explicit --config flag
  if (explicitPath) {
    const abs = isAbsolute(explicitPath) ? explicitPath : resolve(explicitPath);
    if (!existsSync(abs)) {
      throw new Error(`Config file not found: ${abs}`);
    }
    return abs;
  }

  // 2. $ORCHESTRATOR_HOME/config.yaml
  const home = resolveOrchestratorHome();
  const homeConfig = join(home, "config.yaml");
  if (existsSync(homeConfig)) {
    return homeConfig;
  }

  // 3. CWD fallback (backward compat / local dev)
  const cwdConfig = resolve("orchestrator.yaml");
  if (existsSync(cwdConfig)) {
    return cwdConfig;
  }

  throw new Error(
    [
      "No config file found. Searched:",
      `  1. ${homeConfig}`,
      `  2. ${cwdConfig}`,
      "",
      'Run "orchestrator init" to create a default config at ~/.orchestrator/config.yaml',
    ].join("\n"),
  );
}

export async function loadConfig(
  opts: LoadConfigOptions,
): Promise<OrchestratorConfig> {
  const configFile = findConfigFile(opts.configPath);
  const raw = await readFile(configFile, "utf-8");
  const parsed = YAML.parse(raw);
  const rawConfig = RawOrchestratorConfigSchema.parse(parsed);

  const configDir = dirname(configFile);
  const home = resolveOrchestratorHome();
  const pkgDir = opts.packageDir;

  // Resolve a directory field: if explicitly set in config, resolve relative
  // to config file; otherwise use the provided default.
  function resolveDir(value: string | undefined, defaultPath: string): string {
    if (value !== undefined) {
      return isAbsolute(value) ? value : resolve(configDir, value);
    }
    return defaultPath;
  }

  const bundledWorkflowDir = join(pkgDir, "workflows");
  const homeWorkflowDir = join(home, "workflows");
  const workflowDir = rawConfig.workflowDir
    ? resolveDir(rawConfig.workflowDir, bundledWorkflowDir)
    : homeWorkflowDir;
  const workflowSearchPath =
    workflowDir !== bundledWorkflowDir
      ? [workflowDir, bundledWorkflowDir]
      : [bundledWorkflowDir];

  const bundledPromptDir = join(pkgDir, "prompts");
  const homePromptDir = join(home, "prompts");
  const promptDir = rawConfig.promptDir
    ? resolveDir(rawConfig.promptDir, bundledPromptDir)
    : homePromptDir;
  const promptSearchPath =
    promptDir !== bundledPromptDir
      ? [promptDir, bundledPromptDir]
      : [bundledPromptDir];

  const resolved: OrchestratorConfig = {
    ...rawConfig,
    orchestratorHome: home,
    // User data dirs default to ~/.orchestrator/<name>
    stateDir: resolveDir(rawConfig.stateDir, join(home, "state")),
    logDir: resolveDir(rawConfig.logDir, join(home, "logs")),
    // Bundled dirs default to <packageDir>/<name>
    workflowDir,
    workflowSearchPath,
    promptDir,
    promptSearchPath,
    scriptDir: resolveDir(rawConfig.scriptDir, join(pkgDir, "scripts")),
    skillsDir: resolveDir(rawConfig.skillsDir, join(pkgDir, "skills")),
  };

  return OrchestratorConfigSchema.parse(resolved);
}

export function resolveAgent(
  config: OrchestratorConfig,
  phaseAgent: string | null | undefined,
  ticketAgent: string | null | undefined,
  planAgent: string | null | undefined,
): string {
  const agentName =
    phaseAgent ?? ticketAgent ?? planAgent ?? config.defaultAgent;

  if (!config.agents[agentName]) {
    throw new Error(
      `Agent "${agentName}" not found in config. Available agents: ${Object.keys(config.agents).join(", ")}`,
    );
  }

  return agentName;
}
