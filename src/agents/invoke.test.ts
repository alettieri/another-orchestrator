import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as shell from "../utils/shell.js";
import {
  buildAgentArgs,
  createClaudeStreamParser,
  createCodexStreamParser,
  invokeAgent,
} from "./invoke.js";

describe("buildAgentArgs", () => {
  it("builds args for claude agent", () => {
    const result = buildAgentArgs(
      { command: "claude", defaultArgs: [] },
      { prompt: "fix the bug" },
    );

    expect(result.command).toBe("claude");
    expect(result.args).toEqual([
      "-p",
      "fix the bug",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("appends defaultArgs after stream-json flags for claude", () => {
    const result = buildAgentArgs(
      { command: "claude", defaultArgs: ["--model", "opus"] },
      { prompt: "hello" },
    );

    expect(result.args).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "opus",
    ]);
  });

  it("includes allowedTools for claude", () => {
    const result = buildAgentArgs(
      { command: "claude", defaultArgs: [] },
      { prompt: "do stuff", allowedTools: ["Read", "Write"] },
    );

    expect(result.args).toContain("--allowedTools");
    expect(result.args).toContain("Read");
    expect(result.args).toContain("Write");
  });

  it("builds args for codex agent", () => {
    const result = buildAgentArgs(
      { command: "codex", defaultArgs: ["--quiet"] },
      { prompt: "refactor code" },
    );

    expect(result.command).toBe("codex");
    expect(result.args).toEqual(["exec", "--json", "refactor code", "--quiet"]);
  });

  it("includes provider-specific MCP launch args for codex", () => {
    const result = buildAgentArgs(
      { command: "codex", defaultArgs: ["--quiet"] },
      {
        prompt: "refactor code",
        mcpLaunch: {
          servers: [],
          launchData: {
            args: ["-c", 'mcp_servers.linear.command="linear-mcp"'],
            artifactPaths: [],
          },
          warnings: [],
        },
      },
    );

    expect(result.args).toEqual([
      "-c",
      'mcp_servers.linear.command="linear-mcp"',
      "exec",
      "--json",
      "refactor code",
      "--quiet",
    ]);
  });

  it("includes provider-specific MCP launch args for claude", () => {
    const result = buildAgentArgs(
      { command: "claude", defaultArgs: ["--model", "opus"] },
      {
        prompt: "hello",
        mcpLaunch: {
          servers: [],
          launchData: {
            args: ["--mcp-config", "/repo/.claude/mcp.json"],
            artifactPaths: ["/repo/.claude/mcp.json"],
          },
          warnings: [],
        },
      },
    );

    expect(result.args).toEqual([
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "opus",
      "--mcp-config",
      "/repo/.claude/mcp.json",
    ]);
  });

  it("builds args for unknown agent", () => {
    const result = buildAgentArgs(
      { command: "my-agent", defaultArgs: ["--flag"] },
      { prompt: "hello" },
    );

    expect(result.command).toBe("my-agent");
    expect(result.args).toEqual(["hello", "--flag"]);
  });
});

describe("createClaudeStreamParser", () => {
  it("extracts session_id from the first system/init event and fires callback once", () => {
    const onSession = vi.fn();
    const parser = createClaudeStreamParser({ onSession });

    parser.feed(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc-123",
      })}\n`,
    );
    // A second init event must not fire the callback again.
    parser.feed(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "def-456",
      })}\n`,
    );
    parser.end();

    expect(parser.session).toEqual({ id: "abc-123", provider: "claude" });
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith({
      id: "abc-123",
      provider: "claude",
    });
  });

  it("extracts final text from the result event", () => {
    const parser = createClaudeStreamParser();

    parser.feed(
      `${JSON.stringify({
        type: "result",
        subtype: "success",
        result: "final output",
      })}\n`,
    );
    parser.end();

    expect(parser.finalText).toBe("final output");
  });

  it("skips malformed lines without throwing", () => {
    const parser = createClaudeStreamParser();

    expect(() => {
      parser.feed('not json\n{"type":"result","result":"ok"}\n');
      parser.end();
    }).not.toThrow();

    expect(parser.finalText).toBe("ok");
  });

  it("handles a JSON event split across two feed calls", () => {
    const parser = createClaudeStreamParser();

    parser.feed('{"type":"res');
    parser.feed('ult","result":"ok"}\n');
    parser.end();

    expect(parser.finalText).toBe("ok");
  });

  it("handles a trailing event without a newline via end()", () => {
    const parser = createClaudeStreamParser();

    parser.feed(`${JSON.stringify({ type: "result", result: "final" })}`);
    parser.end();

    expect(parser.finalText).toBe("final");
  });

  it("ignores non-object JSON values", () => {
    const parser = createClaudeStreamParser();
    parser.feed("42\n");
    parser.feed("null\n");
    parser.end();
    expect(parser.finalText).toBeUndefined();
    expect(parser.session).toBeUndefined();
  });

  it("emits normalized session log events only after session start", () => {
    const logEvents: unknown[] = [];
    const parser = createClaudeStreamParser({
      onSessionLogEvent: (event) => {
        logEvents.push(event);
      },
    });

    parser.feed(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "pre-session" }] },
      })}\n`,
    );

    parser.feed(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc-123",
      })}\n`,
    );

    parser.feed(
      `${JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello" },
            {
              type: "tool_use",
              id: "call_1",
              name: "Read",
              input: { file_path: "/foo.ts" },
            },
          ],
        },
      })}\n`,
    );

    parser.feed(
      `${JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: "ok",
              is_error: false,
            },
          ],
        },
      })}\n`,
    );

    parser.end();

    expect(logEvents).toEqual([
      { type: "session-start" },
      { type: "assistant-text", text: "Hello" },
      {
        type: "tool-use",
        callId: "call_1",
        toolName: "Read",
        input: { file_path: "/foo.ts" },
      },
      {
        type: "tool-result",
        callId: "call_1",
        toolName: "Read",
        result: "ok",
        isError: false,
      },
    ]);
  });
});

