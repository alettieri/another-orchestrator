import chalk from "chalk";
import type { Command } from "commander";
import { spawnInteractive } from "../agents/interactive.js";
import type { LoadConfigOptions } from "../core/config.js";
import { loadConfig } from "../core/config.js";
import { createStateManager } from "../core/state.js";
import type { PhaseHistoryEntry, TicketState } from "../core/types.js";
import {
  buildResumeArgs,
  getResumeCommand,
  type SessionReference,
} from "../tui/session.js";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

type PhaseHistorySession = PhaseHistoryEntry & { sessionId: string };
export interface TicketSessionEntry {
  phase: string;
  status: "running" | PhaseHistorySession["status"];
  startedAt: string;
  completedAt: string | null;
  provider: string;
  sessionId: string;
}

function toTicketSessionEntry(entry: PhaseHistorySession): TicketSessionEntry {
  return {
    phase: entry.phase,
    status: entry.status,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    provider: entry.session?.provider ?? "claude",
    sessionId: entry.sessionId,
  };
}

function getCurrentSession(ticket: TicketState): TicketSessionEntry | null {
  if (!ticket.currentSessionId) return null;

  return {
    phase: ticket.currentPhase,
    status: "running",
    startedAt: new Date(0).toISOString(),
    completedAt: null,
    provider: ticket.currentSession?.provider ?? "claude",
    sessionId: ticket.currentSessionId,
  };
}

export function getSessions(
  ticket: TicketState,
  phase?: string,
): TicketSessionEntry[] {
  let sessions = ticket.phaseHistory
    .filter((h): h is PhaseHistorySession => h.sessionId != null)
    .map(toTicketSessionEntry);
  const currentSession = getCurrentSession(ticket);
  if (
    currentSession &&
    !sessions.some((session) => session.sessionId === currentSession.sessionId)
  ) {
    sessions = [...sessions, currentSession];
  }
  if (phase) {
    sessions = sessions.filter((h) => h.phase === phase);
  }
  return sessions;
}

export function resolveSessionReference(
  ticket: TicketState,
  sessionId: string,
  phase?: string,
): SessionReference {
  const knownSession = getSessions(ticket, phase).find(
    (session) => session.sessionId === sessionId,
  );
  if (knownSession) {
    return {
      provider: knownSession.provider,
      sessionId: knownSession.sessionId,
    };
  }

  return { provider: "claude", sessionId };
}

export function register(
  program: Command,
  getConfigOptions: () => LoadConfigOptions,
): void {
  program
    .command("sessions")
    .description("List agent sessions for a ticket")
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

        const sessions = getSessions(ticket, opts.phase);

        if (sessions.length === 0) {
          console.log("No agent sessions found for this ticket.");
          return;
        }

        if (opts.json) {
          const output = sessions.map((s) => ({
            phase: s.phase,
            status: s.status,
            startedAt: s.startedAt,
            completedAt: s.completedAt,
            provider: s.provider,
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
              : s.status === "running"
                ? chalk.yellow(s.status)
                : chalk.red(s.status);
          console.log(
            `${i + 1}. ${chalk.cyan(s.phase)} ${statusColor} ${chalk.dim(s.startedAt)} ${chalk.magenta(s.provider)} ${chalk.yellow(s.sessionId)}`,
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
    .description("Resume an agent session interactively")
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
          const sessions = getSessions(ticket, opts.phase);
          const latest = sessions[sessions.length - 1];
          sessionId = latest?.sessionId;
        }

        if (!sessionId) {
          console.error(
            chalk.red(
              "No session ID found. Provide one explicitly or check the ticket has agent sessions.",
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
        const sessionRef = resolveSessionReference(
          ticket,
          sessionId,
          opts.phase,
        );
        const command = getResumeCommand(sessionRef);
        const args = buildResumeArgs(sessionRef);

        console.log(`Session:  ${chalk.yellow(sessionId)}`);
        console.log(`Provider: ${chalk.magenta(sessionRef.provider)}`);
        console.log(`Ticket:  ${chalk.cyan(ticketId)}`);
        console.log(`CWD:     ${chalk.dim(cwd)}`);
        console.log();

        const exitCode = await spawnInteractive({
          command,
          args,
          cwd,
        });

        process.exitCode = exitCode;
      },
    );
}
