import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "ink-testing-library";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { StateManager } from "../../core/state.js";
import type {
  PlanFile,
  TicketState,
  WorkflowDefinition,
} from "../../core/types.js";
import { queryClient } from "../queries/query-client.js";
import {
  computeSkipUpdate,
  getLatestSessionId,
  TicketsScreen,
} from "./TicketsScreen.js";

function makePlan(overrides: Partial<PlanFile> = {}): PlanFile {
  return {
    id: "plan-1",
    name: "test-plan",
    createdAt: new Date().toISOString(),
    createdBy: "user",
    repo: null,
    workflow: "standard",
    agent: null,
    worktreeRoot: "/tmp",
    status: "active",
    tickets: [
      { ticketId: "T-1", order: 1, blockedBy: [] },
      { ticketId: "T-2", order: 2, blockedBy: ["T-1"] },
    ],
    ...overrides,
  };
}

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "T-1",
    title: "Task one",
    description: "",
    acceptanceCriteria: [],
    linearUrl: null,
    repo: null,
    workflow: "standard",
    branch: "feat/test",
    worktree: "/tmp/wt",
    agent: null,
    status: "running",
    currentPhase: "implement",
    currentSessionId: null,
    phaseHistory: [
      {
        phase: "implement",
        status: "success",
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    ],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

function makeWorkflow(
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    name: "standard",
    description: "",
    tags: [],
    phases: [
      {
        id: "implement",
        type: "agent",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "verify",
      },
      {
        id: "verify",
        type: "agent",
        args: [],
        maxRetries: 0,
        notify: false,
      },
    ],
    ...overrides,
  };
}

function makeStateManager(): StateManager {
  return {
    listPlans: vi.fn().mockResolvedValue([]),
    getPlan: vi.fn().mockResolvedValue(null),
    savePlan: vi.fn().mockResolvedValue(undefined),
    listTickets: vi.fn().mockResolvedValue([]),
    getTicket: vi.fn().mockResolvedValue(null),
    saveTicket: vi.fn().mockResolvedValue(undefined),
    updateTicket: vi.fn().mockResolvedValue({}),
    getReadyTickets: vi.fn().mockResolvedValue([]),
    getRunningCount: vi.fn().mockResolvedValue(0),
    resolveDependencies: vi.fn().mockResolvedValue(undefined),
    maybeMarkPlanComplete: vi.fn().mockResolvedValue(undefined),
  };
}

function renderTicketsScreen(
  props: Partial<React.ComponentProps<typeof TicketsScreen>> & {
    plan: PlanFile;
    tickets: TicketState[];
  },
) {
  const element = (
    <QueryClientProvider client={queryClient}>
      <TicketsScreen
        workflows={props.workflows ?? new Map()}
        stateManager={props.stateManager ?? makeStateManager()}
        height={props.height}
        plan={props.plan}
        tickets={props.tickets}
      />
    </QueryClientProvider>
  );
  return render(element);
}

describe("TicketsScreen", () => {
  it("renders ticket table with correct column headers", () => {
    const plan = makePlan();
    const tickets = [makeTicket()];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    const frame = lastFrame();
    expect(frame).toContain("TICKET");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("PHASE");
    expect(frame).toContain("RETRY");
    expect(frame).toContain("BLOCK");
    expect(frame).toContain("AGE");
    unmount();
  });

  it("renders ticket ID and status", () => {
    const plan = makePlan();
    const tickets = [makeTicket({ ticketId: "T-1", status: "running" })];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    const frame = lastFrame();
    expect(frame).toContain("T-1");
    expect(frame).toContain("running");
    unmount();
  });

  it("renders human-readable phase label", () => {
    const plan = makePlan();
    const tickets = [
      makeTicket({ ticketId: "T-1", currentPhase: "implement" }),
    ];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    const frame = lastFrame();
    expect(frame).toContain("implement");
    unmount();
  });

  it("shows retry count in yellow when > 0", () => {
    const plan = makePlan();
    const tickets = [
      makeTicket({
        ticketId: "T-1",
        currentPhase: "implement",
        retries: { implement: 2 },
      }),
    ];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    const frame = lastFrame();
    expect(frame).toContain("2");
    unmount();
  });

  it("shows dash for retry when count is 0", () => {
    const plan = makePlan();
    const tickets = [makeTicket({ retries: {} })];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    const frame = lastFrame();
    // The RETRY column should show a dash
    expect(frame).toContain("—");
    unmount();
  });

  it("shows blockedBy ticket ID in BLOCK column", () => {
    const plan = makePlan({
      tickets: [
        { ticketId: "T-1", order: 1, blockedBy: [] },
        { ticketId: "T-2", order: 2, blockedBy: ["T-1"] },
      ],
    });
    const tickets = [
      makeTicket({ ticketId: "T-1" }),
      makeTicket({ ticketId: "T-2", status: "queued" }),
    ];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    const frame = lastFrame();
    expect(frame).toContain("T-1");
    expect(frame).toContain("T-2");
    unmount();
  });

  it("shows empty state when no tickets", () => {
    const plan = makePlan({ tickets: [] });

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets: [],
    });

    expect(lastFrame()).toContain("No tickets found");
    unmount();
  });

  it("renders SESSION column header", () => {
    const plan = makePlan();
    const tickets = [makeTicket()];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    expect(lastFrame()).toContain("SESSION");
    unmount();
  });

  it("shows truncated session ID when longer than 10 chars", () => {
    const plan = makePlan();
    const tickets = [
      makeTicket({
        phaseHistory: [
          {
            phase: "implement",
            status: "success",
            startedAt: new Date().toISOString(),
            completedAt: null,
            sessionId: "abc123defghijklmnop",
          },
        ],
      }),
    ];
    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    expect(lastFrame()).toContain("abc123defg…");
    unmount();
  });

  it("shows dash dimmed when no session ID", () => {
    const plan = makePlan();
    const tickets = [makeTicket({ phaseHistory: [] })];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    expect(lastFrame()).toContain("—");
    unmount();
  });

  it("shows full session ID without truncation when <= 10 chars", () => {
    const plan = makePlan();
    const tickets = [
      makeTicket({
        phaseHistory: [
          {
            phase: "implement",
            status: "success",
            startedAt: new Date().toISOString(),
            completedAt: null,
            sessionId: "abc123",
          },
        ],
      }),
    ];
    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    expect(lastFrame()).toContain("abc123");
    expect(lastFrame()).not.toContain("…");
    unmount();
  });

  it("falls back to raw phase ID for unknown phases", () => {
    const plan = makePlan();
    const tickets = [makeTicket({ currentPhase: "unknown_phase" as never })];

    const { lastFrame, unmount } = renderTicketsScreen({
      plan,
      tickets,
      height: 10,
    });

    const frame = lastFrame();
    expect(frame).toContain("unknown_phase");
    unmount();
  });
});

