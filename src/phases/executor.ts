import { existsSync } from "node:fs";
import { join } from "node:path";
import { invokeAgent } from "../agents/invoke.js";
import { resolveAgent } from "../core/config.js";
import type { TemplateRenderer } from "../core/template.js";
import {
  type OrchestratorConfig,
  type PhaseDefinition,
  PhaseTypeSchema,
  type TicketState,
} from "../core/types.js";
import type { Logger } from "../utils/logger.js";
import { execCommand } from "../utils/shell.js";

export interface PhaseResult {
  success: boolean;
  output: string;
  captured: Record<string, string>;
  nextPhase: string | null;
  pending?: boolean;
  sessionId?: string;
}

export interface PhaseExecutor {
  execute(
    phase: PhaseDefinition,
    ticket: TicketState,
    planAgent: string | null,
    options?: { signal?: AbortSignal },
  ): Promise<PhaseResult>;
}

export function createPhaseExecutor(
  config: OrchestratorConfig,
  templateRenderer: TemplateRenderer,
  logger: Logger,
): PhaseExecutor {
  function resolveCwd(ticket: TicketState): string | undefined {
    const dir = ticket.worktree || undefined;
    return dir && existsSync(dir) ? dir : undefined;
  }

  async function runScript(
    phase: PhaseDefinition,
    ticket: TicketState,
    log: Logger,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; output: string }> {
    if (!phase.command) {
      return { success: false, output: "Script phase missing command" };
    }

    const scriptPath = join(config.scriptDir, phase.command);
    const args = (phase.args ?? []).map((a) =>
      templateRenderer.renderString(a, ticket),
    );

    log.info(`Running script: ${scriptPath} ${args.join(" ")}`);

    const result = await execCommand("/bin/bash", [scriptPath, ...args], {
      cwd: resolveCwd(ticket),
      timeoutMs: phase.timeoutSeconds ? phase.timeoutSeconds * 1000 : undefined,
      signal,
    });

    if (result.stderr) {
      log.warn(`Script stderr: ${result.stderr}`);
    }

    return {
      success: result.exitCode === 0,
      output: result.stdout,
    };
  }

  async function captureValues(
    phase: PhaseDefinition,
    phaseOutput: string,
    ticket: TicketState,
  ): Promise<Record<string, string>> {
    const captured: Record<string, string> = {};
    if (!phase.capture) return captured;

    for (const [key, value] of Object.entries(phase.capture)) {
      if (value === "stdout") {
        captured[key] = phaseOutput;
      } else {
        const result = await execCommand("bash", ["-c", value], {
          cwd: resolveCwd(ticket),
        });
        captured[key] = result.stdout.trim();
      }
    }

    return captured;
  }

  function getNextPhase(
    phase: PhaseDefinition,
    success: boolean,
  ): string | null {
    if (success) {
      return phase.onSuccess ?? null;
    }
    return phase.onFailure ?? null;
  }

  async function executeTerminalPhase(
    _phase: PhaseDefinition,
  ): Promise<PhaseResult> {
    return {
      success: true,
      output: "",
      captured: {},
      nextPhase: null,
    };
  }

  async function executeAgentPhase(
    phase: PhaseDefinition,
    ticket: TicketState,
    planAgent: string | null,
    log: Logger,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    if (!phase.promptTemplate) {
      return {
        success: false,
        output: "Agent phase missing promptTemplate",
        captured: {},
        nextPhase: getNextPhase(phase, false),
      };
    }

    const prompt = templateRenderer.render(phase.promptTemplate, ticket);
    const agentName = resolveAgent(
      config,
      phase.agent,
      ticket.agent,
      planAgent,
    );
    const agentConfig = config.agents[agentName];

    log.info(`Invoking agent "${agentName}"`);

    const agentResult = await invokeAgent(
      agentConfig,
      {
        prompt,
        cwd: resolveCwd(ticket),
        allowedTools: phase.allowedTools,
        timeoutMs: phase.timeoutSeconds
          ? phase.timeoutSeconds * 1000
          : undefined,
      },
      {
        onOutput: (chunk) => log.trace(chunk),
      },
      { signal },
    );

    const captured = await captureValues(phase, agentResult.stdout, ticket);
    const nextPhase = getNextPhase(phase, agentResult.success);

    return {
      success: agentResult.success,
      output: agentResult.stdout,
      captured,
      nextPhase,
      sessionId: agentResult.sessionId,
    };
  }

  async function executePollPhase(
    phase: PhaseDefinition,
    ticket: TicketState,
    log: Logger,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    if (!phase.command) {
      return {
        success: false,
        output: "Poll phase missing command",
        captured: {},
        nextPhase: getNextPhase(phase, false),
      };
    }

    const scriptPath = join(config.scriptDir, phase.command);
    const args = (phase.args ?? []).map((a) =>
      templateRenderer.renderString(a, ticket),
    );

    log.info(`Polling: ${scriptPath} ${args.join(" ")}`);

    const result = await execCommand("/bin/bash", [scriptPath, ...args], {
      cwd: resolveCwd(ticket),
      signal,
    });

    if (result.exitCode === 0) {
      const captured = await captureValues(phase, result.stdout, ticket);
      return {
        success: true,
        output: result.stdout,
        captured,
        nextPhase: getNextPhase(phase, true),
      };
    }

    if (result.exitCode >= 2) {
      return {
        success: false,
        output: result.stdout || result.stderr,
        captured: {},
        nextPhase: getNextPhase(phase, false),
      };
    }

    // Exit code 1 = not ready, yield back to the daemon loop
    return {
      success: false,
      output: "",
      captured: {},
      nextPhase: phase.id,
      pending: true,
    };
  }

  async function executeScriptPhase(
    phase: PhaseDefinition,
    ticket: TicketState,
    log: Logger,
    signal?: AbortSignal,
  ): Promise<PhaseResult> {
    const { success, output } = await runScript(phase, ticket, log, signal);
    const captured = await captureValues(phase, output, ticket);
    const nextPhase = getNextPhase(phase, success);

    return { success, output, captured, nextPhase };
  }

  return {
    async execute(phase, ticket, _planAgent, options) {
      const log = logger.child({ ticketId: ticket.ticketId });
      const signal = options?.signal;
      switch (phase.type) {
        case PhaseTypeSchema.enum.terminal:
          return executeTerminalPhase(phase);
        case PhaseTypeSchema.enum.agent:
          return executeAgentPhase(phase, ticket, _planAgent, log, signal);
        case PhaseTypeSchema.enum.poll:
          return executePollPhase(phase, ticket, log, signal);
        case PhaseTypeSchema.enum.script:
          return executeScriptPhase(phase, ticket, log, signal);
        default: {
          const _exhaustive: never = phase.type;
          throw new Error(`Unknown phase type: ${_exhaustive}`);
        }
      }
    },
  };
}
