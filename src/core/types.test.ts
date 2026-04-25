import { describe, expect, it } from "vitest";
import {
  AgentConfigSchema,
  AgentSessionSchema,
  OrchestratorConfigSchema,
  PhaseHistoryEntrySchema,
  PlanFileSchema,
  RawOrchestratorConfigSchema,
  SessionLogEventSchema,
  SessionLogEventTypeSchema,
  SupportedAgentNameSchema,
  TicketStateSchema,
  TicketStatusSchema,
  WorkflowDefinitionSchema,
} from "./types.js";

const SESSION_ID = "cc807f8c-1234-5678-abcd-ef0123456789";
const PHASE_HISTORY_BASE = {
  phase: "implement",
  status: "success" as const,
  startedAt: "2025-01-01T00:00:00Z",
  completedAt: "2025-01-01T00:05:00Z",
};

describe("AgentConfigSchema", () => {
  it("parses a valid agent config", () => {
    const result = AgentConfigSchema.parse({
      command: "claude",
      defaultArgs: ["--verbose"],
    });
    expect(result.command).toBe("claude");
    expect(result.defaultArgs).toEqual(["--verbose"]);
  });

  it("rejects missing command", () => {
    expect(() => AgentConfigSchema.parse({ defaultArgs: [] })).toThrow();
  });

  it("rejects missing defaultArgs", () => {
    expect(() => AgentConfigSchema.parse({ command: "claude" })).toThrow();
  });
});

describe("SupportedAgentNameSchema", () => {
  it("accepts supported agent providers", () => {
    expect(SupportedAgentNameSchema.options).toEqual(["claude", "codex"]);
    expect(SupportedAgentNameSchema.parse("claude")).toBe("claude");
    expect(SupportedAgentNameSchema.parse("codex")).toBe("codex");
  });

  it("rejects unsupported agent providers", () => {
    expect(() => SupportedAgentNameSchema.parse("gemini")).toThrow();
  });
});

describe("RawOrchestratorConfigSchema", () => {
  it("accepts config with no directory fields", () => {
    const result = RawOrchestratorConfigSchema.parse({
      defaultAgent: "claude",
      agents: {
        claude: { command: "claude", defaultArgs: [] },
      },
    });
    expect(result.defaultAgent).toBe("claude");
    expect(result.stateDir).toBeUndefined();
    expect(result.logDir).toBeUndefined();
    expect(result.workflowDir).toBeUndefined();
    expect(result.promptDir).toBeUndefined();
    expect(result.scriptDir).toBeUndefined();
    expect(result.skillsDir).toBeUndefined();
  });

  it("accepts config with explicit directory fields", () => {
    const result = RawOrchestratorConfigSchema.parse({
      defaultAgent: "claude",
      agents: {
        claude: { command: "claude", defaultArgs: [] },
      },
      stateDir: "./state",
      logDir: "./logs",
      workflowDir: "./workflows",
      promptDir: "./prompts",
      scriptDir: "./scripts",
      skillsDir: "./skills",
    });
    expect(result.stateDir).toBe("./state");
    expect(result.skillsDir).toBe("./skills");
  });

  it("applies defaults for non-directory fields", () => {
    const result = RawOrchestratorConfigSchema.parse({
      defaultAgent: "claude",
      agents: {
        claude: { command: "claude", defaultArgs: [] },
      },
    });
    expect(result.pollInterval).toBe(10);
    expect(result.maxConcurrency).toBe(3);
    expect(result.ghCommand).toBe("gh");
  });
});

describe("OrchestratorConfigSchema", () => {
  const validConfig = {
    defaultAgent: "claude",
    agents: {
      claude: { command: "claude", defaultArgs: [] },
    },
    orchestratorHome: ".orchestrator",
    stateDir: ".state",
    logDir: ".logs",
    workflowDir: "workflows",
    workflowSearchPath: ["workflows"],
    promptDir: "prompts",
    promptSearchPath: ["prompts"],
    scriptDir: "scripts",
    skillsDir: "skills",
  };

  it("parses a valid config with defaults", () => {
    const result = OrchestratorConfigSchema.parse(validConfig);
    expect(result.pollInterval).toBe(10);
    expect(result.maxConcurrency).toBe(3);
    expect(result.ghCommand).toBe("gh");
    expect(result.skillsDir).toBe("skills");
  });

  it("allows overriding defaults", () => {
    const result = OrchestratorConfigSchema.parse({
      ...validConfig,
      pollInterval: 30,
      maxConcurrency: 5,
      ghCommand: "/usr/local/bin/gh",
    });
    expect(result.pollInterval).toBe(30);
    expect(result.maxConcurrency).toBe(5);
    expect(result.ghCommand).toBe("/usr/local/bin/gh");
  });

  it("rejects missing required fields", () => {
    expect(() =>
      OrchestratorConfigSchema.parse({ defaultAgent: "claude" }),
    ).toThrow();
  });

  it("rejects missing skillsDir", () => {
    const { skillsDir, ...withoutSkills } = validConfig;
    expect(() => OrchestratorConfigSchema.parse(withoutSkills)).toThrow();
  });

  it("rejects missing orchestratorHome", () => {
    const { orchestratorHome, ...withoutHome } = validConfig;
    expect(() => OrchestratorConfigSchema.parse(withoutHome)).toThrow();
  });
});

