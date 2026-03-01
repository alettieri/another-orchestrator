import { describe, expect, it } from "vitest";
import { buildAgentArgs, invokeAgent } from "./invoke.js";

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
      "text",
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

  it("includes maxTurns for claude", () => {
    const result = buildAgentArgs(
      { command: "claude", defaultArgs: [] },
      { prompt: "do stuff", maxTurns: 5 },
    );

    expect(result.args).toContain("--max-turns");
    expect(result.args).toContain("5");
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
});
