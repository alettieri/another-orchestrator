import os from "node:os";
import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketState } from "../../core/types.js";
import {
  buildLogLines,
  inlineInput,
  type LogEvent,
  parseSessionJsonl,
  resolveSessionPath,
} from "./TicketLogsScreen.helpers.js";
import { TicketLogsScreen } from "./TicketLogsScreen.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
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
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

// ─── resolveSessionPath ───────────────────────────────────────────────────────

describe("resolveSessionPath", () => {
  it("builds path under ~/.claude/projects", () => {
    const result = resolveSessionPath("/tmp/wt", "abc123");
    expect(result).toBe(
      `${os.homedir()}/.claude/projects/-tmp-wt/abc123.jsonl`,
    );
  });

  it("expands ~ to os.homedir()", () => {
    const result = resolveSessionPath("/any/path", "sess");
    expect(result.startsWith(os.homedir())).toBe(true);
  });

  it("converts slashes to dashes in worktree path", () => {
    const result = resolveSessionPath("/users/foo/bar", "sid");
    expect(result).toContain("-users-foo-bar");
  });

  it("appends sessionId with .jsonl extension", () => {
    const result = resolveSessionPath("/tmp", "my-session-id");
    expect(result.endsWith("/my-session-id.jsonl")).toBe(true);
  });
});

// ─── parseSessionJsonl ────────────────────────────────────────────────────────

describe("parseSessionJsonl", () => {
  it("returns empty array for empty string", () => {
    expect(parseSessionJsonl("")).toEqual([]);
  });

  it("extracts assistant-text events from assistant messages", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    });
    const events = parseSessionJsonl(line);
    expect(events).toEqual([{ type: "assistant-text", text: "Hello world" }]);
  });

  it("extracts tool-use events from assistant messages", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } },
        ],
      },
    });
    const events = parseSessionJsonl(line);
    expect(events).toEqual([
      { type: "tool-use", name: "Read", input: { file_path: "/foo.ts" } },
    ]);
  });

  it("skips non-assistant message types", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({ type: "system", content: "system prompt" }),
      JSON.stringify({ type: "result", output: "done" }),
    ].join("\n");
    expect(parseSessionJsonl(lines)).toEqual([]);
  });

  it("skips thinking and image blocks within assistant messages", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "let me think" },
          { type: "text", text: "answer" },
          { type: "image", source: {} },
        ],
      },
    });
    const events = parseSessionJsonl(line);
    expect(events).toEqual([{ type: "assistant-text", text: "answer" }]);
  });

  it("skips malformed JSON lines without throwing", () => {
    const content = [
      "{not valid json",
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "ok" }] },
      }),
      "also bad}",
    ].join("\n");
    expect(() => parseSessionJsonl(content)).not.toThrow();
    const events = parseSessionJsonl(content);
    expect(events).toEqual([{ type: "assistant-text", text: "ok" }]);
  });

  it("skips empty lines", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }] },
    });
    const content = `\n\n${line}\n\n`;
    const events = parseSessionJsonl(content);
    expect(events).toHaveLength(1);
  });

  it("handles multiple assistant messages in order", () => {
    const line1 = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "first" }] },
    });
    const line2 = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Write", input: { file_path: "/a.ts" } },
        ],
      },
    });
    const events = parseSessionJsonl(`${line1}\n${line2}`);
    expect(events).toEqual([
      { type: "assistant-text", text: "first" },
      { type: "tool-use", name: "Write", input: { file_path: "/a.ts" } },
    ]);
  });
});

// ─── buildLogLines ────────────────────────────────────────────────────────────

describe("buildLogLines", () => {
  it("returns empty array for no events", () => {
    expect(buildLogLines([], 80)).toEqual([]);
  });

  it("renders phase-divider as divider + blank", () => {
    const events: LogEvent[] = [
      { type: "phase-divider", phase: "implement", sessionId: "abc123" },
    ];
    const lines = buildLogLines(events, 80);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      type: "divider",
      phase: "implement",
      sessionId: "abc123",
    });
    expect(lines[1]).toEqual({ type: "blank" });
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
  props: { ticket?: TicketState; height?: number; width?: number } = {},
) {
  const ticket = props.ticket ?? makeTicket();
  const height = props.height ?? 30;
  const width = props.width ?? 80;
  const element = (
    <TicketLogsScreen ticket={ticket} height={height} width={width} />
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
      { type: "phase-divider", phase: "implement", sessionId: "abcdef12" },
    ];
    mockUseSessionLogs.mockReturnValue(events);

    const { lastFrame, unmount } = renderLogsScreen({ height: 20 });
    const frame = lastFrame() ?? "";

    expect(frame).toContain("implement");
    expect(frame).toContain("abcdef12".slice(0, 8));
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

  it("renders empty screen when no events", () => {
    mockUseSessionLogs.mockReturnValue([]);

    const { lastFrame, unmount } = renderLogsScreen({ height: 10 });
    expect(lastFrame()).not.toContain("↑↓");
    unmount();
  });
});