describe("getLatestSessionId", () => {
  it("returns null when phaseHistory is empty", () => {
    const ticket = makeTicket({ phaseHistory: [] });
    expect(getLatestSessionId(ticket)).toBeNull();
  });

  it("returns null when no entry has a sessionId", () => {
    const ticket = makeTicket({
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
        },
      ],
    });
    expect(getLatestSessionId(ticket)).toBeNull();
  });

  it("returns the sessionId from the last entry that has one", () => {
    const ticket = makeTicket({
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          sessionId: "first",
        },
        {
          phase: "verify",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          sessionId: "last",
        },
      ],
    });
    expect(getLatestSessionId(ticket)).toBe("last");
  });

  it("skips entries without sessionId when finding the latest", () => {
    const ticket = makeTicket({
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          sessionId: "only",
        },
        {
          phase: "verify",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
        },
      ],
    });
    expect(getLatestSessionId(ticket)).toBe("only");
  });

  it("prefers currentSessionId over phaseHistory when ticket is running", () => {
    const ticket = makeTicket({
      status: "running",
      currentSessionId: "live-session",
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          sessionId: "old-session",
        },
      ],
    });
    expect(getLatestSessionId(ticket)).toBe("live-session");
  });

  it("falls back to phaseHistory when ticket is not running", () => {
    const ticket = makeTicket({
      status: "complete",
      currentSessionId: null,
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          sessionId: "history-session",
        },
      ],
    });
    expect(getLatestSessionId(ticket)).toBe("history-session");
  });

  it("falls back to phaseHistory when running but no currentSessionId is set", () => {
    const ticket = makeTicket({
      status: "running",
      currentSessionId: null,
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: new Date().toISOString(),
          completedAt: null,
          sessionId: "history-session",
        },
      ],
    });
    expect(getLatestSessionId(ticket)).toBe("history-session");
  });
});

describe("computeSkipUpdate", () => {
  it("returns next phase and ready status when current phase has onSuccess", () => {
    const ticket = makeTicket({ currentPhase: "implement" });
    const workflows = new Map([["standard", makeWorkflow()]]);

    expect(computeSkipUpdate(ticket, workflows)).toEqual({
      currentPhase: "verify",
      status: "ready",
    });
  });

  it("returns null when the current phase has no onSuccess (terminal)", () => {
    const ticket = makeTicket({ currentPhase: "verify" });
    const workflows = new Map([["standard", makeWorkflow()]]);

    expect(computeSkipUpdate(ticket, workflows)).toBeNull();
  });

  it("returns null when the workflow is not in the workflows map", () => {
    const ticket = makeTicket({ workflow: "missing" });
    const workflows = new Map([["standard", makeWorkflow()]]);

    expect(computeSkipUpdate(ticket, workflows)).toBeNull();
  });

  it("returns null when the phase id is not found in the workflow", () => {
    const ticket = makeTicket({ currentPhase: "nonexistent_phase" });
    const workflows = new Map([["standard", makeWorkflow()]]);

    expect(computeSkipUpdate(ticket, workflows)).toBeNull();
  });
});
