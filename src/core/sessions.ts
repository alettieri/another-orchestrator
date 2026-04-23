import type { AgentSession, TicketState } from "./types.js";

export interface TicketSessionLookup {
  session: AgentSession;
  phase: string | null;
}

export function getTicketSession(
  ticket: TicketState,
): TicketSessionLookup | null {
  if (ticket.status === "running" && ticket.currentSession) {
    return {
      session: ticket.currentSession,
      phase: ticket.currentPhase,
    };
  }

  const entry = [...ticket.phaseHistory]
    .reverse()
    .find((historyEntry) => historyEntry.session !== undefined);

  if (!entry?.session) {
    return null;
  }

  return {
    session: entry.session,
    phase: entry.phase,
  };
}

export function getResumeCommand(session: AgentSession): string {
  return session.provider === "claude"
    ? `claude --resume ${session.id}`
    : `codex resume ${session.id}`;
}

export function formatCompactSessionLabel(session: AgentSession): string {
  const providerHint = session.provider === "claude" ? "cl" : "cx";
  const truncatedId =
    session.id.length > 10 ? `${session.id.slice(0, 10)}…` : session.id;
  return `${providerHint}:${truncatedId}`;
}
