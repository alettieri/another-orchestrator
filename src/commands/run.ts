import chalk from "chalk";
import type { Command } from "commander";
import type { LoadConfigOptions } from "../core/config.js";
import { loadConfig } from "../core/config.js";
import { createRunner, DaemonAlreadyRunningError } from "../core/runner.js";
import { colorStatus } from "./status.js";

export function register(
  program: Command,
  getConfigOptions: () => LoadConfigOptions,
): void {
  program
    .command("run")
    .description("Run a single ticket through its workflow")
    .argument("<planId>", "Plan ID")
    .argument("<ticketId>", "Ticket ID")
    .action(async (planId: string, ticketId: string) => {
      const config = await loadConfig(getConfigOptions());
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
          chalk.bold(
            `Ticket ${result.ticketId}: ${colorStatus(result.status)}`,
          ),
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
      const config = await loadConfig(getConfigOptions());
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

      const runner = createRunner(config);
      try {
        await runner.startDaemon({ signal: controller.signal });
      } catch (err) {
        if (err instanceof DaemonAlreadyRunningError) {
          console.log(chalk.yellow(err.message));
          process.exitCode = 0;
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Daemon error: ${msg}`));
        process.exitCode = 1;
      } finally {
        process.off("SIGINT", shutdown);
        process.off("SIGTERM", shutdown);
      }
    });

  program
    .command("tick")
    .description("Run a single daemon tick and exit")
    .action(async () => {
      const config = await loadConfig(getConfigOptions());
      const runner = createRunner(config);
      await runner.tick();
    });
}
