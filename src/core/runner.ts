import type { PhaseResult } from "../phases/executor.js";
import { createPhaseExecutor } from "../phases/executor.js";
import { createLogger } from "../utils/logger.js";
import { createStateManager } from "./state.js";
import { createTemplateRenderer } from "./template.js";
import type { OrchestratorConfig, TicketState } from "./types.js";
import { createWorkflowLoader } from "./workflow.js";

export interface Runner {
  runSingleTicket(planId: string, ticketId: string): Promise<TicketState>;
  tick(): Promise<void>;
  startDaemon(options?: { signal?: AbortSignal }): Promise<void>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function resolveTicketRepo(
  ticket: TicketState,
  plan: { repo: string | null } | null,
): TicketState {
  if (ticket.repo) return ticket;
  const resolved = plan?.repo ?? null;
  if (!resolved) {
    throw new Error(
      `Ticket "${ticket.ticketId}" has no repo and plan "${ticket.planId}" has no default repo`,
    );
  }
  return { ...ticket, repo: resolved };
}

export function createRunner(config: OrchestratorConfig): Runner {
  const stateManager = createStateManager(config.stateDir);
  const workflowLoader = createWorkflowLoader(config.workflowSearchPath);
  const templateRenderer = createTemplateRenderer(config.promptSearchPath);
  const logger = createLogger(config.logDir);
  const phaseExecutor = createPhaseExecutor(config, templateRenderer, logger);

  const inFlight = new Set<string>();

  async function executeTicketPhase(
    ticket: TicketState,
  ): Promise<{ ticket: TicketState; pendingPoll: boolean }> {
    const plan = await stateManager.getPlan(ticket.planId);
    const planAgent = plan?.agent ?? null;

    // Resolve ticket repo from plan if not set on the ticket
    const resolved = resolveTicketRepo(ticket, plan);

    const phase = await workflowLoader.getPhase(
      ticket.workflow,
      ticket.currentPhase,
    );

    // Check retries vs maxRetries
    const currentRetries = ticket.retries[ticket.currentPhase] ?? 0;
    if (phase.maxRetries !== undefined && currentRetries > phase.maxRetries) {
      logger.error(
        `Phase "${ticket.currentPhase}" exceeded maxRetries (${phase.maxRetries})`,
        ticket.ticketId,
      );
      const updated = await stateManager.updateTicket(
        ticket.planId,
        ticket.ticketId,
        {
          status: "failed",
          error: `Phase "${ticket.currentPhase}" exceeded maxRetries (${phase.maxRetries})`,
        },
      );
      return { ticket: updated, pendingPoll: false };
    }

    const startedAt = new Date().toISOString();
    logger.phaseStart(ticket.currentPhase, ticket.ticketId);

    let result: PhaseResult;
    try {
      result = await phaseExecutor.execute(phase, resolved, planAgent);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.phaseEnd(ticket.currentPhase, ticket.ticketId, "failure");
      logger.error(`Phase error: ${errorMsg}`, ticket.ticketId);

      const completedAt = new Date().toISOString();
      const historyEntry = {
        phase: ticket.currentPhase,
        status: "failure" as const,
        startedAt,
        completedAt,
        output: errorMsg,
      };

      const updated = await stateManager.updateTicket(
        ticket.planId,
        ticket.ticketId,
        {
          status: "failed",
          error: errorMsg,
          phaseHistory: [...ticket.phaseHistory, historyEntry],
        },
      );
      return { ticket: updated, pendingPoll: false };
    }

    // Handle pending poll — re-queue without history noise or retry increment
    if (result.pending) {
      const pollStartKey = `_pollStart_${ticket.currentPhase}`;
      const newContext = { ...ticket.context };

      // Store poll start time on first pending result
      if (!newContext[pollStartKey]) {
        newContext[pollStartKey] = startedAt;
      }

      // Check poll timeout
      const timeoutMs = (phase.timeoutSeconds ?? 86400) * 1000;
      const pollStartTime = new Date(newContext[pollStartKey]).getTime();
      if (Date.now() - pollStartTime >= timeoutMs) {
        logger.phaseEnd(ticket.currentPhase, ticket.ticketId, "failure");
        logger.error(
          `Poll "${ticket.currentPhase}" timed out`,
          ticket.ticketId,
        );

        const completedAt = new Date().toISOString();
        const historyEntry = {
          phase: ticket.currentPhase,
          status: "failure" as const,
          startedAt: newContext[pollStartKey],
          completedAt,
          output: "Poll timeout exceeded",
        };

        const updated = await stateManager.updateTicket(
          ticket.planId,
          ticket.ticketId,
          {
            status: "failed",
            error: "Poll timeout exceeded",
            phaseHistory: [...ticket.phaseHistory, historyEntry],
            context: newContext,
          },
        );
        return { ticket: updated, pendingPoll: false };
      }

      // Not timed out — set back to ready for next tick
      // Store next check time to enforce intervalSeconds
      const intervalMs = (phase.intervalSeconds ?? config.pollInterval) * 1000;
      const nextCheckKey = `_pollNextCheck_${ticket.currentPhase}`;
      newContext[nextCheckKey] = new Date(
        Date.now() + intervalMs,
      ).toISOString();

      logger.info(
        `Poll "${ticket.currentPhase}" not ready, will retry in ${phase.intervalSeconds ?? config.pollInterval}s`,
        ticket.ticketId,
      );
      const updated = await stateManager.updateTicket(
        ticket.planId,
        ticket.ticketId,
        {
          status: "ready",
          context: newContext,
          error: null,
        },
      );
      return { ticket: updated, pendingPoll: true };
    }

    const completedAt = new Date().toISOString();
    const durationMs =
      new Date(completedAt).getTime() - new Date(startedAt).getTime();
    logger.phaseEnd(
      ticket.currentPhase,
      ticket.ticketId,
      result.success ? "success" : "failure",
    );
    logger.info(
      `Phase "${ticket.currentPhase}" completed in ${durationMs}ms`,
      ticket.ticketId,
    );

    const historyEntry = {
      phase: ticket.currentPhase,
      status: (result.success ? "success" : "failure") as "success" | "failure",
      startedAt,
      completedAt,
      output: result.output.slice(0, 4096),
    };

    // Merge captured values into context
    const newContext = { ...ticket.context, ...result.captured };

    // Clear poll metadata if we're leaving a poll phase
    const pollStartKey = `_pollStart_${ticket.currentPhase}`;
    const pollNextCheckKey = `_pollNextCheck_${ticket.currentPhase}`;
    if (newContext[pollStartKey]) {
      delete newContext[pollStartKey];
    }
    if (newContext[pollNextCheckKey]) {
      delete newContext[pollNextCheckKey];
    }

    // Determine next state
    if (phase.type === "terminal") {
      // Terminal phase → complete or needs_attention
      const newStatus = phase.notify ? "needs_attention" : "complete";
      const updated = await stateManager.updateTicket(
        ticket.planId,
        ticket.ticketId,
        {
          status: newStatus,
          phaseHistory: [...ticket.phaseHistory, historyEntry],
          context: newContext,
          error: null,
        },
      );
      return { ticket: updated, pendingPoll: false };
    }

    if (result.nextPhase === ticket.currentPhase) {
      // Retry — same phase
      const newRetries = {
        ...ticket.retries,
        [ticket.currentPhase]: currentRetries + 1,
      };
      const updated = await stateManager.updateTicket(
        ticket.planId,
        ticket.ticketId,
        {
          status: "ready",
          phaseHistory: [...ticket.phaseHistory, historyEntry],
          context: newContext,
          retries: newRetries,
          error: null,
        },
      );
      return { ticket: updated, pendingPoll: false };
    }

    if (result.nextPhase) {
      // Advance to next phase
      const updated = await stateManager.updateTicket(
        ticket.planId,
        ticket.ticketId,
        {
          currentPhase: result.nextPhase,
          status: "ready",
          phaseHistory: [...ticket.phaseHistory, historyEntry],
          context: newContext,
          error: null,
        },
      );
      return { ticket: updated, pendingPoll: false };
    }

    // No next phase and not terminal — phase didn't define a transition
    const updated = await stateManager.updateTicket(
      ticket.planId,
      ticket.ticketId,
      {
        status: result.success ? "complete" : "failed",
        phaseHistory: [...ticket.phaseHistory, historyEntry],
        context: newContext,
        error: result.success ? null : "Phase failed without a next phase",
      },
    );
    return { ticket: updated, pendingPoll: false };
  }

  async function runTicketPhases(ticket: TicketState): Promise<TicketState> {
    let current = ticket;

    while (true) {
      const { ticket: updated, pendingPoll } =
        await executeTicketPhase(current);

      // Re-read from disk for consistency
      const fromDisk = await stateManager.getTicket(
        updated.planId,
        updated.ticketId,
      );
      if (!fromDisk) {
        throw new Error(
          `Ticket "${updated.ticketId}" disappeared during execution`,
        );
      }
      current = fromDisk;

      // Check if we reached a terminal or yielding state
      if (
        current.status === "complete" ||
        current.status === "failed" ||
        current.status === "needs_attention"
      ) {
        logger.info(
          `Ticket ${current.ticketId} finished with status: ${current.status}`,
          current.ticketId,
        );
        break;
      }

      // Pending poll — yield back to daemon loop for re-dispatch
      if (pendingPoll) {
        break;
      }
    }

    return current;
  }

  return {
    async runSingleTicket(planId, ticketId) {
      let ticket = await stateManager.getTicket(planId, ticketId);
      if (!ticket) {
        throw new Error(`Ticket "${ticketId}" not found in plan "${planId}"`);
      }

      // Set to running
      ticket = await stateManager.updateTicket(planId, ticketId, {
        status: "running",
      });

      logger.info(`Starting ticket ${ticketId}`, ticketId);

      return runTicketPhases(ticket);
    },

    async tick() {
      // 1. Resolve dependencies across all active plans
      const plans = await stateManager.listPlans();
      const activePlans = plans.filter((p) => p.status === "active");

      for (const plan of activePlans) {
        await stateManager.resolveDependencies(plan.id);
      }

      // 2. Get current running count
      const runningCount = await stateManager.getRunningCount();

      // 3. Get ready tickets
      const readyTickets = await stateManager.getReadyTickets();

      // 4. Filter out tickets already in-flight or waiting on poll interval
      const now = Date.now();
      const dispatchable = readyTickets.filter((t) => {
        if (inFlight.has(`${t.planId}/${t.ticketId}`)) return false;

        // Respect poll intervalSeconds — skip if next check time is in the future
        const nextCheckKey = `_pollNextCheck_${t.currentPhase}`;
        const nextCheck = t.context[nextCheckKey];
        if (nextCheck && new Date(nextCheck).getTime() > now) return false;

        return true;
      });

      // 5. Dispatch up to available concurrency slots
      const available = config.maxConcurrency - runningCount - inFlight.size;
      const toDispatch = dispatchable.slice(0, Math.max(0, available));

      for (const ticket of toDispatch) {
        const key = `${ticket.planId}/${ticket.ticketId}`;
        inFlight.add(key);

        // Set status to running
        const running = await stateManager.updateTicket(
          ticket.planId,
          ticket.ticketId,
          { status: "running" },
        );

        // Fire-and-forget
        runTicketPhases(running)
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(
              `Ticket ${ticket.ticketId} failed: ${msg}`,
              ticket.ticketId,
            );
          })
          .finally(() => {
            inFlight.delete(key);
          });
      }

      // 6. Log tick summary
      logger.info(
        `Tick: dispatched=${toDispatch.length} running=${runningCount} ready=${readyTickets.length} inFlight=${inFlight.size}`,
      );
    },

    async startDaemon(options) {
      logger.info("Daemon started");

      while (!options?.signal?.aborted) {
        await this.tick();
        await sleep(config.pollInterval * 1000, options?.signal);
      }

      logger.info("Daemon stopped");
    },
  };
}
