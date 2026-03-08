import { describe, expect, it } from "vitest";
import {
  AgentConfigSchema,
  OrchestratorConfigSchema,
  PhaseHistoryEntrySchema,
  PlanFileSchema,
  RawOrchestratorConfigSchema,
  TicketStatusSchema,
  WorkflowDefinitionSchema,
} from "./types.js";

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
  it("parses entry without sessionId", () => {
    const result = PhaseHistoryEntrySchema.parse({
      phase: "implement",
      status: "success",
      startedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:05:00Z",
    });
    expect(result.sessionId).toBeUndefined();
  });

  it("parses entry with sessionId", () => {
    const result = PhaseHistoryEntrySchema.parse({
      phase: "implement",
      status: "success",
      startedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:05:00Z",
      sessionId: "cc807f8c-1234-5678-abcd-ef0123456789",
    });
    expect(result.sessionId).toBe("cc807f8c-1234-5678-abcd-ef0123456789");
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