describe("createCodexStreamParser", () => {
  it("extracts thread_id from the first thread.started event and fires callback once", () => {
    const onSession = vi.fn();
    const parser = createCodexStreamParser({ onSession });

    parser.feed(
      `${JSON.stringify({
        type: "thread.started",
        thread_id: "codex-123",
      })}\n`,
    );
    parser.feed(
      `${JSON.stringify({
        type: "thread.started",
        thread_id: "codex-456",
      })}\n`,
    );
    parser.end();

    expect(parser.session).toEqual({ id: "codex-123", provider: "codex" });
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith({
      id: "codex-123",
      provider: "codex",
    });
  });

  it("extracts final text from an agent_message item.completed event", () => {
    const parser = createCodexStreamParser();

    parser.feed(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_1",
          type: "agent_message",
          text: "final output",
        },
      })}\n`,
    );
    parser.end();

    expect(parser.finalText).toBe("final output");
  });

  it("ignores malformed and unrelated JSONL lines without throwing", () => {
    const parser = createCodexStreamParser();

    expect(() => {
      parser.feed(
        'not json\n{"type":"turn.started"}\n{"type":"thread.started","thread_id":"ok"}\n',
      );
      parser.end();
    }).not.toThrow();

    expect(parser.session).toEqual({ id: "ok", provider: "codex" });
    expect(parser.finalText).toBeUndefined();
  });

  it("handles a JSON event split across two feed calls", () => {
    const parser = createCodexStreamParser();

    parser.feed('{"type":"thread.st');
    parser.feed('arted","thread_id":"codex-split"}\n');
    parser.end();

    expect(parser.session).toEqual({
      id: "codex-split",
      provider: "codex",
    });
  });

  it("handles a trailing event without a newline via end()", () => {
    const parser = createCodexStreamParser();

    parser.feed(
      `${JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "final" },
      })}`,
    );
    parser.end();

    expect(parser.finalText).toBe("final");
  });

  it("ignores non-object JSON values", () => {
    const parser = createCodexStreamParser();
    parser.feed("42\n");
    parser.feed("null\n");
    parser.end();
    expect(parser.finalText).toBeUndefined();
    expect(parser.session).toBeUndefined();
  });

  it("emits normalized session log events only after session start", () => {
    const logEvents: unknown[] = [];
    const parser = createCodexStreamParser({
      onSessionLogEvent: (event) => {
        logEvents.push(event);
      },
    });

    parser.feed(
      `${JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "pre-session" },
      })}\n`,
    );

    parser.feed(
      `${JSON.stringify({
        type: "thread.started",
        thread_id: "codex-123",
      })}\n`,
    );

    parser.feed(
      `${JSON.stringify({
        type: "item.started",
        item: {
          id: "cmd_1",
          type: "command_execution",
          command: "ls",
        },
      })}\n`,
    );

    parser.feed(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "cmd_1",
          type: "command_execution",
          exit_code: 0,
          stdout: "out",
          stderr: "",
        },
      })}\n`,
    );

    parser.feed(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_2",
          type: "agent_message",
          text: "Hello from Codex",
        },
      })}\n`,
    );

    parser.end();

    expect(logEvents).toEqual([
      { type: "session-start" },
      {
        type: "tool-use",
        callId: "cmd_1",
        toolName: "command_execution",
        input: "ls",
      },
      {
        type: "tool-result",
        callId: "cmd_1",
        toolName: "command_execution",
        result: {
          id: "cmd_1",
          type: "command_execution",
          exit_code: 0,
          stdout: "out",
          stderr: "",
        },
        isError: false,
      },
      { type: "assistant-text", text: "Hello from Codex" },
    ]);
  });
});

describe("invokeAgent", () => {
  it("invokes echo as a mock agent and returns success", async () => {
    const result = await invokeAgent(
      { command: "echo", defaultArgs: [] },
      { prompt: "hello world" },
    );

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
  });

  it("returns failure for non-zero exit code", async () => {
    const result = await invokeAgent(
      { command: "bash", defaultArgs: [] },
      { prompt: "-c exit 1" },
    );

    // bash -c "exit 1" won't work this way, but "bash" with prompt as first arg
    // will fail because the file doesn't exist
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("invokes onOutput callback with streamed data", async () => {
    const chunks: string[] = [];
    const result = await invokeAgent(
      { command: "echo", defaultArgs: [] },
      { prompt: "streamed output" },
      { onOutput: (chunk) => chunks.push(chunk) },
    );

    expect(result.success).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("").trim()).toBe("streamed output");
  });

  describe("claude stream-json parsing", () => {
    let spy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      spy?.mockRestore();
    });

    it("parses session_id and final text from NDJSON event stream", async () => {
      const events = [
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "bfd2063e-f6d5-4bd4-b169-1d07477dcc9f",
        }),
        JSON.stringify({ type: "rate_limit_event" }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Hello",
          duration_ms: 7892,
          total_cost_usd: 0.01,
        }),
      ];
      const rawStream = `${events.join("\n")}\n`;

      spy = vi
        .spyOn(shell, "execCommandStreaming")
        .mockImplementation((_cmd, _args, options) => {
          // Emit the full stream as a single chunk — the parser still handles
          // non-newline-aligned chunks because feed() buffers internally.
          options?.onStdout?.(rawStream);
          return Promise.resolve({
            stdout: rawStream,
            stderr: "",
            exitCode: 0,
          });
        });

      const onSession = vi.fn();
      const result = await invokeAgent(
        { command: "claude", defaultArgs: [] },
        { prompt: "Say Hello" },
        { onSession },
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("Hello");
      expect(result.session).toEqual({
        id: "bfd2063e-f6d5-4bd4-b169-1d07477dcc9f",
        provider: "claude",
      });
      expect(onSession).toHaveBeenCalledTimes(1);
      expect(onSession).toHaveBeenCalledWith({
        id: "bfd2063e-f6d5-4bd4-b169-1d07477dcc9f",
        provider: "claude",
      });
    });

    it("handles NDJSON events split across chunk boundaries", async () => {
      const initEvent = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session-xyz",
      });
      const resultEvent = JSON.stringify({
        type: "result",
        subtype: "success",
        result: "final text",
      });
      const raw = `${initEvent}\n${resultEvent}\n`;

      spy = vi
        .spyOn(shell, "execCommandStreaming")
        .mockImplementation((_cmd, _args, options) => {
          // Split mid-JSON to exercise the line buffer.
          const midpoint = Math.floor(raw.length / 2);
          options?.onStdout?.(raw.slice(0, midpoint));
          options?.onStdout?.(raw.slice(midpoint));
          return Promise.resolve({
            stdout: raw,
            stderr: "",
            exitCode: 0,
          });
        });

      const result = await invokeAgent(
        { command: "claude", defaultArgs: [] },
        { prompt: "go" },
      );

      expect(result.stdout).toBe("final text");
      expect(result.session).toEqual({
        id: "session-xyz",
        provider: "claude",
      });
    });

    it("falls back to raw stdout when no result event is emitted", async () => {
      spy = vi.spyOn(shell, "execCommandStreaming").mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const result = await invokeAgent(
        { command: "claude", defaultArgs: [] },
        { prompt: "noop" },
      );

      expect(result.stdout).toBe("");
      expect(result.session).toBeUndefined();
    });
  });

  describe("codex json parsing", () => {
    let spy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      spy?.mockRestore();
      warnSpy?.mockRestore();
    });

    it("parses thread_id and final text from the JSONL event stream", async () => {
      const events = [
        JSON.stringify({
          type: "thread.started",
          thread_id: "019dbbdd-c498-7490-98e6-b01dcd46b8bb",
        }),
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "agent_message",
            text: "Hello from Codex",
          },
        }),
        JSON.stringify({ type: "turn.completed" }),
      ];
      const rawStream = `${events.join("\n")}\n`;

      spy = vi
        .spyOn(shell, "execCommandStreaming")
        .mockImplementation((_cmd, _args, options) => {
          options?.onStdout?.(rawStream);
          return Promise.resolve({
            stdout: rawStream,
            stderr: "",
            exitCode: 0,
          });
        });

      const onSession = vi.fn();
      const result = await invokeAgent(
        { command: "codex", defaultArgs: [] },
        { prompt: "Say Hello" },
        { onSession },
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("Hello from Codex");
      expect(result.session).toEqual({
        id: "019dbbdd-c498-7490-98e6-b01dcd46b8bb",
        provider: "codex",
      });
      expect(onSession).toHaveBeenCalledTimes(1);
      expect(onSession).toHaveBeenCalledWith({
        id: "019dbbdd-c498-7490-98e6-b01dcd46b8bb",
        provider: "codex",
      });
    });

    it("ignores malformed and unrelated lines while capturing codex session", async () => {
      const rawStream = [
        "not json",
        JSON.stringify({ type: "turn.started" }),
        JSON.stringify({
          type: "thread.started",
          thread_id: "codex-session",
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "reasoning",
            text: "internal",
          },
        }),
      ].join("\n");

      spy = vi
        .spyOn(shell, "execCommandStreaming")
        .mockImplementation((_cmd, _args, options) => {
          options?.onStdout?.(`${rawStream}\n`);
          return Promise.resolve({
            stdout: `${rawStream}\n`,
            stderr: "",
            exitCode: 0,
          });
        });

      const result = await invokeAgent(
        { command: "codex", defaultArgs: [] },
        { prompt: "noop" },
      );

      expect(result.success).toBe(true);
      expect(result.session).toEqual({
        id: "codex-session",
        provider: "codex",
      });
      expect(result.stdout).toBe(`${rawStream}\n`);
    });

    it("warns and leaves session unset when codex exits successfully without thread_id", async () => {
      const rawStream = `${JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "done" },
      })}\n`;

      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      spy = vi
        .spyOn(shell, "execCommandStreaming")
        .mockImplementation((_cmd, _args, options) => {
          options?.onStdout?.(rawStream);
          return Promise.resolve({
            stdout: rawStream,
            stderr: "",
            exitCode: 0,
          });
        });

      const result = await invokeAgent(
        { command: "codex", defaultArgs: [] },
        { prompt: "noop" },
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("done");
      expect(result.session).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        "Codex completed successfully without emitting a thread_id",
      );
    });
  });

  describe("timeout handling", () => {
    let spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      spy = vi.spyOn(shell, "execCommandStreaming").mockResolvedValue({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      });
    });

    afterEach(() => {
      spy.mockRestore();
    });

    it("passes custom timeoutMs to execCommandStreaming", async () => {
      await invokeAgent(
        { command: "echo", defaultArgs: [] },
        { prompt: "hello", timeoutMs: 120000 },
      );

      expect(spy).toHaveBeenCalledWith(
        "echo",
        ["hello"],
        expect.objectContaining({ timeoutMs: 120000 }),
      );
    });

    it("uses DEFAULT_TIMEOUT_MS when timeoutMs is not provided", async () => {
      await invokeAgent(
        { command: "echo", defaultArgs: [] },
        { prompt: "hello" },
      );

      expect(spy).toHaveBeenCalledWith(
        "echo",
        ["hello"],
        expect.objectContaining({ timeoutMs: 60 * 60 * 1000 }),
      );
    });
  });
});
