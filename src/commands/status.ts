import chalk from "chalk";
import type { Command } from "commander";
import type { LoadConfigOptions } from "../core/config.js";
import { loadConfig } from "../core/config.js";
import { createStateManager } from "../core/state.js";
import type { TicketState, WorkflowDefinition } from "../core/types.js";
import { createWorkflowLoader } from "../core/workflow.js";

export function colorStatus(status: string): string {
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

function phaseProgress(
  workflow: WorkflowDefinition,
  currentPhase: string,
): string {
  const phases = workflow.phases;
  const index = phases.findIndex((p) => p.id === currentPhase);
  if (index === -1) return currentPhase;
  return `${currentPhase} (${index + 1}/${phases.length})`;
}

async function printTicketDetail(
  ticket: TicketState,
  workflows: { loadWorkflow(name: string): Promise<WorkflowDefinition> },
): Promise<void> {
  const statusStr = colorStatus(ticket.status);
  console.log(
    `  ${chalk.bold(ticket.ticketId)} ${statusStr} — ${ticket.title}`,
  );

  let workflow: WorkflowDefinition | null = null;
  try {
    workflow = await workflows.loadWorkflow(ticket.workflow);
  } catch {
    // workflow not found — show phase without progress
  }

  const progress = workflow
    ? phaseProgress(workflow, ticket.currentPhase)
    : ticket.currentPhase;
  console.log(`    Phase: ${chalk.cyan(progress)}`);

  if (ticket.error) {
    console.log(`    Error: ${chalk.red(ticket.error)}`);
  }

  if (ticket.context.pr_url) {
    console.log(`    PR: ${chalk.dim(ticket.context.pr_url)}`);
  }

  const sessionsWithId = ticket.phaseHistory.filter((h) => h.sessionId);
  if (sessionsWithId.length > 0) {
    const latest = sessionsWithId[sessionsWithId.length - 1];
    console.log(
      `    Session: ${chalk.dim(latest.sessionId)} ${chalk.dim(`(${latest.phase})`)}`,
    );
  }
}

export function register(
  program: Command,
  getConfigOptions: () => LoadConfigOptions,
): void {
  program
    .command("status")
    .description("Show plan and ticket status")
    .option("-p, --plan <planId>", "Show a specific plan")
    .option("--json", "Output as JSON")
    .action(async (opts: { plan?: string; json?: boolean }) => {
      const config = await loadConfig(getConfigOptions());
      const state = createStateManager(config.stateDir);
      const workflows = createWorkflowLoader(config.workflowSearchPath);

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

        const completed = tickets.filter((t) => t.status === "complete").length;
        console.log(chalk.bold(`Plan: ${plan.name} (${plan.id})`));
        console.log(`  Status: ${colorStatus(plan.status)}`);
        console.log(`  Workflow: ${plan.workflow}`);
        console.log(
          `  Progress: ${completed}/${tickets.length} tickets complete`,
        );
        console.log();

        for (const ticket of tickets) {
          await printTicketDetail(ticket, workflows);
        }
        return;
      }

      const plans = await state.listPlans();

      if (opts.json) {
        const allData = [];
        for (const plan of plans) {
          const tickets = await state.listTickets(plan.id);
          allData.push({ plan, tickets });
        }
        console.log(JSON.stringify(allData, null, 2));
        return;
      }

      if (plans.length === 0) {
        console.log(chalk.dim("No plans found."));
        return;
      }

      for (const plan of plans) {
        const tickets = await state.listTickets(plan.id);
        const completed = tickets.filter((t) => t.status === "complete").length;
        const running = tickets.filter((t) => t.status === "running").length;
        const failed = tickets.filter(
          (t) => t.status === "failed" || t.status === "needs_attention",
        ).length;

        console.log(chalk.bold(`${plan.name} `) + chalk.dim(`(${plan.id})`));

        const parts = [`${completed}/${tickets.length} complete`];
        if (running > 0) parts.push(chalk.cyan(`${running} running`));
        if (failed > 0) parts.push(chalk.red(`${failed} failed`));
        console.log(
          `  ${colorStatus(plan.status)} — ${plan.workflow} — ${parts.join(", ")}`,
        );
        console.log();

        for (const ticket of tickets) {
          await printTicketDetail(ticket, workflows);
        }
        console.log();
      }
    });
}
