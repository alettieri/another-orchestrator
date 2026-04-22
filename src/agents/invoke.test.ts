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
    const onSessionId = vi.fn();
    const parser = createClaudeStreamParser({ onSessionId });

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

    expect(parser.sessionId).toBe("abc-123");
    expect(parser.session).toEqual({
      provider: "claude",
      sessionId: "abc-123",
      threadId: null,
    });
    expect(onSessionId).toHaveBeenCalledTimes(1);
    expect(onSessionId).toHaveBeenCalledWith("abc-123");
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
    expect(parser.sessionId).toBeUndefined();
  });
});

describe("createCodexStreamParser", () => {
  it("extracts thread metadata and final assistant text", () => {
    const onSession = vi.fn();
    const onSessionId = vi.fn();
    const parser = createCodexStreamParser({ onSession, onSessionId });

    parser.feed(
      `${JSON.stringify({
        type: "thread.created",
        thread_id: "thread-123",
      })}\n`,
    );
    parser.feed(
      `${JSON.stringify({
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "final codex output" }],
            },
          ],
        },
      })}\n`,
    );
    parser.end();

    expect(parser.sessionId).toBe("thread-123");
    expect(parser.session).toEqual({
      provider: "codex",
      sessionId: null,
      threadId: "thread-123",
    });
    expect(parser.finalText).toBe("final codex output");
    expect(onSession).toHaveBeenCalledWith({
      provider: "codex",
      sessionId: null,
      threadId: "thread-123",
    });
    expect(onSessionId).toHaveBeenCalledWith("thread-123");
  });

  it("skips malformed lines without throwing", () => {
    const parser = createCodexStreamParser();

    expect(() => {
      parser.feed(
        'not json\n{"type":"thread.created","thread_id":"thread-1"}\n',
      );
      parser.end();
    }).not.toThrow();

    expect(parser.sessionId).toBe("thread-1");
  });

  it("handles chunked JSONL events", () => {
    const parser = createCodexStreamParser();

    parser.feed('{"type":"thread.created","th');
    parser.feed('read_id":"thread-2"}\n');
    parser.feed(
      '{"type":"assistant_message","message":{"role":"assistant","content":[{"type":"output_text","text":"ok"}]}}',
    );
    parser.end();

    expect(parser.sessionId).toBe("thread-2");
    expect(parser.finalText).toBe("ok");
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

      const onSessionId = vi.fn();
      const result = await invokeAgent(
        { command: "claude", defaultArgs: [] },
        { prompt: "Say Hello" },
        { onSessionId },
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("Hello");
      expect(result.sessionId).toBe("bfd2063e-f6d5-4bd4-b169-1d07477dcc9f");
      expect(result.session).toEqual({
        provider: "claude",
        sessionId: "bfd2063e-f6d5-4bd4-b169-1d07477dcc9f",
        threadId: null,
      });
      expect(onSessionId).toHaveBeenCalledTimes(1);
      expect(onSessionId).toHaveBeenCalledWith(
        "bfd2063e-f6d5-4bd4-b169-1d07477dcc9f",
      );
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

      const onSessionId = vi.fn();
      const result = await invokeAgent(
        { command: "claude", defaultArgs: [] },
        { prompt: "go" },
        { onSessionId },
      );

      expect(result.stdout).toBe("final text");
      expect(result.sessionId).toBe("session-xyz");
      expect(result.session).toEqual({
        provider: "claude",
        sessionId: "session-xyz",
        threadId: null,
      });
      expect(onSessionId).toHaveBeenCalledTimes(1);
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
      expect(result.sessionId).toBeUndefined();
    });
  });

  describe("codex json parsing", () => {
    let spy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
      spy?.mockRestore();
    });

    it("parses thread metadata and final assistant output from JSONL", async () => {
      const events = [
        JSON.stringify({
          type: "thread.created",
          thread_id: "thread-codex-1",
        }),
        JSON.stringify({
          type: "response.completed",
          response: {
            output: [
              {
                type: "message",
                role: "assistant",
                content: [
                  { type: "output_text", text: "Implemented the change" },
                ],
              },
            ],
          },
        }),
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

      const onSessionId = vi.fn();
      const result = await invokeAgent(
        { command: "codex", defaultArgs: ["--quiet"] },
        { prompt: "Implement the change" },
        { onSessionId },
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("Implemented the change");
      expect(result.sessionId).toBe("thread-codex-1");
      expect(result.session).toEqual({
        provider: "codex",
        sessionId: null,
        threadId: "thread-codex-1",
      });
      expect(onSessionId).toHaveBeenCalledWith("thread-codex-1");
      expect(spy).toHaveBeenCalledWith(
        "codex",
        ["exec", "--json", "Implement the change", "--quiet"],
        expect.any(Object),
      );
    });

    it("falls back to raw stdout when no final assistant event is emitted", async () => {
      const rawStream = `${JSON.stringify({
        type: "thread.created",
        thread_id: "thread-codex-2",
      })}\n`;

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

      expect(result.stdout).toBe(rawStream);
      expect(result.sessionId).toBe("thread-codex-2");
    });

    it("waits for async session persistence callbacks before resolving", async () => {
      const rawStream = `${JSON.stringify({
        type: "thread.created",
        thread_id: "thread-codex-3",
      })}\n`;
      let releaseCallback: (() => void) | undefined;

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

      let callbackCompleted = false;
      const resultPromise = invokeAgent(
        { command: "codex", defaultArgs: [] },
        { prompt: "noop" },
        {
          onSession: () =>
            new Promise<void>((resolve) => {
              releaseCallback = () => {
                callbackCompleted = true;
                resolve();
              };
            }),
        },
      );

      await Promise.resolve();
      expect(callbackCompleted).toBe(false);

      releaseCallback?.();
      const result = await resultPromise;

      expect(callbackCompleted).toBe(true);
      expect(result.sessionId).toBe("thread-codex-3");
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
