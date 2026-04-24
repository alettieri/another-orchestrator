import { join } from "node:path";

export function resolvePlanSessionsDir(
  stateDir: string,
  planId: string,
): string {
  return join(stateDir, "plans", planId, "sessions");
}

export function resolveTicketSessionsDir(
  stateDir: string,
  planId: string,
  ticketId: string,
): string {
  return join(resolvePlanSessionsDir(stateDir, planId), ticketId);
}

export function resolveSessionLogPath(
  stateDir: string,
  planId: string,
  ticketId: string,
  sessionId: string,
): string {
  return join(
    resolveTicketSessionsDir(stateDir, planId, ticketId),
    `${sessionId}.jsonl`,
  );
}
