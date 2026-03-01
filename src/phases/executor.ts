import { join } from "node:path";
import { invokeAgent } from "../agents/invoke.js";
import { resolveAgent } from "../core/config.js";
import type { TemplateRenderer } from "../core/template.js";
import type {
  OrchestratorConfig,
  PhaseDefinition,
  TicketState,
} from "../core/types.js";
import type { Logger } from "../utils/logger.js";
import { execCommand } from "../utils/shell.js";

export interface PhaseResult {
  success: boolean;
  output: string;
  captured: Record<string, string>;
  nextPhase: string | null;
}

export interface PhaseExecutor {
  execute(
    phase: PhaseDefinition,
    ticket: TicketState,
    planAgent: string | null,
  ): Promise<PhaseResult>;
}

export function createPhaseExecutor(
  config: OrchestratorConfig,
  templateRenderer: TemplateRenderer,
  logger: Logger,
): PhaseExecutor {
  async function executeScript(
    phase: PhaseDefinition,
    ticket: TicketState,
  ): Promise<{ success: boolean; output: string }> {
    if (!phase.command) {
      return { success: false, output: "Script phase missing command" };
    }

    const scriptPath = join(config.scriptDir, phase.command);
    const args = (phase.args ?? []).map((a) =>
      templateRenderer.renderString(a, ticket),
    );

    logger.info(
      `Running script: ${scriptPath} ${args.join(" ")}`,
      ticket.ticketId,
    );

    const result = await execCommand("/bin/bash", [scriptPath, ...args], {
      cwd: ticket.worktree || undefined,
      timeoutMs: phase.timeoutSeconds ? phase.timeoutSeconds * 1000 : undefined,
    });

    if (result.stderr) {
      logger.warn(`Script stderr: ${result.stderr}`, ticket.ticketId);
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
          cwd: ticket.worktree || undefined,
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

  return {
    async execute(phase, ticket, _planAgent) {
      if (phase.type === "terminal") {
        return {
          success: true,
          output: "",
          captured: {},
          nextPhase: null,
        };
      }

      if (phase.type === "agent") {
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
          _planAgent,
        );
        const agentConfig = config.agents[agentName];

        logger.info(`Invoking agent "${agentName}"`, ticket.ticketId);

        const agentResult = await invokeAgent(
          agentConfig,
          {
            prompt,
            cwd: ticket.worktree || undefined,
            allowedTools: phase.allowedTools,
            maxTurns: phase.maxTurns,
          },
          {
            onOutput: (chunk) => logger.agentOutput(ticket.ticketId, chunk),
          },
        );

        const captured = await captureValues(phase, agentResult.stdout, ticket);
        const nextPhase = getNextPhase(phase, agentResult.success);

        return {
          success: agentResult.success,
          output: agentResult.stdout,
          captured,
          nextPhase,
        };
      }

      if (phase.type === "poll") {
        throw new Error("Poll phases are not yet implemented");
      }

      // script phase
      const { success, output } = await executeScript(phase, ticket);
      const captured = await captureValues(phase, output, ticket);
      const nextPhase = getNextPhase(phase, success);

      return { success, output, captured, nextPhase };
    },
  };
}
