import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketState } from "../../core/types.js";
import {
  buildLogLines,
  inlineInput,
  type LogEvent,
  parseNormalizedSessionJsonl,
} from "./TicketLogsScreen.helpers.js";
import { TicketLogsScreen } from "./TicketLogsScreen.js";

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
    ...overrides,
    currentSession,
    phaseHistory,
    context,
    retries,
    error,
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

const claudeSession = { id: "abc123", provider: "claude" as const };

// ─── parseNormalizedSessionJsonl ──────────────────────────────────────────────

describe("parseNormalizedSessionJsonl", () => {
  it("returns empty array for empty string", () => {
    expect(parseNormalizedSessionJsonl("")).toEqual([]);
  });

  it("extracts assistant-text events", () => {
    const line = makeNormalizedLine("assistant-text", { text: "Hello world" });
    expect(parseNormalizedSessionJsonl(line)).toEqual([
      { type: "assistant-text", text: "Hello world" },
    ]);
  });

  it("extracts tool-use events with toolName mapped to name", () => {
    const line = makeNormalizedLine("tool-use", {
      callId: "c1",
      toolName: "Read",
      input: { file_path: "/foo.ts" },
    });
    expect(parseNormalizedSessionJsonl(line)).toEqual([
      { type: "tool-use", name: "Read", input: { file_path: "/foo.ts" } },
    ]);
  });

  it("extracts tool-result events", () => {
    const line = makeNormalizedLine("tool-result", {
      callId: "c1",
      toolName: "Read",
      result: "file contents",
      isError: false,
    });
    expect(parseNormalizedSessionJsonl(line)).toEqual([
      { type: "tool-result", callId: "c1", name: "Read", isError: false },
    ]);
  });

  it("defaults tool-result isError to false when absent", () => {
    const line = makeNormalizedLine("tool-result", {
      callId: "c2",
      toolName: "Write",
      result: null,
    });
    const events = parseNormalizedSessionJsonl(line);
    expect(events[0]).toMatchObject({ type: "tool-result", isError: false });
  });

  it("captures tool-result isError: true", () => {
    const line = makeNormalizedLine("tool-result", {
      callId: "c3",
      toolName: "Bash",
      result: "error message",
      isError: true,
    });
    const events = parseNormalizedSessionJsonl(line);
    expect(events[0]).toMatchObject({ type: "tool-result", isError: true });
  });

  it("skips session-start and warning lines", () => {
    const lines = [
      makeNormalizedLine("session-start", {
        planId: "p1",
        ticketId: "T-1",
        session: { id: "s1", provider: "claude" },
      }),
      makeNormalizedLine("warning", { message: "something odd" }),
      makeNormalizedLine("assistant-text", { text: "Done" }),
    ].join("\n");
    const events = parseNormalizedSessionJsonl(lines);
    expect(events).toEqual([{ type: "assistant-text", text: "Done" }]);
  });

  it("skips malformed JSON lines without throwing", () => {
    const content = [
      "{not valid json",
      makeNormalizedLine("assistant-text", { text: "ok" }),
      "also bad}",
    ].join("\n");
    expect(() => parseNormalizedSessionJsonl(content)).not.toThrow();
    expect(parseNormalizedSessionJsonl(content)).toEqual([
      { type: "assistant-text", text: "ok" },
    ]);
  });

  it("skips empty lines", () => {
    const line = makeNormalizedLine("assistant-text", { text: "hi" });
    const events = parseNormalizedSessionJsonl(`\n\n${line}\n\n`);
    expect(events).toHaveLength(1);
  });

  it("handles multiple events in document order", () => {
    const content = [
      makeNormalizedLine("assistant-text", { text: "first" }),
      makeNormalizedLine("tool-use", {
        callId: "c1",
        toolName: "Write",
        input: { file_path: "/a.ts" },
      }),
      makeNormalizedLine("tool-result", {
        callId: "c1",
        toolName: "Write",
        result: null,
        isError: false,
      }),
    ].join("\n");
    const events = parseNormalizedSessionJsonl(content);
    expect(events).toEqual([
      { type: "assistant-text", text: "first" },
      { type: "tool-use", name: "Write", input: { file_path: "/a.ts" } },
      { type: "tool-result", callId: "c1", name: "Write", isError: false },
    ]);
  });
});

// ─── buildLogLines — derived dividers ────────────────────────────────────────

