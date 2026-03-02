#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { buildPlanEnv, spawnInteractive } from "./agents/interactive.js";
import { loadConfig, resolveAgent } from "./core/config.js";
import { createRunner } from "./core/runner.js";
import { createStateManager } from "./core/state.js";
import { createLogger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name("orchestrator")
  .description("CLI-driven orchestrator for managing agent workflows")
  .version("0.1.0");

program
  .command("init")
  .description("Scaffold project directories and default config")
  .option("-d, --dir <path>", "Target directory", ".")
  .action(async (opts: { dir: string }) => {
    const targetDir = resolve(opts.dir);
    const dirs = ["state", "logs", "workflows", "prompts", "scripts", "skills"];

    for (const dir of dirs) {
      await mkdir(join(targetDir, dir), { recursive: true });
    }

    const defaultConfigSrc = resolve(__dirname, "..", "orchestrator.yaml");
    const defaultConfigDest = join(targetDir, "orchestrator.yaml");

    try {
      await copyFile(defaultConfigSrc, defaultConfigDest);
    } catch {
      // If the default config doesn't exist at expected location, skip
    }

    const logger = createLogger(join(targetDir, "logs"));
    logger.success(`Project initialized in ${targetDir}`);
    console.log(chalk.dim(`  Created directories: ${dirs.join(", ")}`));
  });

program
  .command("status")
  .description("Show plan and ticket status")
  .option("-p, --plan <planId>", "Show a specific plan")
  .option("--json", "Output as JSON")
  .action(async (opts: { plan?: string; json?: boolean }) => {
    const config = await loadConfig();
    const state = createStateManager(config.stateDir);

    if (opts.plan) {
      const plan = await state.getPlan(opts.plan);
      if (!plan) {
        console.error(chalk.red(`Plan "${opts.plan}" not found`));
        process.exitCode = 1;
        return;
      }

      const tickets = await state.listTickets(plan.id);

      if (opts.json) {
        console.log(JSON.stringify({ plan, tickets }, null, 2));
        return;
      }

      console.log(chalk.bold(`Plan: ${plan.name} (${plan.id})`));
      console.log(`  Status: ${colorStatus(plan.status)}`);
      console.log(`  Workflow: ${plan.workflow}`);
      console.log(`  Tickets: ${tickets.length}`);
      console.log();

      if (tickets.length > 0) {
        console.log(chalk.bold("  Tickets:"));
        for (const ticket of tickets) {
          console.log(
            `    ${ticket.ticketId} — ${colorStatus(ticket.status)} — ${ticket.title}`,
          );
        }
      }
      return;
    }

    const plans = await state.listPlans();

    if (opts.json) {
      console.log(JSON.stringify(plans, null, 2));
      return;
    }

    if (plans.length === 0) {
      console.log(chalk.dim("No plans found."));
      return;
    }

    console.log(chalk.bold("Plans:"));
    for (const plan of plans) {
      const tickets = await state.listTickets(plan.id);
      const completed = tickets.filter((t) => t.status === "complete").length;
      console.log(
        `  ${plan.id} — ${colorStatus(plan.status)} — ${plan.name} (${completed}/${tickets.length} tickets)`,
      );
    }
  });

program
  .command("run")
  .description("Run a single ticket through its workflow")
  .argument("<planId>", "Plan ID")
  .argument("<ticketId>", "Ticket ID")
  .action(async (planId: string, ticketId: string) => {
    const config = await loadConfig();
    const runner = createRunner(config);

    console.log(
      chalk.bold(
        `Running ticket ${chalk.cyan(ticketId)} from plan ${chalk.cyan(planId)}...`,
      ),
    );
    console.log();

    try {
      const result = await runner.runSingleTicket(planId, ticketId);
      console.log();
      console.log(
        chalk.bold(`Ticket ${result.ticketId}: ${colorStatus(result.status)}`),
      );
      if (result.error) {
        console.log(chalk.red(`  Error: ${result.error}`));
      }
      if (result.status === "failed" || result.status === "needs_attention") {
        process.exitCode = 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exitCode = 1;
    }
  });

program
  .command("daemon")
  .description("Start the daemon loop to process tickets continuously")
  .option("-c, --concurrency <n>", "Max concurrent tickets", Number.parseInt)
  .option("-a, --agent <name>", "Override default agent")
  .action(async (opts: { concurrency?: number; agent?: string }) => {
    const config = await loadConfig();
    if (opts.concurrency !== undefined) {
      config.maxConcurrency = opts.concurrency;
    }
    if (opts.agent) {
      config.defaultAgent = opts.agent;
    }

    const controller = new AbortController();

    const shutdown = () => {
      console.log(chalk.yellow("\nShutting down..."));
      controller.abort();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log(chalk.bold("Daemon started"));

    const runner = createRunner(config);
    try {
      await runner.startDaemon({ signal: controller.signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Daemon error: ${msg}`));
      process.exitCode = 1;
    }

    console.log(chalk.bold("Daemon stopped"));
    process.exit(process.exitCode ?? 0);
  });

program
  .command("tick")
  .description("Run a single daemon tick and exit")
  .action(async () => {
    const config = await loadConfig();
    const runner = createRunner(config);
    await runner.tick();
  });

program
  .command("pause")
  .description("Pause a running ticket")
  .argument("<planId>", "Plan ID")
  .argument("<ticketId>", "Ticket ID")
  .action(async (planId: string, ticketId: string) => {
    const config = await loadConfig();
    const state = createStateManager(config.stateDir);
    await state.updateTicket(planId, ticketId, { status: "paused" });
    console.log(chalk.green(`Paused ticket ${ticketId} in plan ${planId}`));
  });

program
  .command("resume")
  .description("Resume a paused ticket")
  .argument("<planId>", "Plan ID")
  .argument("<ticketId>", "Ticket ID")
  .action(async (planId: string, ticketId: string) => {
    const config = await loadConfig();
    const state = createStateManager(config.stateDir);
    await state.updateTicket(planId, ticketId, { status: "ready" });
    console.log(chalk.green(`Resumed ticket ${ticketId} in plan ${planId}`));
  });

program
  .command("skip")
  .description("Skip to a specific phase for a ticket")
  .argument("<planId>", "Plan ID")
  .argument("<ticketId>", "Ticket ID")
  .argument("<phase>", "Phase to skip to")
  .action(async (planId: string, ticketId: string, phase: string) => {
    const config = await loadConfig();
    const state = createStateManager(config.stateDir);
    await state.updateTicket(planId, ticketId, {
      currentPhase: phase,
      status: "ready",
    });
    console.log(
      chalk.green(
        `Skipped ticket ${ticketId} in plan ${planId} to phase ${phase}`,
      ),
    );
  });

program
  .command("retry")
  .description("Retry a failed ticket from its current phase")
  .argument("<planId>", "Plan ID")
  .argument("<ticketId>", "Ticket ID")
  .action(async (planId: string, ticketId: string) => {
    const config = await loadConfig();
    const state = createStateManager(config.stateDir);
    const ticket = await state.getTicket(planId, ticketId);
    if (!ticket) {
      console.error(chalk.red(`Ticket "${ticketId}" not found`));
      process.exitCode = 1;
      return;
    }
    const newRetries = { ...ticket.retries, [ticket.currentPhase]: 0 };
    await state.updateTicket(planId, ticketId, {
      retries: newRetries,
      status: "ready",
      error: null,
    });
    console.log(
      chalk.green(
        `Retrying ticket ${ticketId} from phase ${ticket.currentPhase}`,
      ),
    );
  });

program
  .command("pause-plan")
  .description("Pause an entire plan")
  .argument("<planId>", "Plan ID")
  .action(async (planId: string) => {
    const config = await loadConfig();
    const state = createStateManager(config.stateDir);
    const plan = await state.getPlan(planId);
    if (!plan) {
      console.error(chalk.red(`Plan "${planId}" not found`));
      process.exitCode = 1;
      return;
    }
    await state.savePlan({ ...plan, status: "paused" });
    console.log(chalk.green(`Paused plan ${planId}`));
  });

program
  .command("resume-plan")
  .description("Resume a paused plan")
  .argument("<planId>", "Plan ID")
  .action(async (planId: string) => {
    const config = await loadConfig();
    const state = createStateManager(config.stateDir);
    const plan = await state.getPlan(planId);
    if (!plan) {
      console.error(chalk.red(`Plan "${planId}" not found`));
      process.exitCode = 1;
      return;
    }
    await state.savePlan({ ...plan, status: "active" });
    console.log(chalk.green(`Resumed plan ${planId}`));
  });

program
  .command("plan")
  .description("Launch an interactive PI session for planning")
  .option("-r, --repo <path>", "Target repository path", ".")
  .option("-w, --workflow <name>", "Default workflow to use")
  .option("--worktree-root <path>", "Root directory for worktrees")
  .action(
    async (opts: {
      repo: string;
      workflow?: string;
      worktreeRoot?: string;
    }) => {
      const config = await loadConfig();

      const agentName = resolveAgent(config, null, null, "pi");
      const agentConfig = config.agents[agentName];

      const planEnv = buildPlanEnv(config, {
        repo: opts.repo,
        workflow: opts.workflow,
        worktreeRoot: opts.worktreeRoot,
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
            // Interpolate env vars from process.env
            const resolvedEnv: Record<string, string> = {};
            for (const [k, v] of Object.entries(server.env)) {
              resolvedEnv[k] = v.replace(/\$\{(\w+)\}/g, (_match, varName) => {
                return process.env[varName] ?? "";
              });
            }
            entry.env = resolvedEnv;
          }
          (mcpConfig.mcpServers as Record<string, unknown>)[name] = entry;
        }

        const mcpJsonPath = join(resolve(opts.repo), ".pi", "mcp.json");
        await mkdir(dirname(mcpJsonPath), { recursive: true });
        await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));
      }

      console.log(chalk.bold("Launching PI planning session..."));
      console.log(chalk.dim(`  Repo: ${planEnv.ORCHESTRATOR_REPO}`));
      if (planEnv.ORCHESTRATOR_WORKFLOW) {
        console.log(chalk.dim(`  Workflow: ${planEnv.ORCHESTRATOR_WORKFLOW}`));
      }
      console.log();

      const exitCode = await spawnInteractive({
        command: agentConfig.command,
        args: agentConfig.defaultArgs,
        cwd: resolve(opts.repo),
        env: planEnv,
      });

      process.exitCode = exitCode;
    },
  );

function colorStatus(status: string): string {
  switch (status) {
    case "active":
    case "running":
      return chalk.cyan(status);
    case "complete":
      return chalk.green(status);
    case "failed":
    case "needs_attention":
      return chalk.red(status);
    case "paused":
      return chalk.yellow(status);
    case "queued":
      return chalk.dim(status);
    case "ready":
      return chalk.blue(status);
    default:
      return status;
  }
}

program.parse();
