import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "ink";
import { render } from "ink-testing-library";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhaseHistoryEntry, TicketState } from "../../core/types.js";
import type { LogEvent } from "../screens/TicketLogsScreen.helpers.js";
import { useSessionLogs } from "./useSessionLogs.js";

vi.mock("chokidar", () => {
  const mockWatcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
  };
  return { watch: vi.fn(() => mockWatcher) };
});

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { watch as chokidarWatch } from "chokidar";

const mockChokidarWatch = vi.mocked(chokidarWatch);
const mockReadFile = vi.mocked(readFile);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTicket({
  currentSession = null,
  phaseHistory = [],
  context = {},
  retries = {},
  error = null,
  ...overrides
}: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "T-1",
    title: "Fix the bug",
    description: "Short description.",
    acceptanceCriteria: [],
    linearUrl: null,
    repo: null,
    workflow: "standard",
    branch: "feat/fix-bug",
    worktree: "/tmp/wt",
    agent: null,
    status: "running",
    currentPhase: "implement",
    currentSessionId: null,
    ...overrides,
    currentSession,
    phaseHistory,
    context,
    retries,
    error,
  };
}

function makePhaseEntry(
  overrides: Partial<PhaseHistoryEntry> = {},
): PhaseHistoryEntry {
  return {
    phase: "implement",
    status: "success",
    startedAt: "2024-01-01T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

// ─── Test wrapper ─────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// biome-ignore lint/style/useComponentExportOnlyModules: test-only wrapper
function HookWrapper({
  ticket,
  onEvents,
  queryClient,
}: {
  ticket: TicketState;
  onEvents: (events: LogEvent[], count: number) => void;
  queryClient: QueryClient;
}): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <HookWrapperInner ticket={ticket} onEvents={onEvents} />
    </QueryClientProvider>
  );
}

// biome-ignore lint/style/useComponentExportOnlyModules: test-only wrapper
function HookWrapperInner({
  ticket,
  onEvents,
}: {
  ticket: TicketState;
  onEvents: (events: LogEvent[], count: number) => void;
}): React.ReactElement {
  const events = useSessionLogs(ticket);
  onEvents(events, events.length);
  return <Text>{events.length}</Text>;
}

// ─── useSessionLogs ───────────────────────────────────────────────────────────

describe("useSessionLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChokidarWatch.mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    } as unknown as ReturnType<typeof chokidarWatch>);
    mockReadFile.mockResolvedValue("");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns only phase-dividers synchronously before async load completes", () => {
    // readFile never resolves — simulates slow filesystem
    mockReadFile.mockReturnValue(new Promise(() => {}));

    const ticket = makeTicket({
      worktree: "/projects/foo",
      phaseHistory: [
        makePhaseEntry({ phase: "implement", sessionId: "sess1" }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    // Before async load: only phase-divider is emitted (derived synchronously)
    expect(captured[0]).toEqual([
      { type: "phase-divider", phase: "implement", sessionId: "sess1" },
    ]);

    unmount();
  });

  it("treats file-not-found as empty session (only divider emitted)", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const ticket = makeTicket({
      worktree: "/projects/foo",
      phaseHistory: [
        makePhaseEntry({ phase: "implement", sessionId: "sess1" }),
      ],
    });

    const captured: number[] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        queryClient={qc}
        onEvents={(_, count) => captured.push(count)}
      />,
    );

    // Wait for async effect to resolve (and fail gracefully)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After rejected read: still only the divider (empty events for the session)
    expect(captured[captured.length - 1]).toBe(1);
    unmount();
  });

  it("skips phaseHistory entries without sessionId", () => {
    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({ phase: "setup" }), // no sessionId
        makePhaseEntry({ phase: "implement", sessionId: "sess1" }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    const first = captured[0];
    const dividers = first.filter((e) => e.type === "phase-divider");
    expect(dividers).toHaveLength(1);
    expect(
      (dividers[0] as { type: "phase-divider"; phase: string }).phase,
    ).toBe("implement");

    unmount();
  });

  it("sets up chokidar watcher on session paths", () => {
    const ticket = makeTicket({
      worktree: "/projects/foo",
      phaseHistory: [
        makePhaseEntry({ phase: "implement", sessionId: "sess1" }),
      ],
    });

    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper ticket={ticket} queryClient={qc} onEvents={() => {}} />,
    );

    expect(mockChokidarWatch).toHaveBeenCalled();

    unmount();
  });

  it("returns empty array when phaseHistory has no sessionId entries", () => {
    const ticket = makeTicket({
      phaseHistory: [makePhaseEntry({ phase: "setup" })],
    });

    const captured: number[] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        queryClient={qc}
        onEvents={(_, count) => captured.push(count)}
      />,
    );

    expect(captured[0]).toBe(0);
    unmount();
  });

  it("parses session content after successful readFile", async () => {
    const jsonlLine = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    });
    mockReadFile.mockResolvedValue(jsonlLine);

    const ticket = makeTicket({
      worktree: "/projects/foo",
      phaseHistory: [
        makePhaseEntry({ phase: "implement", sessionId: "sess1" }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    // Wait for async effect
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After successful read: divider + assistant-text event
    const last = captured[captured.length - 1];
    expect(last).toContainEqual({
      type: "phase-divider",
      phase: "implement",
      sessionId: "sess1",
    });
    expect(last).toContainEqual({ type: "assistant-text", text: "Hello" });

    unmount();
  });
});
