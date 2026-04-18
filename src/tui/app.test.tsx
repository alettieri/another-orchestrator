import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { StateManager } from "../core/state.js";
import type { PlanFile, TicketState } from "../core/types.js";
import { App } from "./app.js";

function createMockStateManager(
  plans: PlanFile[] = [],
  ticketsByPlan: Map<string, TicketState[]> = new Map(),
): StateManager {
  return {
    listPlans: vi.fn().mockResolvedValue(plans),
    listTickets: vi
      .fn()
      .mockImplementation((planId: string) =>
        Promise.resolve(ticketsByPlan.get(planId) ?? []),
      ),
    getPlan: vi.fn().mockResolvedValue(null),
    savePlan: vi.fn().mockResolvedValue(undefined),
    getTicket: vi.fn().mockResolvedValue(null),
    saveTicket: vi.fn().mockResolvedValue(undefined),
    updateTicket: vi.fn().mockResolvedValue({}),
    getReadyTickets: vi.fn().mockResolvedValue([]),
    getRunningCount: vi.fn().mockResolvedValue(0),
    resolveDependencies: vi.fn().mockResolvedValue(undefined),
  } as StateManager;
}

// Wait for async query resolution
async function waitForQueries(): Promise<void> {
  await new Promise((r) => setTimeout(r, 100));
}

describe("App", () => {
  it("renders header with app name and live indicator", async () => {
    const sm = createMockStateManager();
    const { lastFrame, unmount } = render(
      <App stateManager={sm} stateDir="/tmp/fake-state" />,
    );
    await waitForQueries();
    const frame = lastFrame();
    expect(frame).toContain("orchestrator");
    expect(frame).toContain("live");
    unmount();
  });

  it("renders breadcrumb showing Plans", async () => {
    const sm = createMockStateManager();
    const { lastFrame, unmount } = render(
      <App stateManager={sm} stateDir="/tmp/fake-state" />,
    );
    await waitForQueries();
    expect(lastFrame()).toContain("Plans");
    unmount();
  });

  it("renders footer with hotkeys", async () => {
    const sm = createMockStateManager();
    const { lastFrame, unmount } = render(
      <App stateManager={sm} stateDir="/tmp/fake-state" />,
    );
    await waitForQueries();
    const frame = lastFrame();
    expect(frame).toContain("navigate");
    expect(frame).toContain("quit");
    unmount();
  });

  it("shows empty state when no plans exist", async () => {
    const sm = createMockStateManager();
    const { lastFrame, unmount } = render(
      <App stateManager={sm} stateDir="/tmp/fake-state" />,
    );
    await waitForQueries();
    expect(lastFrame()).toContain("No plans found");
    unmount();
  });

  it("renders plan rows with correct columns", async () => {
    const plans = [
      {
        id: "plan-1",
        name: "feature-auth",
        createdAt: new Date().toISOString(),
        createdBy: "user",
        repo: null,
        workflow: "standard",
        agent: null,
        worktreeRoot: "/tmp",
        status: "active" as const,
        tickets: [
          { ticketId: "T-1", order: 1, blockedBy: [] },
          { ticketId: "T-2", order: 2, blockedBy: [] },
        ],
      },
    ];
    const ticketsByPlan = new Map([
      [
        "plan-1",
        [
          {
            planId: "plan-1",
            ticketId: "T-1",
            title: "Auth login",
            description: "",
            acceptanceCriteria: [],
            linearUrl: null,
            repo: null,
            workflow: "standard",
            branch: "feat/auth",
            worktree: "/tmp/wt",
            agent: null,
            status: "complete" as const,
            currentPhase: "done",
            phaseHistory: [],
            context: {},
            retries: {},
            error: null,
          },
          {
            planId: "plan-1",
            ticketId: "T-2",
            title: "Auth signup",
            description: "",
            acceptanceCriteria: [],
            linearUrl: null,
            repo: null,
            workflow: "standard",
            branch: "feat/auth",
            worktree: "/tmp/wt",
            agent: null,
            status: "running" as const,
            currentPhase: "implement",
            phaseHistory: [],
            context: {},
            retries: {},
            error: null,
          },
        ],
      ],
    ]);

    const sm = createMockStateManager(plans, ticketsByPlan);
    const { lastFrame, unmount } = render(
      <App stateManager={sm} stateDir="/tmp/fake-state" />,
    );
    await waitForQueries();
    const frame = lastFrame();
    expect(frame).toContain("feature-auth");
    expect(frame).toContain("NAME");
    expect(frame).toContain("STATUS");
    expect(frame).toContain("PROGRESS");
    expect(frame).toContain("RUNNING");
    expect(frame).toContain("FAILED");
    expect(frame).toContain("AGE");
    // Progress should show 1/2
    expect(frame).toContain("1/2");
    unmount();
  });

  it("exits on q key", async () => {
    const sm = createMockStateManager();
    const { stdin, unmount } = render(
      <App stateManager={sm} stateDir="/tmp/fake-state" />,
    );
    await waitForQueries();
    stdin.write("q");
    // The app should have exited — unmount to clean up
    unmount();
  });

  it("displays plan and running counts in header", async () => {
    const plans = [
      {
        id: "plan-1",
        name: "test-plan",
        createdAt: new Date().toISOString(),
        createdBy: "user",
        repo: null,
        workflow: "standard",
        agent: null,
        worktreeRoot: "/tmp",
        status: "active" as const,
        tickets: [{ ticketId: "T-1", order: 1, blockedBy: [] }],
      },
    ];
    const ticketsByPlan = new Map([
      [
        "plan-1",
        [
          {
            planId: "plan-1",
            ticketId: "T-1",
            title: "task",
            description: "",
            acceptanceCriteria: [],
            linearUrl: null,
            repo: null,
            workflow: "standard",
            branch: "feat/test",
            worktree: "/tmp/wt",
            agent: null,
            status: "running" as const,
            currentPhase: "implement",
            phaseHistory: [],
            context: {},
            retries: {},
            error: null,
          },
        ],
      ],
    ]);

    const sm = createMockStateManager(plans, ticketsByPlan);
    const { lastFrame, unmount } = render(
      <App stateManager={sm} stateDir="/tmp/fake-state" />,
    );
    await waitForQueries();
    const frame = lastFrame();
    expect(frame).toContain("1 plans");
    expect(frame).toContain("1 running");
    unmount();
  });
});
