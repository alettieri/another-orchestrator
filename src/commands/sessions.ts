import chalk from "chalk";
import type { Command } from "commander";
import { spawnInteractive } from "../agents/interactive.js";
import type { LoadConfigOptions } from "../core/config.js";
import { loadConfig } from "../core/config.js";
import { createStateManager } from "../core/state.js";
import type { PhaseHistoryEntry, TicketState } from "../core/types.js";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function getClaudeSessions(
  ticket: TicketState,
  phase?: string,
): PhaseHistoryEntry[] {
  let sessions = ticket.phaseHistory.filter((h) => h.sessionId);
  if (phase) {
    sessions = sessions.filter((h) => h.phase === phase);
  }
  return sessions;
}

export function register(
  program: Command,
  getConfigOptions: () => LoadConfigOptions,
): void {
  program
    .command("sessions")
    .description("List Claude sessions for a ticket")
    .argument("<planId>", "Plan ID")
    .argument("<ticketId>", "Ticket ID")
    .option("--phase <phase>", "Filter by phase name")
    .option("--json", "Output as JSON")
    .action(
      async (
        planId: string,
        ticketId: string,
        opts: { phase?: string; json?: boolean },
      ) => {
        const config = await loadConfig(getConfigOptions());
        const state = createStateManager(config.stateDir);
        const ticket = await state.getTicket(planId, ticketId);

        if (!ticket) {
          console.error(chalk.red(`Ticket "${ticketId}" not found`));
          process.exitCode = 1;
          return;
        }

        const sessions = getClaudeSessions(ticket, opts.phase);

        if (sessions.length === 0) {
          console.log("No Claude sessions found for this ticket.");
          return;
        }

        if (opts.json) {
          const output = sessions.map((s) => ({
            phase: s.phase,
            status: s.status,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
            sessionId: s.sessionId,
          }));
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        for (let i = 0; i < sessions.length; i++) {
          const s = sessions[i];
          const statusColor =
            s.status === "success"
              ? chalk.green(s.status)
              : chalk.red(s.status);
          console.log(
            `${i + 1}. ${chalk.cyan(s.phase)} ${statusColor} ${chalk.dim(s.startedAt)} ${chalk.yellow(s.sessionId)}`,
          );
        }

        console.log();
        console.log(
          `Resume a session with: orchestrator resume-session ${planId} ${ticketId} <session-id>`,
        );
      },
    );

  program
    .command("resume-session")
    .description("Resume a Claude session interactively")
    .argument("<planId>", "Plan ID")
    .argument("<ticketId>", "Ticket ID")
    .argument("[sessionId]", "Session ID to resume (defaults to most recent)")
    .option(
      "--phase <phase>",
      "Pick the most recent session from a specific phase",
    )
    .action(
      async (
        planId: string,
        ticketId: string,
        sessionIdArg: string | undefined,
        opts: { phase?: string },
      ) => {
        const config = await loadConfig(getConfigOptions());
        const state = createStateManager(config.stateDir);
        const ticket = await state.getTicket(planId, ticketId);

        if (!ticket) {
          console.error(chalk.red(`Ticket "${ticketId}" not found`));
          process.exitCode = 1;
          return;
        }

        let sessionId = sessionIdArg;

        if (!sessionId) {
          const sessions = getClaudeSessions(ticket, opts.phase);
          const latest = sessions[sessions.length - 1];
          sessionId = latest?.sessionId;
        }

        if (!sessionId) {
          console.error(
            chalk.red(
              "No session ID found. Provide one explicitly or check the ticket has Claude sessions.",
            ),
          );
          process.exitCode = 1;
          return;
        }

        if (!SESSION_ID_PATTERN.test(sessionId)) {
          console.error(
            chalk.red(
              "Invalid session ID format. Expected alphanumeric characters, hyphens, or underscores.",
            ),
          );
          process.exitCode = 1;
          return;
        }

        const cwd = ticket.worktree || process.cwd();

        console.log(`Session: ${chalk.yellow(sessionId)}`);
        console.log(`Ticket:  ${chalk.cyan(ticketId)}`);
        console.log(`CWD:     ${chalk.dim(cwd)}`);
        console.log();

        const exitCode = await spawnInteractive({
          command: "claude",
          args: ["--resume", sessionId],
          cwd,
        });

        process.exitCode = exitCode;
      },
    );
}
