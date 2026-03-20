import {
  access,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunner, resolveTicketRepo } from "./runner.js";
import type { OrchestratorConfig, PlanFile, TicketState } from "./types.js";

describe("runner", () => {
  let tmpDir: string;
  let stateDir: string;
  let workflowDir: string;
  let scriptDir: string;
  let promptDir: string;
  let logDir: string;
  let config: OrchestratorConfig;

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

    await writeFile(join(workflowDir, "minimal.yaml"), minimalYaml);

    config = {
      defaultAgent: "claude",
      agents: {
        claude: { command: "claude", defaultArgs: [] },
      },
      orchestratorHome: tmpDir,
      stateDir,
      logDir,
      workflowDir,
      workflowSearchPath: [workflowDir],
      promptDir,
      promptSearchPath: [promptDir],
      scriptDir,
      skillsDir: join(tmpDir, "skills"),
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

  describe("tick", () => {
    it("resolves dependencies and dispatches ready tickets", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan({
        tickets: [
          { ticketId: "TICKET-1", order: 1, blockedBy: [] },
          { ticketId: "TICKET-2", order: 2, blockedBy: [] },
        ],
      });
      await savePlan(plan);
      await saveTicket(makeTicket({ ticketId: "TICKET-1", status: "ready" }));
      await saveTicket(makeTicket({ ticketId: "TICKET-2", status: "ready" }));

      const runner = createRunner(config);
      await runner.tick();

      // Give fire-and-forget a moment to set status
      await new Promise((r) => setTimeout(r, 100));

      const t1 = await readTicket("test-plan", "TICKET-1");
      const t2 = await readTicket("test-plan", "TICKET-2");

      // Both should have been dispatched (set to running or already completed)
      expect(["running", "complete", "needs_attention"]).toContain(t1.status);
      expect(["running", "complete", "needs_attention"]).toContain(t2.status);
    });

    it("respects maxConcurrency", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\nsleep 2 && echo "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan({
        tickets: [
          { ticketId: "TICKET-1", order: 1, blockedBy: [] },
          { ticketId: "TICKET-2", order: 2, blockedBy: [] },
        ],
      });
      await savePlan(plan);
      await saveTicket(makeTicket({ ticketId: "TICKET-1", status: "ready" }));
      await saveTicket(makeTicket({ ticketId: "TICKET-2", status: "ready" }));

      const runner = createRunner({ ...config, maxConcurrency: 1 });
      await runner.tick();

      // Give fire-and-forget a moment to set status
      await new Promise((r) => setTimeout(r, 100));

      const t1 = await readTicket("test-plan", "TICKET-1");
      const t2 = await readTicket("test-plan", "TICKET-2");

      // Only one should be dispatched, the other should still be ready
      const statuses = [t1.status, t2.status].sort();
      expect(statuses).toContain("ready");
      expect(statuses).toContain("running");
    });

    it("skips paused plans", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan({ status: "paused" });
      await savePlan(plan);
      await saveTicket(makeTicket({ status: "ready" }));

      const runner = createRunner(config);
      await runner.tick();

      await new Promise((r) => setTimeout(r, 100));

      const t = await readTicket("test-plan", "TICKET-1");
      // Ticket should remain ready since the plan is paused
      expect(t.status).toBe("ready");
    });

    it("unblocks queued tickets when dependencies complete", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan({
        tickets: [
          { ticketId: "TICKET-1", order: 1, blockedBy: [] },
          { ticketId: "TICKET-2", order: 2, blockedBy: ["TICKET-1"] },
        ],
      });
      await savePlan(plan);
      await saveTicket(
        makeTicket({ ticketId: "TICKET-1", status: "complete" }),
      );
      await saveTicket(makeTicket({ ticketId: "TICKET-2", status: "queued" }));

      const runner = createRunner(config);
      await runner.tick();

      await new Promise((r) => setTimeout(r, 100));

      const t2 = await readTicket("test-plan", "TICKET-2");
      // TICKET-2 should have been unblocked (queued→ready) and then dispatched
      expect(["ready", "running", "complete"]).toContain(t2.status);
    });

    it("startDaemon respects AbortSignal", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan();
      await savePlan(plan);
      await saveTicket(makeTicket());

      const runner = createRunner({ ...config, pollInterval: 0.1 });
      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 200);

      const start = Date.now();
      await runner.startDaemon({ signal: controller.signal });
      const elapsed = Date.now() - start;

      // Should have stopped within reasonable time (not running indefinitely)
      expect(elapsed).toBeLessThan(5000);
    });

    it("creates a daemon lockfile on startup and removes it on shutdown", async () => {
      const runner = createRunner({ ...config, pollInterval: 0.1 });
      const lockPath = join(config.orchestratorHome, "daemon.pid");
      const controller = new AbortController();
      const daemonPromise = runner.startDaemon({ signal: controller.signal });

      await vi.waitFor(async () => {
        const pid = (await readFile(lockPath, "utf-8")).trim();
        expect(pid).toBe(String(process.pid));
      });

      controller.abort();
      await daemonPromise;
      await expect(access(lockPath, constants.F_OK)).rejects.toThrow();
    });

    it("prevents starting a second daemon when a live daemon lock exists", async () => {
      const lockPath = join(config.orchestratorHome, "daemon.pid");
      await writeFile(lockPath, "4242\n");

      const runner = createRunner(config, {
        processInspector: {
          isRunning: async (pid) => pid === 4242,
          describe: async (pid) =>
            pid === 4242 ? "node /usr/local/bin/orchestrator daemon" : null,
        },
      });

      await expect(runner.startDaemon()).rejects.toThrow(
        "Another orchestrator daemon is already running",
      );
      expect((await readFile(lockPath, "utf-8")).trim()).toBe("4242");
    });

    it("replaces a stale daemon lock when the recorded pid is not running", async () => {
      const lockPath = join(config.orchestratorHome, "daemon.pid");
      await writeFile(lockPath, "4242\n");

      const runner = createRunner(
        { ...config, pollInterval: 0.1 },
        {
          processInspector: {
            isRunning: async () => false,
            describe: async () => null,
          },
        },
      );
      const controller = new AbortController();
      const daemonPromise = runner.startDaemon({ signal: controller.signal });

      await vi.waitFor(async () => {
        const pid = (await readFile(lockPath, "utf-8")).trim();
        expect(pid).toBe(String(process.pid));
      });

      controller.abort();
      await daemonPromise;
      await expect(access(lockPath, constants.F_OK)).rejects.toThrow();
    });

    it("replaces a lock when the pid is running but is not an orchestrator daemon", async () => {
      const lockPath = join(config.orchestratorHome, "daemon.pid");
      await writeFile(lockPath, "4242\n");

      const runner = createRunner(
        { ...config, pollInterval: 0.1 },
        {
          processInspector: {
            isRunning: async () => true,
            describe: async () => "bash -lc sleep 100",
          },
        },
      );
      const controller = new AbortController();
      const daemonPromise = runner.startDaemon({ signal: controller.signal });

      await vi.waitFor(async () => {
        const pid = (await readFile(lockPath, "utf-8")).trim();
        expect(pid).toBe(String(process.pid));
      });

      controller.abort();
      await daemonPromise;
      await expect(access(lockPath, constants.F_OK)).rejects.toThrow();
    });
  });

  describe("poll phase", () => {
    const pollWorkflowYaml = `
name: poll-workflow
description: "Poll workflow"
phases:
  - id: poll_check
    type: poll
    command: check.sh
    intervalSeconds: 1
    timeoutSeconds: 86400
    onSuccess: complete
    onFailure: handle_failure
  - id: complete
    type: terminal
  - id: handle_failure
    type: terminal
    notify: true
`;

    it("sets ticket to ready without incrementing retries when poll is pending", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );
      await writeFile(join(workflowDir, "poll.yaml"), pollWorkflowYaml);

      const plan = makePlan({ workflow: "poll-workflow" });
      const ticket = makeTicket({
        workflow: "poll-workflow",
        currentPhase: "poll_check",
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("ready");
      expect(result.currentPhase).toBe("poll_check");
      expect(result.retries.poll_check ?? 0).toBe(0);
    });

    it("stores poll start time in context", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );
      await writeFile(join(workflowDir, "poll.yaml"), pollWorkflowYaml);

      const plan = makePlan({ workflow: "poll-workflow" });
      const ticket = makeTicket({
        workflow: "poll-workflow",
        currentPhase: "poll_check",
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.context._pollStart_poll_check).toBeDefined();
      const pollStart = new Date(
        result.context._pollStart_poll_check,
      ).getTime();
      expect(pollStart).toBeLessThanOrEqual(Date.now());
    });

    it("advances on poll success", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        '#!/usr/bin/env bash\necho "done"\nexit 0',
        { mode: 0o755 },
      );
      await writeFile(join(workflowDir, "poll.yaml"), pollWorkflowYaml);

      const plan = makePlan({ workflow: "poll-workflow" });
      const ticket = makeTicket({
        workflow: "poll-workflow",
        currentPhase: "poll_check",
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("complete");
      expect(result.currentPhase).toBe("complete");
    });

    it("times out after exceeding timeoutSeconds", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );

      const shortTimeoutYaml = `
name: poll-timeout
description: "Poll with short timeout"
phases:
  - id: poll_check
    type: poll
    command: check.sh
    intervalSeconds: 1
    timeoutSeconds: 0
    onSuccess: complete
    onFailure: handle_failure
  - id: complete
    type: terminal
  - id: handle_failure
    type: terminal
    notify: true
`;
      await writeFile(join(workflowDir, "poll-timeout.yaml"), shortTimeoutYaml);

      const plan = makePlan({ workflow: "poll-timeout" });
      const ticket = makeTicket({
        workflow: "poll-timeout",
        currentPhase: "poll_check",
        context: {
          _pollStart_poll_check: new Date(Date.now() - 1000).toISOString(),
        },
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Poll timeout exceeded");
    });

    it("clears poll start time when poll succeeds", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        '#!/usr/bin/env bash\necho "done"\nexit 0',
        { mode: 0o755 },
      );
      await writeFile(join(workflowDir, "poll.yaml"), pollWorkflowYaml);

      const plan = makePlan({ workflow: "poll-workflow" });
      const ticket = makeTicket({
        workflow: "poll-workflow",
        currentPhase: "poll_check",
        context: { _pollStart_poll_check: new Date().toISOString() },
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("complete");
      expect(result.context._pollStart_poll_check).toBeUndefined();
      expect(result.context._pollNextCheck_poll_check).toBeUndefined();
    });

    it("stores poll next check time in context", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );
      await writeFile(join(workflowDir, "poll.yaml"), pollWorkflowYaml);

      const plan = makePlan({ workflow: "poll-workflow" });
      const ticket = makeTicket({
        workflow: "poll-workflow",
        currentPhase: "poll_check",
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.context._pollNextCheck_poll_check).toBeDefined();
      const nextCheck = new Date(
        result.context._pollNextCheck_poll_check,
      ).getTime();
      // intervalSeconds is 1, so next check should be ~1s in the future
      expect(nextCheck).toBeGreaterThan(Date.now() - 500);
    });

    it("tick skips poll ticket when interval has not elapsed", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );
      await writeFile(join(workflowDir, "poll.yaml"), pollWorkflowYaml);

      const plan = makePlan({ workflow: "poll-workflow" });
      // Ticket is ready but has a next check time 10 minutes in the future
      const ticket = makeTicket({
        workflow: "poll-workflow",
        currentPhase: "poll_check",
        status: "ready",
        context: {
          _pollStart_poll_check: new Date().toISOString(),
          _pollNextCheck_poll_check: new Date(
            Date.now() + 600_000,
          ).toISOString(),
        },
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      await runner.tick();

      await new Promise((r) => setTimeout(r, 100));

      const t = await readTicket("test-plan", "TICKET-1");
      // Should still be ready — tick skipped it due to interval
      expect(t.status).toBe("ready");
    });

    it("tick dispatches poll ticket when interval has elapsed", async () => {
      await writeFile(
        join(scriptDir, "check.sh"),
        '#!/usr/bin/env bash\necho "done"\nexit 0',
        { mode: 0o755 },
      );
      await writeFile(join(workflowDir, "poll.yaml"), pollWorkflowYaml);

      const plan = makePlan({ workflow: "poll-workflow" });
      // Ticket is ready and next check time is in the past
      const ticket = makeTicket({
        workflow: "poll-workflow",
        currentPhase: "poll_check",
        status: "ready",
        context: {
          _pollStart_poll_check: new Date(Date.now() - 5000).toISOString(),
          _pollNextCheck_poll_check: new Date(Date.now() - 1000).toISOString(),
        },
      });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      await runner.tick();

      await new Promise((r) => setTimeout(r, 200));

      const t = await readTicket("test-plan", "TICKET-1");
      // Should have been dispatched and completed
      expect(t.status).toBe("complete");
    });
  });

  describe("pause aborts in-flight agents", () => {
    it("pausing a ticket on disk during execution stops the agent", async () => {
      // Use a long-running script so we can pause mid-execution
      await writeFile(
        join(scriptDir, "run.sh"),
        "#!/usr/bin/env bash\nsleep 30 && echo ok",
        { mode: 0o755 },
      );

      const plan = makePlan();
      const ticket = makeTicket({ status: "ready" });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner({ ...config, pollInterval: 0.1 });

      // Dispatch via tick
      await runner.tick();

      // Give fire-and-forget a moment to start
      await new Promise((r) => setTimeout(r, 100));

      // Verify ticket is running
      const running = await readTicket("test-plan", "TICKET-1");
      expect(running.status).toBe("running");

      // Pause the ticket on disk
      await saveTicket({ ...running, status: "paused" });

      // Next tick should detect the pause and abort the in-flight agent
      await runner.tick();

      // Give time for the abort to propagate and status to be written
      await new Promise((r) => setTimeout(r, 500));

      const final = await readTicket("test-plan", "TICKET-1");
      expect(final.status).toBe("paused");
    });

    it("pausing a plan on disk during execution stops its tickets", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        "#!/usr/bin/env bash\nsleep 30 && echo ok",
        { mode: 0o755 },
      );

      const plan = makePlan();
      const ticket = makeTicket({ status: "ready" });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner({ ...config, pollInterval: 0.1 });

      // Dispatch via tick
      await runner.tick();

      await new Promise((r) => setTimeout(r, 100));

      // Pause the plan on disk
      await savePlan({ ...plan, status: "paused" });

      // Next tick should detect the pause and abort the in-flight agent
      await runner.tick();

      await new Promise((r) => setTimeout(r, 500));

      const final = await readTicket("test-plan", "TICKET-1");
      expect(final.status).toBe("paused");
    });
  });

  describe("resolveTicketRepo", () => {
    it("returns ticket unchanged when ticket has a repo", () => {
      const ticket = makeTicket({ repo: "/repos/backend" });
      const result = resolveTicketRepo(ticket, { repo: "/repos/default" });
      expect(result.repo).toBe("/repos/backend");
    });

    it("inherits repo from plan when ticket repo is null", () => {
      const ticket = makeTicket({ repo: null });
      const result = resolveTicketRepo(ticket, { repo: "/repos/default" });
      expect(result.repo).toBe("/repos/default");
    });

    it("throws when both ticket and plan repo are null", () => {
      const ticket = makeTicket({ repo: null });
      expect(() => resolveTicketRepo(ticket, { repo: null })).toThrow(
        "has no repo and plan",
      );
    });

    it("throws when ticket repo is null and plan is null", () => {
      const ticket = makeTicket({ repo: null });
      expect(() => resolveTicketRepo(ticket, null)).toThrow(
        "has no repo and plan",
      );
    });
  });

  describe("multi-repo plans", () => {
    it("executes tickets with different repos in a null-repo plan", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "success output"',
        { mode: 0o755 },
      );

      const plan = makePlan({
        repo: null,
        tickets: [
          { ticketId: "TICKET-1", order: 1, blockedBy: [] },
          { ticketId: "TICKET-2", order: 2, blockedBy: [] },
        ],
      });
      await savePlan(plan);
      await saveTicket(
        makeTicket({ ticketId: "TICKET-1", repo: "/repos/backend" }),
      );
      await saveTicket(
        makeTicket({ ticketId: "TICKET-2", repo: "/repos/frontend" }),
      );

      const runner = createRunner(config);
      const r1 = await runner.runSingleTicket("test-plan", "TICKET-1");
      const r2 = await runner.runSingleTicket("test-plan", "TICKET-2");

      expect(r1.status).toBe("complete");
      expect(r2.status).toBe("complete");
    });

    it("unblocks cross-repo tickets via dependencies", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan({
        repo: null,
        tickets: [
          { ticketId: "TICKET-1", order: 1, blockedBy: [] },
          { ticketId: "TICKET-2", order: 2, blockedBy: ["TICKET-1"] },
        ],
      });
      await savePlan(plan);
      await saveTicket(
        makeTicket({
          ticketId: "TICKET-1",
          repo: "/repos/backend",
          status: "complete",
        }),
      );
      await saveTicket(
        makeTicket({
          ticketId: "TICKET-2",
          repo: "/repos/frontend",
          status: "queued",
        }),
      );

      const runner = createRunner(config);
      await runner.tick();

      await new Promise((r) => setTimeout(r, 100));

      const t2 = await readTicket("test-plan", "TICKET-2");
      expect(["ready", "running", "complete"]).toContain(t2.status);
    });

    it("backward compat: plan with string repo still works", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan({ repo: "/repos/my-project" });
      const ticket = makeTicket({ repo: "/repos/my-project" });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("complete");
    });

    it("ticket with null repo inherits from plan repo", async () => {
      await writeFile(
        join(scriptDir, "run.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const plan = makePlan({ repo: "/repos/my-project" });
      const ticket = makeTicket({ repo: null });
      await savePlan(plan);
      await saveTicket(ticket);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("complete");
    });
  });

  it("check-pr-closed.sh is executable with correct shebang", async () => {
    const projectRoot = resolve(
      dirname(new URL(import.meta.url).pathname),
      "../..",
    );
    const scriptPath = join(projectRoot, "scripts/check-pr-closed.sh");
    await access(scriptPath, constants.X_OK);
    const content = await readFile(scriptPath, "utf-8");
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  describe("closed PR routing", () => {
    const closedPrWorkflowYaml = `
name: closed-pr-workflow
description: "Workflow with closed PR routing"
phases:
  - id: await_review
    type: poll
    command: check-review.sh
    intervalSeconds: 1
    timeoutSeconds: 0
    onSuccess: complete
    onFailure: route_review_failure
  - id: route_review_failure
    type: script
    command: check-pr-closed.sh
    args:
      - "{{ repo }}"
      - "{{ context.pr_number }}"
    onSuccess: pr_closed
    onFailure: handle_review
  - id: handle_review
    type: terminal
    notify: true
  - id: pr_closed
    type: terminal
    notify: true
  - id: complete
    type: terminal
`;

    async function setupClosedPrTest(
      reviewExitCode: number,
      closedExitCode: number,
    ) {
      await writeFile(
        join(scriptDir, "check-review.sh"),
        `#!/usr/bin/env bash\nexit ${reviewExitCode}`,
        { mode: 0o755 },
      );
      await writeFile(
        join(scriptDir, "check-pr-closed.sh"),
        `#!/usr/bin/env bash\nexit ${closedExitCode}`,
        { mode: 0o755 },
      );
      await writeFile(
        join(workflowDir, "closed-pr.yaml"),
        closedPrWorkflowYaml,
      );

      const plan = makePlan({ workflow: "closed-pr-workflow" });
      const ticket = makeTicket({
        workflow: "closed-pr-workflow",
        currentPhase: "await_review",
        context: {
          _pollStart_await_review: new Date(Date.now() - 1000).toISOString(),
        },
      });
      await savePlan(plan);
      await saveTicket(ticket);
    }

    it("poll failure routes to pr_closed when routing script exits 0", async () => {
      await setupClosedPrTest(2, 0);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("needs_attention");
      expect(result.currentPhase).toBe("pr_closed");
    });

    it("poll failure routes to handle_review when routing script exits 1", async () => {
      await setupClosedPrTest(2, 1);

      const runner = createRunner(config);
      const result = await runner.runSingleTicket("test-plan", "TICKET-1");

      expect(result.status).toBe("needs_attention");
      expect(result.currentPhase).toBe("handle_review");
    });
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
