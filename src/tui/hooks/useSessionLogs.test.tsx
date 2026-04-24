import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "ink";
import { render } from "ink-testing-library";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionLogPath } from "../../core/sessionLogs.js";
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

const STATE_DIR = "/state";

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

function makeNormalizedLine(type: string, extra: Record<string, unknown>) {
  return JSON.stringify({
    v: 1,
    timestamp: "2024-01-01T00:00:00Z",
    type,
    ...extra,
  });
}

// ─── Test wrapper ─────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

// biome-ignore lint/style/useComponentExportOnlyModules: test-only wrapper
function HookWrapper({
  ticket,
  stateDir,
  onEvents,
  queryClient,
}: {
  ticket: TicketState;
  stateDir: string;
  onEvents: (events: LogEvent[], count: number) => void;
  queryClient: QueryClient;
}): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <HookWrapperInner
        ticket={ticket}
        stateDir={stateDir}
        onEvents={onEvents}
      />
    </QueryClientProvider>
  );
}

// biome-ignore lint/style/useComponentExportOnlyModules: test-only wrapper
function HookWrapperInner({
  ticket,
  stateDir,
  onEvents,
}: {
  ticket: TicketState;
  stateDir: string;
  onEvents: (events: LogEvent[], count: number) => void;
}): React.ReactElement {
  const events = useSessionLogs(ticket, stateDir);
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

  // ── Discovery ──────────────────────────────────────────────────────────────

  it("reads from orchestrator-owned session log path derived from planId/ticketId/sessionId", async () => {
    mockReadFile.mockResolvedValue("");

    const ticket = makeTicket({
      planId: "plan-1",
      ticketId: "T-1",
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={() => {}}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const expectedPath = resolveSessionLogPath(
      STATE_DIR,
      "plan-1",
      "T-1",
      "sess1",
    );
    expect(mockReadFile).toHaveBeenCalledWith(expectedPath, "utf-8");
    unmount();
  });

  it("watches orchestrator-owned session file paths via chokidar", () => {
    const ticket = makeTicket({
      planId: "plan-1",
      ticketId: "T-1",
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={() => {}}
      />,
    );

    const expectedPath = resolveSessionLogPath(
      STATE_DIR,
      "plan-1",
      "T-1",
      "sess1",
    );
    expect(mockChokidarWatch).toHaveBeenCalledWith(
      expect.arrayContaining([expectedPath]),
      expect.anything(),
    );
    unmount();
  });

  // ── Provider-agnostic ──────────────────────────────────────────────────────

  it("emits dividers for all providers, not just claude", () => {
    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({ phase: "setup" }),
        makePhaseEntry({
          phase: "verify",
          session: { id: "codex-1", provider: "codex" },
        }),
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    const first = captured[0];
    const dividers = first.filter((e) => e.type === "phase-divider");
    expect(dividers).toHaveLength(2);
    const phases = dividers.map(
      (d) => (d as { type: "phase-divider"; phase: string }).phase,
    );
    expect(phases).toContain("verify");
    expect(phases).toContain("implement");
    unmount();
  });

  it("skips phaseHistory entries that have no session metadata", () => {
    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({ phase: "setup" }),
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
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

  // ── currentSession ─────────────────────────────────────────────────────────

  it("includes currentSession as a divider using currentPhase", () => {
    const ticket = makeTicket({
      currentPhase: "implement",
      currentSession: { id: "active-sess", provider: "claude" },
      phaseHistory: [],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    const first = captured[0];
    expect(first).toContainEqual({
      type: "phase-divider",
      phase: "implement",
      session: { id: "active-sess", provider: "claude" },
    });
    unmount();
  });

  it("does not duplicate currentSession if it already appears in phaseHistory", () => {
    const ticket = makeTicket({
      currentPhase: "implement",
      currentSession: { id: "sess1", provider: "claude" },
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    const dividers = captured[0].filter((e) => e.type === "phase-divider");
    expect(dividers).toHaveLength(1);
    unmount();
  });

  // ── Graceful handling ──────────────────────────────────────────────────────

  it("returns only phase-dividers synchronously before async load completes", () => {
    mockReadFile.mockReturnValue(new Promise(() => {}));

    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    expect(captured[0]).toEqual([
      {
        type: "phase-divider",
        phase: "implement",
        session: { id: "sess1", provider: "claude" },
      },
    ]);
    unmount();
  });

  it("treats missing file as empty session — only divider emitted", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: number[] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(_, count) => captured.push(count)}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(captured[captured.length - 1]).toBe(1);
    unmount();
  });

  it("treats empty file as empty session — only divider emitted", async () => {
    mockReadFile.mockResolvedValue("");

    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: number[] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(_, count) => captured.push(count)}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(captured[captured.length - 1]).toBe(1);
    unmount();
  });

  it("returns empty array when phaseHistory has no session entries and currentSession is null", () => {
    const ticket = makeTicket({
      currentSession: null,
      phaseHistory: [makePhaseEntry({ phase: "setup" })],
    });

    const captured: number[] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(_, count) => captured.push(count)}
      />,
    );

    expect(captured[0]).toBe(0);
    unmount();
  });

  // ── Normalized JSONL parsing ───────────────────────────────────────────────

  it("parses normalized assistant-text events from orchestrator JSONL", async () => {
    const content = makeNormalizedLine("assistant-text", { text: "Hello" });
    mockReadFile.mockResolvedValue(content);

    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const last = captured[captured.length - 1];
    expect(last).toContainEqual({
      type: "phase-divider",
      phase: "implement",
      session: { id: "sess1", provider: "claude" },
    });
    expect(last).toContainEqual({ type: "assistant-text", text: "Hello" });
    unmount();
  });

  it("parses normalized tool-use events from orchestrator JSONL", async () => {
    const content = makeNormalizedLine("tool-use", {
      callId: "call-1",
      toolName: "Read",
      input: { file_path: "/src/foo.ts" },
    });
    mockReadFile.mockResolvedValue(content);

    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const last = captured[captured.length - 1];
    expect(last).toContainEqual({
      type: "tool-use",
      name: "Read",
      input: { file_path: "/src/foo.ts" },
    });
    unmount();
  });

  it("skips session-start, tool-result, and warning lines silently", async () => {
    const lines = [
      makeNormalizedLine("session-start", {
        planId: "plan-1",
        ticketId: "T-1",
        session: { id: "sess1", provider: "claude" },
      }),
      makeNormalizedLine("tool-result", {
        callId: "c1",
        toolName: "Read",
        result: "content",
      }),
      makeNormalizedLine("warning", { message: "something odd" }),
      makeNormalizedLine("assistant-text", { text: "Done" }),
    ].join("\n");
    mockReadFile.mockResolvedValue(lines);

    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const last = captured[captured.length - 1];
    const nonDividers = last.filter((e) => e.type !== "phase-divider");
    expect(nonDividers).toHaveLength(1);
    expect(nonDividers[0]).toEqual({ type: "assistant-text", text: "Done" });
    unmount();
  });

  it("skips malformed JSON lines without throwing", async () => {
    const lines = [
      "{not valid json",
      makeNormalizedLine("assistant-text", { text: "ok" }),
      "also bad}",
    ].join("\n");
    mockReadFile.mockResolvedValue(lines);

    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const captured: LogEvent[][] = [];
    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={(evts) => captured.push([...evts])}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const last = captured[captured.length - 1];
    expect(last).toContainEqual({ type: "assistant-text", text: "ok" });
    unmount();
  });

  // ── Append watching ────────────────────────────────────────────────────────

  it("sets up chokidar watcher on session paths", () => {
    const ticket = makeTicket({
      phaseHistory: [
        makePhaseEntry({
          phase: "implement",
          session: { id: "sess1", provider: "claude" },
        }),
      ],
    });

    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={() => {}}
      />,
    );

    expect(mockChokidarWatch).toHaveBeenCalled();
    unmount();
  });

  it("does not set up a watcher when there are no session entries", () => {
    const ticket = makeTicket({ phaseHistory: [], currentSession: null });

    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir={STATE_DIR}
        queryClient={qc}
        onEvents={() => {}}
      />,
    );

    expect(mockChokidarWatch).not.toHaveBeenCalled();
    unmount();
  });

  it("watches the correct orchestrator path for a codex session", () => {
    const ticket = makeTicket({
      planId: "plan-2",
      ticketId: "T-99",
      phaseHistory: [
        makePhaseEntry({
          phase: "verify",
          session: { id: "codex-42", provider: "codex" },
        }),
      ],
    });

    const qc = makeQueryClient();
    const { unmount } = render(
      <HookWrapper
        ticket={ticket}
        stateDir="/custom-state"
        queryClient={qc}
        onEvents={() => {}}
      />,
    );

    const expectedPath = join(
      "/custom-state",
      "plans",
      "plan-2",
      "sessions",
      "T-99",
      "codex-42.jsonl",
    );
    expect(mockChokidarWatch).toHaveBeenCalledWith(
      expect.arrayContaining([expectedPath]),
      expect.anything(),
    );
    unmount();
  });
});
