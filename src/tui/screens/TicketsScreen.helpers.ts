import type { TicketState, WorkflowDefinition } from "../../core/types.js";

export function getLatestSessionId(ticket: TicketState): string | null {
  if (ticket.status === "running" && ticket.currentSessionId) {
    return ticket.currentSessionId;
  }
  const entry = [...ticket.phaseHistory]
    .reverse()
    .find((e) => e.sessionId !== undefined);
  return entry?.sessionId ?? null;
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
