import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type PlanFile,
  PlanFileSchema,
  type TicketState,
  TicketStateSchema,
} from "./types.js";

export interface StateManager {
  listPlans(): Promise<PlanFile[]>;
  getPlan(planId: string): Promise<PlanFile | null>;
  savePlan(plan: PlanFile): Promise<void>;
  listTickets(planId: string): Promise<TicketState[]>;
  getTicket(planId: string, ticketId: string): Promise<TicketState | null>;
  saveTicket(ticket: TicketState): Promise<void>;
  updateTicket(
    planId: string,
    ticketId: string,
    updates: Partial<TicketState>,
  ): Promise<TicketState>;
  getReadyTickets(): Promise<TicketState[]>;
  getRunningCount(): Promise<number>;
  resolveDependencies(planId: string): Promise<void>;
}

async function readJsonSafe<T>(
  filePath: string,
  schema: { parse: (data: unknown) => T },
): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function createStateManager(stateDir: string): StateManager {
  function plansDir(): string {
    return join(stateDir, "plans");
  }

  function planDir(planId: string): string {
    return join(plansDir(), planId);
  }

  function planFilePath(planId: string): string {
    return join(planDir(planId), "plan.json");
  }

  function ticketsDir(planId: string): string {
    return join(planDir(planId), "tickets");
  }

  function ticketFilePath(planId: string, ticketId: string): string {
    return join(ticketsDir(planId), `${ticketId}.json`);
  }

  return {
    async listPlans() {
      const dir = plansDir();
      await mkdir(dir, { recursive: true });
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return [];
      }

      const plans: PlanFile[] = [];
      for (const entry of entries) {
        const plan = await readJsonSafe(
          join(dir, entry, "plan.json"),
          PlanFileSchema,
        );
        if (plan) plans.push(plan);
      }
      return plans;
    },

    async getPlan(planId) {
      return readJsonSafe(planFilePath(planId), PlanFileSchema);
    },

    async savePlan(plan) {
      const dir = planDir(plan.id);
      await mkdir(dir, { recursive: true });
      await mkdir(ticketsDir(plan.id), { recursive: true });
      await writeFile(planFilePath(plan.id), JSON.stringify(plan, null, 2));
    },

    async listTickets(planId) {
      const dir = ticketsDir(planId);
      await mkdir(dir, { recursive: true });
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return [];
      }

      const tickets: TicketState[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const ticket = await readJsonSafe(join(dir, entry), TicketStateSchema);
        if (ticket) tickets.push(ticket);
      }
      return tickets;
    },

    async getTicket(planId, ticketId) {
      return readJsonSafe(ticketFilePath(planId, ticketId), TicketStateSchema);
    },

    async saveTicket(ticket) {
      const dir = ticketsDir(ticket.planId);
      await mkdir(dir, { recursive: true });
      await writeFile(
        ticketFilePath(ticket.planId, ticket.ticketId),
        JSON.stringify(ticket, null, 2),
      );
    },

    async updateTicket(planId, ticketId, updates) {
      const existing = await readJsonSafe(
        ticketFilePath(planId, ticketId),
        TicketStateSchema,
      );
      if (!existing) {
        throw new Error(`Ticket "${ticketId}" not found in plan "${planId}"`);
      }
      const updated = TicketStateSchema.parse({ ...existing, ...updates });
      await writeFile(
        ticketFilePath(planId, ticketId),
        JSON.stringify(updated, null, 2),
      );
      return updated;
    },

    async getReadyTickets() {
      const plans = await this.listPlans();
      const ready: TicketState[] = [];

      for (const plan of plans) {
        if (plan.status !== "active") continue;
        const tickets = await this.listTickets(plan.id);
        const completedIds = new Set(
          tickets.filter((t) => t.status === "complete").map((t) => t.ticketId),
        );
        const planEntry = new Map(plan.tickets.map((t) => [t.ticketId, t]));

        for (const ticket of tickets) {
          if (ticket.status !== "ready") continue;
          const entry = planEntry.get(ticket.ticketId);
          if (!entry) continue;
          const depsResolved = entry.blockedBy.every((dep) =>
            completedIds.has(dep),
          );
          if (depsResolved) ready.push(ticket);
        }
      }

      return ready;
    },

    async getRunningCount() {
      const plans = await this.listPlans();
      let count = 0;
      for (const plan of plans) {
        if (plan.status !== "active") continue;
        const tickets = await this.listTickets(plan.id);
        count += tickets.filter((t) => t.status === "running").length;
      }
      return count;
    },

    async resolveDependencies(planId) {
      const plan = await this.getPlan(planId);
      if (!plan) throw new Error(`Plan "${planId}" not found`);

      const tickets = await this.listTickets(planId);
      const completedIds = new Set(
        tickets.filter((t) => t.status === "complete").map((t) => t.ticketId),
      );
      const planEntry = new Map(plan.tickets.map((t) => [t.ticketId, t]));

      for (const ticket of tickets) {
        if (ticket.status !== "queued") continue;
        const entry = planEntry.get(ticket.ticketId);
        if (!entry) continue;
        const depsResolved = entry.blockedBy.every((dep) =>
          completedIds.has(dep),
        );
        if (depsResolved) {
          await this.updateTicket(planId, ticket.ticketId, {
            status: "ready",
          });
        }
      }

      const allComplete =
        tickets.length > 0 && tickets.every((t) => t.status === "complete");
      if (allComplete) {
        await this.savePlan({ ...plan, status: "complete" });
      }
    },
  };
}
