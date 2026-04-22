import type { TicketState, WorkflowDefinition } from "../../core/types.js";
import type { SessionReference } from "../session.js";

export function getLatestSession(ticket: TicketState): SessionReference | null {
  if (ticket.status === "running" && ticket.currentSessionId) {
    return {
      provider: ticket.currentSession?.provider ?? "claude",
      sessionId: ticket.currentSessionId,
    };
  }
  const entry = [...ticket.phaseHistory]
    .reverse()
    .find((e) => e.sessionId !== undefined);
  if (!entry?.sessionId) return null;
  return {
    provider: entry.session?.provider ?? "claude",
    sessionId: entry.sessionId,
  };
}

export function computeSkipUpdate(
  ticket: TicketState,
  workflows: Map<string, WorkflowDefinition>,
): Pick<TicketState, "currentPhase" | "status"> | null {
  const workflow = workflows.get(ticket.workflow);
  if (!workflow) return null;
  const phase = workflow.phases.find((p) => p.id === ticket.currentPhase);
  if (!phase?.onSuccess) return null;
  return { currentPhase: phase.onSuccess, status: "ready" };
}
