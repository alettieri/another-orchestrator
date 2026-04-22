import { describe, expect, it } from "vitest";
import type { TicketState } from "../core/types.js";
import { getSessions, resolveSessionReference } from "./sessions.js";

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "T-1",
    title: "Test ticket",
    description: "desc",
    acceptanceCriteria: [],
    linearUrl: null,
    repo: "test-repo",
    workflow: "standard",
    branch: "feat/test",
    worktree: "/tmp/worktree",
    agent: null,
    status: "running",
    currentPhase: "implement",
    currentSessionId: null,
    currentSession: null,
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

describe("sessions helpers", () => {
  it("includes the live current session in the session list", () => {
    const ticket = makeTicket({
      currentSessionId: "thread-live-1",
      currentSession: {
        agent: "codex",
        provider: "codex",
        sessionId: null,
        threadId: "thread-live-1",
      },
    });

    expect(getSessions(ticket)).toEqual([
      {
        phase: "implement",
        status: "running",
        startedAt: "1970-01-01T00:00:00.000Z",
        completedAt: null,
        provider: "codex",
        sessionId: "thread-live-1",
      },
    ]);
  });

  it("does not duplicate the current session when it is already in history", () => {
    const ticket = makeTicket({
      currentSessionId: "thread-1",
      currentSession: {
        agent: "claude",
        provider: "claude",
        sessionId: "thread-1",
        threadId: null,
      },
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: "2025-01-01T00:00:00Z",
          completedAt: "2025-01-01T00:01:00Z",
          output: "done",
          sessionId: "thread-1",
          session: {
            agent: "claude",
            provider: "claude",
            sessionId: "thread-1",
            threadId: null,
          },
        },
      ],
    });

    expect(getSessions(ticket)).toHaveLength(1);
  });

  it("filters the live session by current phase", () => {
    const ticket = makeTicket({
      currentPhase: "verify",
      currentSessionId: "thread-live-2",
      currentSession: {
        agent: "codex",
        provider: "codex",
        sessionId: null,
        threadId: "thread-live-2",
      },
    });

    expect(getSessions(ticket, "implement")).toEqual([]);
    expect(getSessions(ticket, "verify")).toHaveLength(1);
  });

  it("resolves the provider from the live session when resuming explicitly", () => {
    const ticket = makeTicket({
      currentSessionId: "thread-codex-1",
      currentSession: {
        agent: "codex",
        provider: "codex",
        sessionId: null,
        threadId: "thread-codex-1",
      },
    });

    expect(resolveSessionReference(ticket, "thread-codex-1")).toEqual({
      provider: "codex",
      sessionId: "thread-codex-1",
    });
  });

  it("falls back to claude when a session id is unknown", () => {
    const ticket = makeTicket();

    expect(resolveSessionReference(ticket, "mystery-session")).toEqual({
      provider: "claude",
      sessionId: "mystery-session",
    });
  });
});
