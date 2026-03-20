import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as shell from "../utils/shell.js";
import {
  buildAgentArgs,
  invokeAgent,
  parseClaudeJsonOutput,
} from "./invoke.js";

describe("buildAgentArgs", () => {
  it("builds args for claude agent", () => {
    const result = buildAgentArgs(
      { command: "claude", defaultArgs: ["--verbose"] },
      { prompt: "fix the bug" },
    );

    expect(result.command).toBe("claude");
    expect(result.args).toEqual([
      "-p",
      "fix the bug",
      "--output-format",
      "json",
      "--verbose",
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
    expect(result.args).toEqual(["exec", "refactor code", "--quiet"]);
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

describe("parseClaudeJsonOutput", () => {
  it("extracts result and session_id from valid JSON", () => {
    const raw = JSON.stringify({
      result: "Hello world",
      session_id: "abc-123",
    });
    const parsed = parseClaudeJsonOutput(raw);
    expect(parsed.text).toBe("Hello world");
    expect(parsed.sessionId).toBe("abc-123");
  });

  it("extracts result without session_id", () => {
    const raw = JSON.stringify({ result: "Some output" });
    const parsed = parseClaudeJsonOutput(raw);
    expect(parsed.text).toBe("Some output");
    expect(parsed.sessionId).toBeUndefined();
  });

  it("falls back to raw string on invalid JSON", () => {
    const raw = "not valid json";
    const parsed = parseClaudeJsonOutput(raw);
    expect(parsed.text).toBe("not valid json");
    expect(parsed.sessionId).toBeUndefined();
  });

  it("falls back to raw string when result field is missing", () => {
    const raw = JSON.stringify({ session_id: "abc-123", other: "data" });
    const parsed = parseClaudeJsonOutput(raw);
    expect(parsed.text).toBe(raw);
    expect(parsed.sessionId).toBe("abc-123");
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
