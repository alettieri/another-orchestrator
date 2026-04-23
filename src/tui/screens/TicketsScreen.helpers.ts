import type {
  AgentSession,
  TicketState,
  WorkflowDefinition,
} from "../../core/types.js";

export function getLatestSession(ticket: TicketState): AgentSession | null {
  if (ticket.status === "running" && ticket.currentSession) {
    return ticket.currentSession;
  }
  const entry = [...ticket.phaseHistory]
    .reverse()
    .find((e) => e.session !== undefined);
  return entry?.session ?? null;
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
