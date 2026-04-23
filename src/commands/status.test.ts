import { describe, expect, it } from "vitest";
import type { TicketState } from "../core/types.js";
import { getStatusSessionLine } from "./status.js";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "SESS-04",
    title: "Expose structured sessions",
    description: "",
    acceptanceCriteria: [],
    linearUrl: null,
    repo: null,
    workflow: "standard",
    branch: "feat/sessions",
    worktree: "/tmp/worktree",
    agent: null,
    status: "running",
    currentPhase: "implement",
    currentSession: null,
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

describe("getStatusSessionLine", () => {
  it("prefers currentSession for running tickets", () => {
    const ticket = makeTicket({
      currentSession: { id: "live-session", provider: "codex" },
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          session: { id: "persisted-session", provider: "claude" },
        },
      ],
    });

    expect(getStatusSessionLine(ticket)).toBe("codex:live-session (implement)");
  });

  it("falls back to the latest phase history session when not running", () => {
    const ticket = makeTicket({
      status: "complete",
      currentPhase: "verify",
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          session: { id: "old-session", provider: "claude" },
        },
        {
          phase: "verify",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          session: { id: "latest-session", provider: "codex" },
        },
      ],
    });

    expect(getStatusSessionLine(ticket)).toBe("codex:latest-session (verify)");
  });

  it("returns null when no structured session exists", () => {
    expect(getStatusSessionLine(makeTicket())).toBeNull();
  });
});
