import { resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import {
  buildInteractiveLaunchPlan,
  buildPlanEnv,
  spawnInteractive,
} from "../agents/interactive.js";
import {
  findConfigFile,
  type LoadConfigOptions,
  loadConfig,
  resolveAgent,
} from "../core/config.js";

export function register(
  program: Command,
  getConfigOptions: () => LoadConfigOptions,
): void {
  program
    .command("interactive")
    .description("Launch an interactive planning and configuration session")
    .option("-a, --agent <name>", "Override default interactive agent")
    .option("-r, --repo <path>", "Target repository or workspace path")
    .option("-w, --workflow <name>", "Default workflow to use")
    .option("--worktree-root <path>", "Root directory for worktrees")
    .action(
      async (opts: {
        agent?: string;
        repo?: string;
        workflow?: string;
        worktreeRoot?: string;
      }) => {
        const configOpts = getConfigOptions();
        const config = await loadConfig(configOpts);
        const configPath = findConfigFile(configOpts.configPath);

        const agentName = resolveAgent(config, opts.agent, null, null);
        const agentConfig = config.agents[agentName];

        const repoCwd = resolve(opts.repo ?? ".");

        const planEnv = buildPlanEnv(config, {
          repo: repoCwd,
          workflow: opts.workflow,
          worktreeRoot: opts.worktreeRoot,
          configPath,
        });

        const launchPlan = await buildInteractiveLaunchPlan({
          agentName,
          agentConfig,
          config,
          cwd: repoCwd,
          env: planEnv,
        });

        console.log(chalk.bold("Launching interactive planning session..."));
        console.log(chalk.dim(`  Agent: ${agentName}`));
        console.log(chalk.dim(`  CWD: ${repoCwd}`));
        if (planEnv.ORCHESTRATOR_WORKFLOW) {
          console.log(
            chalk.dim(`  Workflow: ${planEnv.ORCHESTRATOR_WORKFLOW}`),
          );
        }
        console.log();

        const exitCode = await spawnInteractive(launchPlan);
        process.exitCode = exitCode;
      },
    );
}
