import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketState } from "../core/types.js";
import { register } from "./sessions.js";

vi.mock("../agents/interactive.js", () => ({
  spawnInteractive: vi.fn(),
}));

vi.mock("../core/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../core/state.js", () => ({
  createStateManager: vi.fn(),
}));

import { spawnInteractive } from "../agents/interactive.js";
import { loadConfig } from "../core/config.js";
import { createStateManager } from "../core/state.js";

const mockSpawnInteractive = vi.mocked(spawnInteractive);
const mockLoadConfig = vi.mocked(loadConfig);
const mockCreateStateManager = vi.mocked(createStateManager);

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "SESS-05",
    title: "Clean up session consumers",
    description: "",
    acceptanceCriteria: [],
    linearUrl: "https://linear.app/acme/issue/SESS-05",
    repo: null,
    workflow: "standard",
    branch: "antonio/sess-05-session-consumer-cleanup",
    worktree: "/tmp/worktree",
    agent: null,
    status: "running",
    currentPhase: "implement",
    currentSession: null,
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

function makeProgram() {
  const program = new Command();
  register(program, () => ({ packageDir: "/tmp/package" }));
  return program;
}

describe("sessions command", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  beforeEach(() => {
    process.exitCode = undefined;
    mockLoadConfig.mockResolvedValue({ stateDir: "/tmp/state" } as never);
    mockCreateStateManager.mockReturnValue({
      getTicket: vi.fn(),
    } as never);
    mockSpawnInteractive.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("emits structured session objects in JSON output", async () => {
    const ticket = makeTicket({
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: "2026-04-23T00:00:00Z",
          completedAt: "2026-04-23T00:05:00Z",
          session: { id: "claude-1", provider: "claude" },
        },
      ],
    });

    mockCreateStateManager.mockReturnValue({
      getTicket: vi.fn().mockResolvedValue(ticket),
    } as never);

    const program = makeProgram();
    await program.parseAsync(
      ["node", "test", "sessions", "plan-1", "SESS-05", "--json"],
      { from: "node" },
    );

    const json = JSON.parse(
      consoleLogSpy.mock.calls[0]?.[0] as string,
    ) as Array<Record<string, unknown>>;
    expect(json).toEqual([
      {
        phase: "implement",
        status: "success",
        startedAt: "2026-04-23T00:00:00Z",
        completedAt: "2026-04-23T00:05:00Z",
        session: { id: "claude-1", provider: "claude" },
      },
    ]);
    expect(json[0]).not.toHaveProperty("sessionId");
  });

  it("resumes the most recent Claude session when no session id is provided", async () => {
    const ticket = makeTicket({
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: "2026-04-23T00:00:00Z",
          completedAt: "2026-04-23T00:05:00Z",
          session: { id: "codex-1", provider: "codex" },
        },
        {
          phase: "self-review",
          status: "success",
          startedAt: "2026-04-23T00:06:00Z",
          completedAt: "2026-04-23T00:10:00Z",
          session: { id: "claude-2", provider: "claude" },
        },
      ],
    });

    mockCreateStateManager.mockReturnValue({
      getTicket: vi.fn().mockResolvedValue(ticket),
    } as never);

    const program = makeProgram();
    await program.parseAsync(
      ["node", "test", "resume-session", "plan-1", "SESS-05"],
      { from: "node" },
    );

    expect(mockSpawnInteractive).toHaveBeenCalledWith({
      command: "claude",
      args: ["--resume", "claude-2"],
      cwd: "/tmp/worktree",
    });
  });

  it("fails clearly when a ticket has no Claude sessions to resume", async () => {
    const ticket = makeTicket({
      phaseHistory: [
        {
          phase: "implement",
          status: "success",
          startedAt: "2026-04-23T00:00:00Z",
          completedAt: "2026-04-23T00:05:00Z",
          session: { id: "codex-1", provider: "codex" },
        },
      ],
    });

    mockCreateStateManager.mockReturnValue({
      getTicket: vi.fn().mockResolvedValue(ticket),
    } as never);

    const program = makeProgram();
    await program.parseAsync(
      ["node", "test", "resume-session", "plan-1", "SESS-05"],
      { from: "node" },
    );

    expect(mockSpawnInteractive).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