describe("buildLogLines", () => {
  it("returns empty array for no events", () => {
    expect(buildLogLines([], 80)).toEqual([]);
  });

  it("renders phase-divider as divider + blank", () => {
    const events: LogEvent[] = [
      { type: "phase-divider", phase: "implement", session: claudeSession },
    ];
    const lines = buildLogLines(events, 80);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      type: "divider",
      phase: "implement",
      session: claudeSession,
    });
    expect(lines[1]).toEqual({ type: "blank" });
  });

  it("derives dividers per session at render time (not from persisted events)", () => {
    const session1 = { id: "s1", provider: "claude" as const };
    const session2 = { id: "s2", provider: "codex" as const };
    const events: LogEvent[] = [
      { type: "phase-divider", phase: "implement", session: session1 },
      { type: "assistant-text", text: "hello" },
      { type: "phase-divider", phase: "verify", session: session2 },
      { type: "assistant-text", text: "done" },
    ];
    const lines = buildLogLines(events, 80);
    const dividers = lines.filter((l) => l.type === "divider");
    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toMatchObject({ phase: "implement" });
    expect(dividers[1]).toMatchObject({ phase: "verify" });
  });

  it("word-wraps assistant-text to width", () => {
    const longText = "one two three four five six seven eight nine ten";
    const events: LogEvent[] = [{ type: "assistant-text", text: longText }];
    const lines = buildLogLines(events, 20);
    const textLines = lines.filter((l) => l.type === "text");
    expect(textLines.length).toBeGreaterThan(1);
    for (const l of textLines) {
      expect(
        (l as { type: "text"; text: string }).text.length,
      ).toBeLessThanOrEqual(20);
    }
  });

  it("adds blank after assistant-text block", () => {
    const events: LogEvent[] = [{ type: "assistant-text", text: "hello" }];
    const lines = buildLogLines(events, 80);
    const last = lines[lines.length - 1];
    expect(last).toEqual({ type: "blank" });
  });

  it("renders tool-use as tool + blank", () => {
    const events: LogEvent[] = [
      { type: "tool-use", name: "Read", input: { file_path: "/foo.ts" } },
    ];
    const lines = buildLogLines(events, 80);
    expect(lines).toHaveLength(2);
    expect(lines[0].type).toBe("tool");
    expect(
      (lines[0] as { type: "tool"; name: string; summary: string }).name,
    ).toBe("Read");
    expect(
      (lines[0] as { type: "tool"; name: string; summary: string }).summary,
    ).toContain("file_path=/foo.ts");
    expect(lines[1]).toEqual({ type: "blank" });
  });

  it("uses command= for input with command field", () => {
    const events: LogEvent[] = [
      { type: "tool-use", name: "Bash", input: { command: "ls -la" } },
    ];
    const lines = buildLogLines(events, 80);
    const toolLine = lines[0] as {
      type: "tool";
      name: string;
      summary: string;
    };
    expect(toolLine.summary).toContain("command=ls -la");
  });

  it("uses pattern= for input with pattern field", () => {
    const events: LogEvent[] = [
      { type: "tool-use", name: "Grep", input: { pattern: "foo.*bar" } },
    ];
    const lines = buildLogLines(events, 80);
    const toolLine = lines[0] as {
      type: "tool";
      name: string;
      summary: string;
    };
    expect(toolLine.summary).toContain("pattern=foo.*bar");
  });

  it("truncates long inlineInput to fit within width", () => {
    const longPath = "/very/long/path/that/exceeds/max/length/for/display.ts";
    const events: LogEvent[] = [
      { type: "tool-use", name: "Read", input: { file_path: longPath } },
    ];
    const lines = buildLogLines(events, 30);
    const toolLine = lines[0] as {
      type: "tool";
      name: string;
      summary: string;
    };
    // summary maxLen = 30 - "Read".length - 4 = 22
    expect(toolLine.summary.length).toBeLessThanOrEqual(22);
    if (toolLine.summary.length === 22) {
      expect(toolLine.summary.endsWith("…")).toBe(true);
    }
  });

  it("emits blank line for blank paragraphs in assistant text", () => {
    const events: LogEvent[] = [
      { type: "assistant-text", text: "para one\n\npara two" },
    ];
    const lines = buildLogLines(events, 80);
    const blankLines = lines.filter((l) => l.type === "blank");
    // One blank from the empty line between paragraphs + one trailing blank
    expect(blankLines.length).toBeGreaterThanOrEqual(2);
  });

  it("renders tool-result as tool-result line + blank", () => {
    const events: LogEvent[] = [
      {
        type: "tool-result",
        callId: "c1",
        name: "Read",
        isError: false,
      },
    ];
    const lines = buildLogLines(events, 80);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      type: "tool-result",
      name: "Read",
      isError: false,
    });
    expect(lines[1]).toEqual({ type: "blank" });
  });

  it("preserves isError: true on tool-result lines", () => {
    const events: LogEvent[] = [
      { type: "tool-result", callId: "c1", name: "Bash", isError: true },
    ];
    const lines = buildLogLines(events, 80);
    expect(lines[0]).toMatchObject({ type: "tool-result", isError: true });
  });
});

