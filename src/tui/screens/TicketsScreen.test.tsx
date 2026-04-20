import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "ink-testing-library";
import type React from "react";
import { describe, expect, it } from "vitest";
import type { PlanFile, TicketState } from "../../core/types.js";
import { queryClient } from "../queries/query-client.js";
import { getLatestSessionId, TicketsScreen } from "./TicketsScreen.js";

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

function renderWithQuery(element: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

describe("TicketsScreen", () => {
  it("renders ticket table with correct column headers", () => {
    const plan = makePlan();
    const tickets = [makeTicket()];

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

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

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

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

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

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

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

    const frame = lastFrame();
    expect(frame).toContain("2");
    unmount();
  });

  it("shows dash for retry when count is 0", () => {
    const plan = makePlan();
    const tickets = [makeTicket({ retries: {} })];

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

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

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

    const frame = lastFrame();
    expect(frame).toContain("T-1");
    expect(frame).toContain("T-2");
    unmount();
  });

  it("shows empty state when no tickets", () => {
    const plan = makePlan({ tickets: [] });

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={[]} />,
    );

    expect(lastFrame()).toContain("No tickets found");
    unmount();
  });

  it("renders SESSION column header", () => {
    const plan = makePlan();
    const tickets = [makeTicket()];

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

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
    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

    expect(lastFrame()).toContain("abc123defg…");
    unmount();
  });

  it("shows dash dimmed when no session ID", () => {
    const plan = makePlan();
    const tickets = [makeTicket({ phaseHistory: [] })];

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

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
    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

    expect(lastFrame()).toContain("abc123");
    expect(lastFrame()).not.toContain("…");
    unmount();
  });

  it("falls back to raw phase ID for unknown phases", () => {
    const plan = makePlan();
    const tickets = [makeTicket({ currentPhase: "unknown_phase" as never })];

    const { lastFrame, unmount } = renderWithQuery(
      <TicketsScreen plan={plan} tickets={tickets} height={10} />,
    );

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
});
