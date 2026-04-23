import { getTicketSession } from "../../core/sessions.js";
import type {
  AgentSession,
  TicketState,
  WorkflowDefinition,
} from "../../core/types.js";

export function getLatestSession(ticket: TicketState): AgentSession | null {
  return getTicketSession(ticket)?.session ?? null;
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