describe("TicketStatusSchema", () => {
  const validStatuses = [
    "queued",
    "ready",
    "running",
    "paused",
    "complete",
    "failed",
    "needs_attention",
  ] as const;

  for (const status of validStatuses) {
    it(`accepts "${status}"`, () => {
      expect(TicketStatusSchema.parse(status)).toBe(status);
    });
  }

  it("rejects an invalid status", () => {
    expect(() => TicketStatusSchema.parse("invalid")).toThrow();
  });
});

describe("AgentSessionSchema", () => {
  it("parses a valid agent session", () => {
    const result = AgentSessionSchema.parse({
      id: SESSION_ID,
      provider: "claude",
    });
    expect(result.id).toBe(SESSION_ID);
    expect(result.provider).toBe("claude");
  });

  it("rejects missing id", () => {
    expect(() => AgentSessionSchema.parse({})).toThrow();
  });

  it("rejects missing provider", () => {
    expect(() => AgentSessionSchema.parse({ id: SESSION_ID })).toThrow();
  });
});

describe("SessionLogEventTypeSchema", () => {
  for (const type of SessionLogEventTypeSchema.options) {
    it(`accepts "${type}"`, () => {
      expect(SessionLogEventTypeSchema.parse(type)).toBe(type);
    });
  }

  it("rejects an invalid type", () => {
    expect(() => SessionLogEventTypeSchema.parse("invalid")).toThrow();
  });
});

describe("PlanFileSchema", () => {
  const validPlan = {
    id: "plan-1",
    name: "Test Plan",
    createdAt: "2025-01-01T00:00:00Z",
    createdBy: "user",
    repo: "my-repo",
    workflow: "default",
    worktreeRoot: "/tmp/worktrees",
    status: "active",
    tickets: [{ ticketId: "ticket-1", order: 1 }],
  };

  it("parses a valid plan with defaults", () => {
    const result = PlanFileSchema.parse(validPlan);
    expect(result.agent).toBeNull();
    expect(result.tickets[0].blockedBy).toEqual([]);
  });

  it("accepts explicit agent and blockedBy", () => {
    const result = PlanFileSchema.parse({
      ...validPlan,
      agent: "claude",
      tickets: [{ ticketId: "ticket-1", order: 1, blockedBy: ["ticket-0"] }],
    });
    expect(result.agent).toBe("claude");
    expect(result.tickets[0].blockedBy).toEqual(["ticket-0"]);
  });

  it("rejects invalid status", () => {
    expect(() =>
      PlanFileSchema.parse({ ...validPlan, status: "invalid" }),
    ).toThrow();
  });

  it("defaults repo to null when omitted", () => {
    const { repo, ...withoutRepo } = validPlan;
    const result = PlanFileSchema.parse(withoutRepo);
    expect(result.repo).toBeNull();
  });

  it("accepts explicit null repo for multi-repo plans", () => {
    const result = PlanFileSchema.parse({ ...validPlan, repo: null });
    expect(result.repo).toBeNull();
  });

  it("accepts a string repo for single-repo plans", () => {
    const result = PlanFileSchema.parse(validPlan);
    expect(result.repo).toBe("my-repo");
  });
});

describe("PhaseHistoryEntrySchema", () => {
  it("parses entry without session", () => {
    const result = PhaseHistoryEntrySchema.parse(PHASE_HISTORY_BASE);
    expect(result.session).toBeUndefined();
  });

  it("parses entry with structured session", () => {
    const result = PhaseHistoryEntrySchema.parse({
      ...PHASE_HISTORY_BASE,
      session: {
        id: SESSION_ID,
        provider: "claude",
      },
    });
    expect(result.session).toEqual({
      id: SESSION_ID,
      provider: "claude",
    });
  });

  it("rejects legacy sessionId fields", () => {
    expect(() =>
      PhaseHistoryEntrySchema.parse({
        ...PHASE_HISTORY_BASE,
        sessionId: "legacy-session",
      }),
    ).toThrow();
  });
});