// ─── inlineInput ──────────────────────────────────────────────────────────────

describe("inlineInput", () => {
  it("shows file_path= when present", () => {
    expect(inlineInput({ file_path: "/foo.ts" }, 100)).toBe(
      "file_path=/foo.ts",
    );
  });

  it("shows command= when present", () => {
    expect(inlineInput({ command: "ls" }, 100)).toBe("command=ls");
  });

  it("shows pattern= when present", () => {
    expect(inlineInput({ pattern: "\\w+" }, 100)).toBe("pattern=\\w+");
  });

  it("falls back to JSON for unknown fields", () => {
    const result = inlineInput({ foo: "bar" }, 100);
    expect(result).toContain("foo");
  });

  it("truncates to maxLen with ellipsis", () => {
    const result = inlineInput({ file_path: "a".repeat(50) }, 10);
    expect(result.length).toBe(10);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not truncate when within maxLen", () => {
    const result = inlineInput({ file_path: "short.ts" }, 100);
    expect(result).toBe("file_path=short.ts");
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

// ─── TicketLogsScreen render ──────────────────────────────────────────────────

// Mock useSessionLogs to control events without hitting the filesystem
vi.mock("../hooks/useSessionLogs.js", () => ({
  useSessionLogs: vi.fn(),
}));

import { useSessionLogs } from "../hooks/useSessionLogs.js";

const mockUseSessionLogs = vi.mocked(useSessionLogs);

function renderLogsScreen(
  props: {
    ticket?: TicketState;
    height?: number;
    width?: number;
    stateDir?: string;
  } = {},
) {
  const ticket = props.ticket ?? makeTicket();
  const height = props.height ?? 30;
  const width = props.width ?? 80;
  const stateDir = props.stateDir ?? "/state";
  const element = (
    <TicketLogsScreen
      ticket={ticket}
      height={height}
      width={width}
      stateDir={stateDir}
    />
  );
  return render(element);
}

describe("TicketLogsScreen", () => {
  beforeEach(() => {
    mockUseSessionLogs.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders divider line for phase-divider event", () => {
    const events: LogEvent[] = [
      {
        type: "phase-divider",
        phase: "implement",
        session: { id: "abcdef12", provider: "claude" },
      },
    ];
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 20 });
    const frame = lastFrame() ?? "";

    expect(frame).toContain("implement");
    expect(frame).toContain("claude:abcdef12".slice(0, 15));
    unmount();
  });

  it("renders assistant-text events", () => {
    const events: LogEvent[] = [
      { type: "assistant-text", text: "Hello from the assistant" },
    ];
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 20 });
    expect(lastFrame()).toContain("Hello from the assistant");
    unmount();
  });

  it("renders tool-use events", () => {
    const events: LogEvent[] = [
      { type: "tool-use", name: "Read", input: { file_path: "/src/foo.ts" } },
    ];
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 20 });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Read");
    expect(frame).toContain("file_path=/src/foo.ts");
    unmount();
  });

  it("renders tool-result events with success indicator", () => {
    const events: LogEvent[] = [
      {
        type: "tool-result",
        callId: "c1",
        name: "Read",
        isError: false,
      },
    ];
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 20 });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓");
    expect(frame).toContain("Read");
    unmount();
  });

  it("renders tool-result events with error indicator", () => {
    const events: LogEvent[] = [
      {
        type: "tool-result",
        callId: "c1",
        name: "Bash",
        isError: true,
      },
    ];
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 20 });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("✗");
    expect(frame).toContain("Bash");
    unmount();
  });

  it("overflow indicator appears when totalLines > height", () => {
    const events: LogEvent[] = Array.from({ length: 20 }, (_, i) => ({
      type: "assistant-text" as const,
      text: `Line ${i}`,
    }));
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 5 });
    expect(lastFrame()).toContain("↑↓");
    unmount();
  });

  it("overflow indicator absent when content fits", () => {
    const events: LogEvent[] = [{ type: "assistant-text", text: "Short text" }];
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 30 });
    expect(lastFrame()).not.toContain("↑↓");
    unmount();
  });

  it("renders empty state placeholder when no events", () => {
    mockUseSessionLogs.mockReturnValue([]);

    const { lastFrame, unmount } = renderLogsScreen({ height: 10 });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No session logs yet.");
    expect(frame).not.toContain("↑↓");
    unmount();
  });

  it("renders empty state when ticket has no identified sessions", () => {
    const ticket = makeTicket({
      currentSession: null,
      phaseHistory: [],
    });
    mockUseSessionLogs.mockReturnValue([]);

    const { lastFrame, unmount } = renderLogsScreen({ ticket, height: 10 });
    expect(lastFrame()).toContain("No session logs yet.");
    unmount();
  });
});
