import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import type { Command } from "commander";
import {
  buildPlanEnv,
  runPiInteractive,
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
    .description(
      "Launch an interactive PI session for planning and configuration",
    )
    .option("-r, --repo <path>", "Target repository or workspace path")
    .option("-w, --workflow <name>", "Default workflow to use")
    .option("--worktree-root <path>", "Root directory for worktrees")
    .action(
      async (opts: {
        repo?: string;
        workflow?: string;
        worktreeRoot?: string;
      }) => {
        const configOpts = getConfigOptions();
        const config = await loadConfig(configOpts);
        const configPath = findConfigFile(configOpts.configPath);

        const agentName = resolveAgent(config, null, null, "pi");
        const agentConfig = config.agents[agentName];

        const repoCwd = resolve(opts.repo ?? ".");

        const planEnv = buildPlanEnv(config, {
          repo: repoCwd,
          workflow: opts.workflow,
          worktreeRoot: opts.worktreeRoot,
          configPath,
        });

        // Write .pi/mcp.json if mcpServers are configured
        if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
          const mcpConfig: Record<string, unknown> = { mcpServers: {} };
          for (const [name, server] of Object.entries(config.mcpServers)) {
            const entry: Record<string, unknown> = {
              command: server.command,
              args: server.args,
            };
            if (server.env) {
              const resolvedEnv: Record<string, string> = {};
              for (const [k, v] of Object.entries(server.env)) {
                resolvedEnv[k] = v.replace(
                  /\$\{(\w+)\}/g,
                  (_match, varName) => {
                    return process.env[varName] ?? "";
                  },
                );
              }
              entry.env = resolvedEnv;
            }
            (mcpConfig.mcpServers as Record<string, unknown>)[name] = entry;
          }

          const mcpJsonPath = join(repoCwd, ".pi", "mcp.json");
          await mkdir(dirname(mcpJsonPath), { recursive: true });
          await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
        }

        console.log(chalk.bold("Launching interactive planning session..."));
        console.log(chalk.dim(`  CWD: ${repoCwd}`));
        if (planEnv.ORCHESTRATOR_WORKFLOW) {
          console.log(
            chalk.dim(`  Workflow: ${planEnv.ORCHESTRATOR_WORKFLOW}`),
          );
        }
        console.log();

        if (agentName === "pi") {
          // Call PI library directly — no need for `pi` to be on PATH
          const systemPromptPath = join(
            config.promptDir,
            "interactive-system.md",
          );
          const piPkgEntry = fileURLToPath(
            import.meta.resolve("@mariozechner/pi-coding-agent"),
          );
          const piPkgDir = dirname(dirname(piPkgEntry));
          const questionExtPath = join(
            piPkgDir,
            "examples",
            "extensions",
            "question.ts",
          );
          const packageDir = resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../..",
          );
          const bannerExtPath = join(packageDir, "extensions", "banner.ts");
          const piArgs = [
            ...agentConfig.defaultArgs,
            "--skill",
            config.skillsDir,
            "--append-system-prompt",
            systemPromptPath,
            "--extension",
            questionExtPath,
            "--extension",
            bannerExtPath,
          ];
          await runPiInteractive({
            args: piArgs,
            cwd: repoCwd,
            env: planEnv,
          });
        } else {
          const exitCode = await spawnInteractive({
            command: agentConfig.command,
            args: agentConfig.defaultArgs,
            cwd: repoCwd,
            env: planEnv,
          });
          process.exitCode = exitCode;
        }
      },
    );
}
