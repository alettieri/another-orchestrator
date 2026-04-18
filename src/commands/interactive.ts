import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { buildPlanEnv, spawnInteractive } from "../agents/interactive.js";
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
      "Launch an interactive Claude session for planning and configuration",
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

        const agentName = resolveAgent(config, null, null, null);
        const agentConfig = config.agents[agentName];

        const repoCwd = resolve(opts.repo ?? ".");

        const planEnv = buildPlanEnv(config, {
          repo: repoCwd,
          workflow: opts.workflow,
          worktreeRoot: opts.worktreeRoot,
          configPath,
        });

        // Build args for the agent
        const args = [...agentConfig.defaultArgs];

        // Append the interactive system prompt if available
        const systemPromptPath = join(
          config.promptDir,
          "interactive-system.md",
        );
        try {
          const systemPrompt = await readFile(systemPromptPath, "utf-8");
          args.push("--append-system-prompt", systemPrompt);
        } catch {
          // No system prompt file — proceed without it
        }

        // Write MCP config if mcpServers are configured
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

          const mcpJsonDir = join(repoCwd, ".claude");
          const mcpJsonPath = join(mcpJsonDir, "mcp.json");
          await mkdir(mcpJsonDir, { recursive: true });
          await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
          args.push("--mcp-config", mcpJsonPath);
        }

        // Add skills directory so Claude has access to skill docs
        args.push("--add-dir", config.skillsDir);

        console.log(chalk.bold("Launching interactive planning session..."));
        console.log(chalk.dim(`  Agent: ${agentName}`));
        console.log(chalk.dim(`  CWD: ${repoCwd}`));
        if (planEnv.ORCHESTRATOR_WORKFLOW) {
          console.log(
            chalk.dim(`  Workflow: ${planEnv.ORCHESTRATOR_WORKFLOW}`),
          );
        }
        console.log();

        const exitCode = await spawnInteractive({
          command: agentConfig.command,
          args,
          cwd: repoCwd,
          env: planEnv,
        });
        process.exitCode = exitCode;
      },
    );
}
