import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTemplateRenderer } from "../core/template.js";
import type {
  OrchestratorConfig,
  PhaseDefinition,
  TicketState,
} from "../core/types.js";
import type { Logger } from "../utils/logger.js";
import { createPhaseExecutor } from "./executor.js";

function makeLogger(): Logger {
  return pino<"success">({
    level: "silent",
    customLevels: { success: 35 },
  });
}

function makeTicket(overrides: Partial<TicketState> = {}): TicketState {
  return {
    planId: "plan-1",
    ticketId: "TICKET-1",
    title: "Test Ticket",
    description: "A test description",
    acceptanceCriteria: [],
    linearUrl: null,
    repo: "test-repo",
    workflow: "minimal",
    branch: "feat/test",
    worktree: "",
    agent: "claude",
    status: "running",
    currentPhase: "run_script",
    phaseHistory: [],
    context: {},
    retries: {},
    error: null,
    ...overrides,
  };
}

describe("executor", () => {
  let tmpDir: string;
  let scriptDir: string;
  let promptDir: string;
  let config: OrchestratorConfig;
  let logger: Logger;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "executor-test-"));
    scriptDir = join(tmpDir, "scripts");
    promptDir = join(tmpDir, "prompts");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(scriptDir, { recursive: true });
    await mkdir(promptDir, { recursive: true });

    config = {
      defaultAgent: "claude",
      agents: {
        claude: { command: "claude", defaultArgs: [] },
      },
      orchestratorHome: tmpDir,
      stateDir: join(tmpDir, "state"),
      logDir: join(tmpDir, "logs"),
      workflowDir: join(tmpDir, "workflows"),
      workflowSearchPath: [join(tmpDir, "workflows")],
      promptDir,
      promptSearchPath: [promptDir],
      scriptDir,
      skillsDir: join(tmpDir, "skills"),
      pollInterval: 10,
      maxConcurrency: 3,
      ghCommand: "gh",
    };

    logger = makeLogger();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("script phase", () => {
    it("executes a script and returns success", async () => {
      await writeFile(
        join(scriptDir, "success.sh"),
        '#!/usr/bin/env bash\necho "done"',
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "run_script",
        type: "script",
        command: "success.sh",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "complete",
        onFailure: "abort",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("done");
      expect(result.nextPhase).toBe("complete");
    });

    it("returns failure for non-zero exit", async () => {
      await writeFile(
        join(scriptDir, "fail.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "run_script",
        type: "script",
        command: "fail.sh",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "complete",
        onFailure: "abort",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(false);
      expect(result.nextPhase).toBe("abort");
    });

    it("interpolates args using template renderer", async () => {
      await writeFile(
        join(scriptDir, "args.sh"),
        '#!/usr/bin/env bash\necho "branch=$1 repo=$2"',
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "run_script",
        type: "script",
        command: "args.sh",
        args: ["{{ branch }}", "{{ repo }}"],
        maxRetries: 0,
        notify: false,
        onSuccess: "complete",
        onFailure: "abort",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const ticket = makeTicket({
        branch: "feat/my-branch",
        repo: "my-repo",
      });
      const result = await executor.execute(phase, ticket, null);

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("branch=feat/my-branch repo=my-repo");
    });
  });

  describe("terminal phase", () => {
    it("always succeeds with null nextPhase", async () => {
      const phase: PhaseDefinition = {
        id: "complete",
        type: "terminal",
        args: [],
        maxRetries: 0,
        notify: false,
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(true);
      expect(result.nextPhase).toBeNull();
      expect(result.output).toBe("");
    });
  });

  describe("capture", () => {
    it("captures stdout into result", async () => {
      await writeFile(
        join(scriptDir, "capture.sh"),
        '#!/usr/bin/env bash\necho "captured_value"',
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "run_script",
        type: "script",
        command: "capture.sh",
        args: [],
        maxRetries: 0,
        notify: false,
        capture: { script_output: "stdout" },
        onSuccess: "complete",
        onFailure: "abort",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.captured.script_output).toContain("captured_value");
    });

    it("captures shell command output", async () => {
      await writeFile(
        join(scriptDir, "noop.sh"),
        '#!/usr/bin/env bash\necho "ok"',
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "run_script",
        type: "script",
        command: "noop.sh",
        args: [],
        maxRetries: 0,
        notify: false,
        capture: { hostname: "hostname" },
        onSuccess: "complete",
        onFailure: "abort",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.captured.hostname.length).toBeGreaterThan(0);
    });
  });

  describe("agent phase", () => {
    it("renders prompt, invokes agent, and returns success", async () => {
      await writeFile(
        join(promptDir, "test-prompt.md"),
        "Implement {{ title }} for {{ repo }}",
      );

      config.agents.echo = { command: "echo", defaultArgs: [] };

      const phase: PhaseDefinition = {
        id: "agent_phase",
        type: "agent",
        promptTemplate: "test-prompt.md",
        agent: "echo",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "verify",
        onFailure: "escalate",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("Implement Test Ticket for test-repo");
      expect(result.nextPhase).toBe("verify");
    });

    it("resolves agent from ticket when phase agent is not set", async () => {
      await writeFile(join(promptDir, "simple.md"), "hello");

      config.agents.echo = { command: "echo", defaultArgs: [] };

      const phase: PhaseDefinition = {
        id: "agent_phase",
        type: "agent",
        promptTemplate: "simple.md",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "next",
        onFailure: "fail",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const ticket = makeTicket({ agent: "echo" });
      const result = await executor.execute(phase, ticket, null);

      expect(result.success).toBe(true);
    });

    it("returns failure when promptTemplate is missing", async () => {
      const phase: PhaseDefinition = {
        id: "agent_phase",
        type: "agent",
        args: [],
        maxRetries: 0,
        notify: false,
        onFailure: "escalate",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(false);
      expect(result.output).toContain("missing promptTemplate");
      expect(result.nextPhase).toBe("escalate");
    });

    it("captures values from agent output", async () => {
      await writeFile(join(promptDir, "cap.md"), "capture test");

      config.agents.echo = { command: "echo", defaultArgs: [] };

      const phase: PhaseDefinition = {
        id: "agent_phase",
        type: "agent",
        promptTemplate: "cap.md",
        agent: "echo",
        args: [],
        maxRetries: 0,
        notify: false,
        capture: { agent_output: "stdout" },
        onSuccess: "done",
        onFailure: "fail",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(true);
      expect(result.captured.agent_output).toContain("capture test");
    });

    it("follows onFailure when agent fails", async () => {
      await writeFile(join(promptDir, "fail.md"), "this will fail");

      config.agents.failing = { command: "false", defaultArgs: [] };

      const phase: PhaseDefinition = {
        id: "agent_phase",
        type: "agent",
        promptTemplate: "fail.md",
        agent: "failing",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "next",
        onFailure: "escalate",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(false);
      expect(result.nextPhase).toBe("escalate");
    });
  });

  describe("poll phase", () => {
    it("returns success when script exits 0", async () => {
      await writeFile(
        join(scriptDir, "poll-ready.sh"),
        '#!/usr/bin/env bash\necho "ready"\nexit 0',
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "poll_phase",
        type: "poll",
        command: "poll-ready.sh",
        args: [],
        intervalSeconds: 60,
        timeoutSeconds: 5,
        maxRetries: 0,
        notify: false,
        onSuccess: "next",
        onFailure: "fail",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("ready");
      expect(result.nextPhase).toBe("next");
      expect(result.pending).toBeFalsy();
    });

    it("returns pending when script exits 1", async () => {
      await writeFile(
        join(scriptDir, "not-ready.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "poll_phase",
        type: "poll",
        command: "not-ready.sh",
        args: [],
        intervalSeconds: 60,
        timeoutSeconds: 86400,
        maxRetries: 0,
        notify: false,
        onSuccess: "next",
        onFailure: "fail",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(false);
      expect(result.pending).toBe(true);
      expect(result.nextPhase).toBe("poll_phase");
    });

    it("returns failure immediately on exit code >= 2", async () => {
      await writeFile(
        join(scriptDir, "hard-error.sh"),
        '#!/usr/bin/env bash\necho "fatal error"\nexit 2',
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "poll_phase",
        type: "poll",
        command: "hard-error.sh",
        args: [],
        intervalSeconds: 0.1,
        timeoutSeconds: 10,
        maxRetries: 0,
        notify: false,
        onSuccess: "next",
        onFailure: "error_handler",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(false);
      expect(result.output).toContain("fatal error");
      expect(result.nextPhase).toBe("error_handler");
      expect(result.pending).toBeFalsy();
    });

    it("captures values on successful poll", async () => {
      await writeFile(
        join(scriptDir, "poll-capture.sh"),
        '#!/usr/bin/env bash\necho "captured_poll_value"\nexit 0',
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "poll_phase",
        type: "poll",
        command: "poll-capture.sh",
        args: [],
        intervalSeconds: 0.1,
        timeoutSeconds: 10,
        maxRetries: 0,
        notify: false,
        capture: { poll_result: "stdout" },
        onSuccess: "next",
        onFailure: "fail",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(true);
      expect(result.captured.poll_result).toContain("captured_poll_value");
    });

    it("returns failure when command is missing", async () => {
      const phase: PhaseDefinition = {
        id: "poll_phase",
        type: "poll",
        args: [],
        maxRetries: 0,
        notify: false,
        onFailure: "abort",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);

      expect(result.success).toBe(false);
      expect(result.output).toContain("missing command");
      expect(result.nextPhase).toBe("abort");
    });
  });

  describe("next phase logic", () => {
    it("returns onSuccess on success", async () => {
      await writeFile(join(scriptDir, "ok.sh"), "#!/usr/bin/env bash\nexit 0", {
        mode: 0o755,
      });

      const phase: PhaseDefinition = {
        id: "test",
        type: "script",
        command: "ok.sh",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "next_phase",
        onFailure: "error_phase",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);
      expect(result.nextPhase).toBe("next_phase");
    });

    it("returns onFailure on failure", async () => {
      await writeFile(
        join(scriptDir, "fail2.sh"),
        "#!/usr/bin/env bash\nexit 1",
        { mode: 0o755 },
      );

      const phase: PhaseDefinition = {
        id: "test",
        type: "script",
        command: "fail2.sh",
        args: [],
        maxRetries: 0,
        notify: false,
        onSuccess: "next_phase",
        onFailure: "error_phase",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);
      expect(result.nextPhase).toBe("error_phase");
    });

    it("returns null when no transition defined", async () => {
      await writeFile(
        join(scriptDir, "ok2.sh"),
        "#!/usr/bin/env bash\nexit 0",
        {
          mode: 0o755,
        },
      );

      const phase: PhaseDefinition = {
        id: "test",
        type: "script",
        command: "ok2.sh",
        args: [],
        maxRetries: 0,
        notify: false,
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);
      expect(result.nextPhase).toBeNull();
    });
  });

  describe("missing command", () => {
    it("returns failure when script phase has no command", async () => {
      const phase: PhaseDefinition = {
        id: "test",
        type: "script",
        args: [],
        maxRetries: 0,
        notify: false,
        onFailure: "abort",
      };

      const renderer = createTemplateRenderer(promptDir);
      const executor = createPhaseExecutor(config, renderer, logger);
      const result = await executor.execute(phase, makeTicket(), null);
      expect(result.success).toBe(false);
      expect(result.output).toContain("missing command");
    });
  });
});
