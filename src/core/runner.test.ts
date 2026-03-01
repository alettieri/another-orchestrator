import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunner } from "./runner.js";
import type { OrchestratorConfig, PlanFile, TicketState } from "./types.js";

describe("runner", () => {
  let tmpDir: string;
  let stateDir: string;
  let workflowDir: string;
  let scriptDir: string;
  let promptDir: string;
  let logDir: string;
  let config: OrchestratorConfig;

  const registryYaml = `
workflows:
  - name: minimal
    file: minimal.yaml
    description: "Minimal workflow"
    tags: [test]
`;

  const minimalYaml = `
name: minimal
description: "Test workflow"
phases:
  - id: run_script
    type: script
    command: run.sh
    args:
      - "{{ branch }}"
    maxRetries: 2
    capture:
      script_output: stdout
    onSuccess: complete
    onFailure: abort
  - id: complete
    type: terminal
  - id: abort
    type: terminal
    notify: true
`;

  function makePlan(overrides: Partial<PlanFile> = {}): PlanFile {
    return {
      id: "test-plan",
      name: "Test Plan",
      createdAt: new Date().toISOString(),
      createdBy: "test",
      repo: "test-repo",
      workflow: "minimal",
      agent: null,
      worktreeRoot: "/tmp/worktrees",
      status: "active",
      tickets: [{ ticketId: "TICKET-1", order: 1, blockedBy: [] }],
      ...overrides,
    };
  }

  function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
    return {
      planId: "test-plan",
      ticketId: "TICKET-1",
      title: "Test Ticket",
      description: "A test ticket",
      acceptanceCriteria: [],
      linearUrl: null,
      repo: "test-repo",
      workflow: "minimal",
      branch: "feat/test",
      worktree: "",
      agent: null,
      status: "ready",
      currentPhase: "run_script",
      phaseHistory: [],
      context: {},
      retries: {},
      error: null,
      ...overrides,
    };
  }

  async function savePlan(plan: PlanFile) {
    const planDir = join(stateDir, "plans", plan.id);
    await mkdir(join(planDir, "tickets"), { recursive: true });
    await writeFile(join(planDir, "plan.json"), JSON.stringify(plan, null, 2));
  }

  async function saveTicket(ticket: TicketState) {
    const ticketsDir = join(stateDir, "plans", ticket.planId, "tickets");
    await mkdir(ticketsDir, { recursive: true });
    await writeFile(
      join(ticketsDir, `${ticket.ticketId}.json`),
      JSON.stringify(ticket, null, 2),
    );
  }

  async function readTicket(
    planId: string,
    ticketId: string,
  ): Promise<TicketState> {
    const path = join(stateDir, "plans", planId, "tickets", `${ticketId}.json`);
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "runner-test-"));
    stateDir = join(tmpDir, "state");
    workflowDir = join(tmpDir, "workflows");
    scriptDir = join(tmpDir, "scripts");
    promptDir = join(tmpDir, "prompts");
    logDir = join(tmpDir, "logs");

    await mkdir(stateDir, { recursive: true });
    await mkdir(workflowDir, { recursive: true });
    await mkdir(scriptDir, { recursive: true });
    await mkdir(promptDir, { recursive: true });
    await mkdir(logDir, { recursive: true });

    await writeFile(join(workflowDir, "registry.yaml"), registryYaml);
    await writeFile(join(workflowDir, "minimal.yaml"), minimalYaml);

    config = {
      defaultAgent: "claude",
      agents: {
        claude: { command: "claude", defaultArgs: [] },
      },
      stateDir,
      logDir,
      workflowDir,
      promptDir,
      scriptDir,
      pollInterval: 10,
      maxConcurrency: 3,
      ghCommand: "gh",
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("advances through phases to completion", async () => {
    await writeFile(
      join(scriptDir, "run.sh"),
      '#!/usr/bin/env bash\necho "success output"',
      { mode: 0o755 },
    );

    const plan = makePlan();
    const ticket = makeTicket();
    await savePlan(plan);
    await saveTicket(ticket);

    const runner = createRunner(config);
    const result = await runner.runSingleTicket("test-plan", "TICKET-1");

    expect(result.status).toBe("complete");
    expect(result.phaseHistory.length).toBeGreaterThanOrEqual(2);
    expect(result.phaseHistory[0].phase).toBe("run_script");
    expect(result.phaseHistory[0].status).toBe("success");
    expect(result.context.script_output).toContain("success output");
  });

  it("handles script failure and goes to abort (needs_attention)", async () => {
    await writeFile(join(scriptDir, "run.sh"), "#!/usr/bin/env bash\nexit 1", {
      mode: 0o755,
    });

    const plan = makePlan();
    const ticket = makeTicket();
    await savePlan(plan);
    await saveTicket(ticket);

    const runner = createRunner(config);
    const result = await runner.runSingleTicket("test-plan", "TICKET-1");

    expect(result.status).toBe("needs_attention");
    expect(result.phaseHistory[0].phase).toBe("run_script");
    expect(result.phaseHistory[0].status).toBe("failure");
  });

  it("captures stdout into context", async () => {
    await writeFile(
      join(scriptDir, "run.sh"),
      '#!/usr/bin/env bash\necho "captured_data"',
      { mode: 0o755 },
    );

    const plan = makePlan();
    const ticket = makeTicket();
    await savePlan(plan);
    await saveTicket(ticket);

    const runner = createRunner(config);
    const result = await runner.runSingleTicket("test-plan", "TICKET-1");

    expect(result.context.script_output).toContain("captured_data");
  });

  it("throws for missing ticket", async () => {
    const runner = createRunner(config);
    await expect(runner.runSingleTicket("test-plan", "NOPE")).rejects.toThrow(
      'Ticket "NOPE" not found',
    );
  });

  it("persists state to disk after execution", async () => {
    await writeFile(
      join(scriptDir, "run.sh"),
      '#!/usr/bin/env bash\necho "ok"',
      { mode: 0o755 },
    );

    const plan = makePlan();
    const ticket = makeTicket();
    await savePlan(plan);
    await saveTicket(ticket);

    const runner = createRunner(config);
    await runner.runSingleTicket("test-plan", "TICKET-1");

    const onDisk = await readTicket("test-plan", "TICKET-1");
    expect(onDisk.status).toBe("complete");
    expect(onDisk.phaseHistory.length).toBeGreaterThan(0);
  });

  it("handles max retries exceeded", async () => {
    await writeFile(join(scriptDir, "run.sh"), "#!/usr/bin/env bash\nexit 1", {
      mode: 0o755,
    });

    // Use a workflow that retries itself
    const retryWorkflowYaml = `
name: retry-workflow
description: "Workflow that retries"
phases:
  - id: run_script
    type: script
    command: run.sh
    maxRetries: 1
    onSuccess: complete
    onFailure: run_script
  - id: complete
    type: terminal
`;
    const retryRegistryYaml = `
workflows:
  - name: retry-workflow
    file: retry.yaml
    description: "Retry workflow"
    tags: [test]
`;
    await writeFile(join(workflowDir, "registry.yaml"), retryRegistryYaml);
    await writeFile(join(workflowDir, "retry.yaml"), retryWorkflowYaml);

    const plan = makePlan({ workflow: "retry-workflow" });
    const ticket = makeTicket({ workflow: "retry-workflow" });
    await savePlan(plan);
    await saveTicket(ticket);

    const runner = createRunner(config);
    const result = await runner.runSingleTicket("test-plan", "TICKET-1");

    expect(result.status).toBe("failed");
    expect(result.error).toContain("maxRetries");
  });

  it("handles agent phase without promptTemplate gracefully", async () => {
    // Agent phase missing promptTemplate should fail and follow onFailure
    const agentWorkflowYaml = `
name: agent-workflow
description: "Agent workflow"
phases:
  - id: agent_phase
    type: agent
    onSuccess: complete
    onFailure: abort
  - id: complete
    type: terminal
  - id: abort
    type: terminal
`;
    const agentRegistryYaml = `
workflows:
  - name: agent-workflow
    file: agent.yaml
    description: "Agent workflow"
    tags: [test]
`;
    await writeFile(join(workflowDir, "registry.yaml"), agentRegistryYaml);
    await writeFile(join(workflowDir, "agent.yaml"), agentWorkflowYaml);

    const plan = makePlan({ workflow: "agent-workflow" });
    const ticket = makeTicket({
      workflow: "agent-workflow",
      currentPhase: "agent_phase",
    });
    await savePlan(plan);
    await saveTicket(ticket);

    const runner = createRunner(config);
    const result = await runner.runSingleTicket("test-plan", "TICKET-1");

    // Missing promptTemplate causes failure, follows onFailure to abort terminal
    expect(result.status).toBe("complete");
    expect(result.currentPhase).toBe("abort");
  });
});