describe("TicketStateSchema", () => {
  const validTicket = {
    planId: "plan-1",
    ticketId: "ticket-1",
    title: "Test Ticket",
    description: "Do the thing",
    acceptanceCriteria: [],
    linearUrl: null,
    repo: "my-repo",
    workflow: "default",
    branch: "feature/ticket-1",
    worktree: "/tmp/worktrees/ticket-1",
    agent: null,
    status: "queued",
    currentPhase: "setup",
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
  };

  it("defaults currentSession to null when omitted", () => {
    const result = TicketStateSchema.parse(validTicket);
    expect(result.currentSession).toBeNull();
  });

  it("parses structured session state", () => {
    const result = TicketStateSchema.parse({
      ...validTicket,
      currentSession: {
        id: "structured-session",
        provider: "codex",
      },
      phaseHistory: [
        {
          ...PHASE_HISTORY_BASE,
          session: {
            id: "structured-phase-session",
            provider: "claude",
          },
        },
      ],
    });
    expect(result.currentSession).toEqual({
      id: "structured-session",
      provider: "codex",
    });
    expect(result.phaseHistory[0]?.session).toEqual({
      id: "structured-phase-session",
      provider: "claude",
    });
  });

  it("rejects legacy currentSessionId fields", () => {
    expect(() =>
      TicketStateSchema.parse({
        ...validTicket,
        currentSessionId: "legacy-session",
      }),
    ).toThrow();
  });
});

describe("WorkflowDefinitionSchema", () => {
  it("parses a minimal workflow", () => {
    const result = WorkflowDefinitionSchema.parse({
      name: "deploy",
      phases: [{ id: "build", type: "script", command: "npm run build" }],
    });
    expect(result.name).toBe("deploy");
    expect(result.description).toBe("");
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].args).toEqual([]);
    expect(result.phases[0].maxRetries).toBe(0);
    expect(result.phases[0].notify).toBe(false);
  });

  it("rejects a workflow with no phases", () => {
    expect(() =>
      WorkflowDefinitionSchema.parse({ name: "empty", phases: [] }),
    ).not.toThrow(); // empty array is valid per schema
  });

  it("rejects an invalid phase type", () => {
    expect(() =>
      WorkflowDefinitionSchema.parse({
        name: "bad",
        phases: [{ id: "x", type: "invalid" }],
      }),
    ).toThrow();
  });
});

describe("SessionLogEventSchema", () => {
  const base = {
    v: 1 as const,
    timestamp: "2026-04-24T12:34:56Z",
  };

  it("parses session-start", () => {
    const result = SessionLogEventSchema.parse({
      ...base,
      type: "session-start",
      planId: "plan-1",
      ticketId: "t-1",
      session: { id: SESSION_ID, provider: "claude" as const },
    });
    expect(result.type).toBe("session-start");
  });

  it("parses assistant-text", () => {
    const result = SessionLogEventSchema.parse({
      ...base,
      type: "assistant-text",
      text: "hello",
    });
    expect(result.type).toBe("assistant-text");
  });

  it("parses tool-use", () => {
    const result = SessionLogEventSchema.parse({
      ...base,
      type: "tool-use",
      callId: "call-1",
      toolName: "web.run",
      input: { q: "x", list: [1, 2, 3] },
    });
    expect(result.type).toBe("tool-use");
  });

  it("parses tool-result and defaults isError", () => {
    const result = SessionLogEventSchema.parse({
      ...base,
      type: "tool-result",
      callId: "call-1",
      toolName: "web.run",
      result: { ok: true },
    });
    expect(result.type).toBe("tool-result");
    if (result.type !== "tool-result") {
      throw new Error("Expected tool-result event");
    }
    expect(result.isError).toBe(false);
  });

  it("parses warning", () => {
    const result = SessionLogEventSchema.parse({
      ...base,
      type: "warning",
      message: "something happened",
      code: "WARN_TEST",
      data: { details: ["a", "b"] },
    });
    expect(result.type).toBe("warning");
  });

  it("rejects extra fields (strict objects)", () => {
    expect(() =>
      SessionLogEventSchema.parse({
        ...base,
        type: "assistant-text",
        text: "hello",
        extra: "nope",
      }),
    ).toThrow();
  });
});
